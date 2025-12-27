// VoiceNotes Auto-Indexer with Craft Sync + Full Transcripts
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const CRAFT_API = "https://mcp.craft.do/links/KvkWq8X8cFZ/mcp";
const VOICE_MEMOS_FOLDER = "7853";

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(processUnsynced(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    try {
      if (url.pathname === "/health") return json({ status: "ok", timestamp: new Date().toISOString() }, cors);
      if (url.pathname === "/process" && request.method === "POST") return json(await processUnsynced(env), cors);
      if (url.pathname === "/status") return json(await getStatus(env), cors);
      if (url.pathname === "/people") return json(await listPeople(env), cors);
      if (url.pathname === "/extractions") return json(await listExtractions(env), cors);
      if (url.pathname.startsWith("/extraction/")) {
        const noteId = url.pathname.split("/extraction/")[1];
        const data = await env.EXTRACTIONS.get("ext:" + noteId);
        return data ? json(JSON.parse(data), cors) : json({ error: "not found" }, cors, 404);
      }
      return json({ endpoints: ["GET /health", "POST /process", "GET /status", "GET /people", "GET /extractions", "GET /extraction/:id"] }, cors);
    } catch (e) { return json({ error: e.message, stack: e.stack }, cors, 500); }
  }
};

async function processUnsynced(env) {
  const results = { processed: 0, failed: 0, skipped: 0, craft_synced: 0, extractions: [] };
  
  const notesResp = await env.VOICENOTES.fetch(new Request("https://voicenotes-webhook.jadengarza.workers.dev/notes?unsynced=true"));
  const notesData = await notesResp.json();

  for (const note of notesData.notes || []) {
    if (!note.transcript || note.transcript.length < 20 || note.transcript.includes("eyJ") || note.transcript.includes("fm2_")) {
      results.skipped++; continue;
    }
    try {
      const extraction = await extractEntities(env, note.transcript, note.title);
      if (extraction) {
        await env.EXTRACTIONS.put("ext:" + note.id, JSON.stringify({ 
          note_id: note.id, 
          title: note.title, 
          transcript: note.transcript,
          audio_url: note.audio_url,
          duration: note.duration,
          created_at: note.created_at,
          extracted_at: new Date().toISOString(), 
          ...extraction 
        }));
        
        const craftResult = await syncToCraft(env, note, extraction);
        if (craftResult.success) results.craft_synced++;
        
        await updatePeopleIndex(env, note, extraction);
        
        await env.VOICENOTES.fetch(new Request("https://voicenotes-webhook.jadengarza.workers.dev/notes/" + note.id + "/synced", { method: "POST" }));
        results.processed++;
        results.extractions.push({ id: note.id, title: note.title, craft_doc: craftResult.docId, people: extraction.people?.length || 0 });
      }
    } catch (e) { 
      console.error("Failed " + note.id + ":", e); 
      results.failed++; 
      results.errors = results.errors || []; 
      results.errors.push({id: note.id, error: e.message}); 
    }
  }

  const stats = JSON.parse(await env.EXTRACTIONS.get("_stats") || "{}");
  stats.last_run = new Date().toISOString();
  stats.total_processed = (stats.total_processed || 0) + results.processed;
  stats.total_craft_synced = (stats.total_craft_synced || 0) + results.craft_synced;
  await env.EXTRACTIONS.put("_stats", JSON.stringify(stats));
  return results;
}

async function extractEntities(env, transcript, title) {
  const prompt = `Analyze this voice memo and extract JSON:
TITLE: ${title}
TRANSCRIPT: ${transcript}

Return ONLY this JSON structure:
{"people":[{"name":"","role":"","context":"","sentiment":"positive/negative/neutral"}],"topics":[],"decisions":[],"action_items":[],"projects":[],"key_facts":[],"summary":""}

Rules: Only include people mentioned by name. Be specific about context. Return ONLY valid JSON.`;

  const resp = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 2000, messages: [{ role: "user", content: prompt }] })
  });
  if (!resp.ok) throw new Error("Claude API error: " + resp.status);
  const data = await resp.json();
  const text = data.content[0]?.text || "";
  try {
    let jsonStr = text.includes("```json") ? text.split("```json")[1].split("```")[0].trim() : text.includes("```") ? text.split("```")[1].split("```")[0].trim() : text;
    return JSON.parse(jsonStr);
  } catch { return null; }
}

async function syncToCraft(env, note, extraction) {
  try {
    let md = `**Extracted:** ${new Date().toISOString().split('T')[0]} | **Note ID:** ${note.id}`;
    if (note.duration) md += ` | **Duration:** ${Math.round(note.duration)}s`;
    md += `\n\n## Summary\n${extraction.summary}\n`;
    
    if (extraction.people?.length) {
      md += `\n## People Mentioned\n`;
      extraction.people.forEach(p => { md += `- **${p.name}**${p.role ? ` (${p.role})` : ''} - ${p.context}\n`; });
    }
    
    if (extraction.decisions?.length) {
      md += `\n## Decisions\n`;
      extraction.decisions.forEach(d => { md += `- ${d}\n`; });
    }
    
    if (extraction.action_items?.length) {
      md += `\n## Action Items\n`;
      extraction.action_items.forEach(a => { md += `- [ ] ${a}\n`; });
    }
    
    if (extraction.projects?.length) {
      md += `\n## Projects\n`;
      extraction.projects.forEach(p => { md += `- ${p}\n`; });
    }
    
    if (extraction.key_facts?.length) {
      md += `\n## Key Facts\n`;
      extraction.key_facts.forEach(f => { md += `- ${f}\n`; });
    }

    md += `\n## Full Transcript\n${note.transcript}\n`;
    
    if (note.audio_url) {
      md += `\n---\n[Audio File](${note.audio_url})\n`;
    }

    const createResp = await fetch(CRAFT_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "documents_create",
          arguments: {
            destination: { folderId: VOICE_MEMOS_FOLDER },
            documents: [{ title: note.title }]
          }
        }
      })
    });
    
    if (!createResp.ok) return { success: false, error: "create failed" };
    
    const createData = await createResp.json();
    const docId = createData.result?.content?.[0]?.text ? 
      JSON.parse(createData.result.content[0].text).documents?.[0]?.id : null;
    
    if (!docId) return { success: false, error: "no doc id" };

    const addResp = await fetch(CRAFT_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "markdown_add",
          arguments: {
            markdown: md,
            position: { pageId: docId, position: "end" }
          }
        }
      })
    });

    if (addResp.ok) {
      const ext = JSON.parse(await env.EXTRACTIONS.get("ext:" + note.id) || "{}");
      ext.craft_doc_id = docId;
      await env.EXTRACTIONS.put("ext:" + note.id, JSON.stringify(ext));
    }

    return { success: addResp.ok, docId: docId };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function updatePeopleIndex(env, note, extraction) {
  for (const person of extraction.people || []) {
    const key = "person:" + person.name.toLowerCase().replace(/\s+/g, "_");
    const existing = await env.EXTRACTIONS.get(key);
    const data = existing ? JSON.parse(existing) : { name: person.name, mentions: [], roles: [] };
    data.mentions.push({ note_id: note.id, title: note.title, date: note.created_at, context: person.context, sentiment: person.sentiment });
    if (person.role && !data.roles.includes(person.role)) data.roles.push(person.role);
    data.last_mentioned = note.created_at;
    data.mention_count = data.mentions.length;
    await env.EXTRACTIONS.put(key, JSON.stringify(data));
  }
}

async function listPeople(env) {
  const list = await env.EXTRACTIONS.list({ prefix: "person:" });
  const people = [];
  for (const key of list.keys) {
    const d = JSON.parse(await env.EXTRACTIONS.get(key.name) || "{}");
    people.push({ name: d.name, roles: d.roles, mentions: d.mentions?.length || 0, last_mentioned: d.last_mentioned });
  }
  return { count: people.length, people };
}

async function listExtractions(env) {
  const list = await env.EXTRACTIONS.list({ prefix: "ext:" });
  const extractions = [];
  for (const key of list.keys) {
    const d = JSON.parse(await env.EXTRACTIONS.get(key.name) || "{}");
    extractions.push({ note_id: d.note_id, title: d.title, extracted_at: d.extracted_at, summary: d.summary, has_transcript: !!d.transcript });
  }
  return { count: extractions.length, extractions };
}

async function getStatus(env) {
  const stats = JSON.parse(await env.EXTRACTIONS.get("_stats") || "{}");
  stats.people_tracked = (await env.EXTRACTIONS.list({ prefix: "person:" })).keys.length;
  stats.extractions = (await env.EXTRACTIONS.list({ prefix: "ext:" })).keys.length;
  return stats;
}

function json(data, cors, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
