// VoiceNotes Webhook Worker
// Syncs recordings from VoiceNotes API to Cloudflare KV

const VOICENOTES_API = 'https://api.voicenotes.com/api/integrations/obsidian-sync';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (path === '/health') {
        return json({ status: 'ok', timestamp: new Date().toISOString() }, corsHeaders);
      }

      if (path === '/sync' && request.method === 'POST') {
        return await syncFromVoiceNotes(env, corsHeaders);
      }

      if (path === '/sync' && request.method === 'GET') {
        return await getSyncStatus(env, corsHeaders);
      }

      if (path === '/notes' && request.method === 'GET') {
        return await listNotes(env, url, corsHeaders);
      }

      if (path.startsWith('/notes/') && path.endsWith('/synced') && request.method === 'POST') {
        const id = path.replace('/notes/', '').replace('/synced', '');
        return await markSynced(env, id, corsHeaders);
      }

      if (path.startsWith('/notes/') && request.method === 'GET') {
        const id = path.replace('/notes/', '');
        return await getNote(env, id, corsHeaders);
      }

      if (path.startsWith('/notes/') && request.method === 'DELETE') {
        const id = path.replace('/notes/', '');
        return await deleteNote(env, id, corsHeaders);
      }

      if (path === '/export') {
        return await exportMarkdown(env, corsHeaders);
      }

      return json({
        error: 'Not found',
        endpoints: [
          'GET /health',
          'POST /sync - Pull new recordings from VoiceNotes',
          'GET /sync - Get sync status',
          'GET /notes - List all notes',
          'GET /notes/:id - Get single note',
          'DELETE /notes/:id - Delete note',
          'POST /notes/:id/synced - Mark as synced to Craft',
          'GET /export - Export all as markdown'
        ]
      }, corsHeaders, 404);

    } catch (error) {
      return json({ error: error.message }, corsHeaders, 500);
    }
  }
};

async function syncFromVoiceNotes(env, corsHeaders) {
  const API_KEY = env.VOICENOTES_API_KEY;
  
  const response = await fetch(`${VOICENOTES_API}/recordings`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'X-API-KEY': API_KEY,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });

  if (!response.ok) {
    const error = await response.text();
    return json({ error: 'Failed to fetch from VoiceNotes', details: error }, corsHeaders, 500);
  }

  const data = await response.json();
  const recordings = data.data || [];

  let synced = 0;
  let updated = 0;
  let skipped = 0;

  for (const recording of recordings) {
    const noteId = recording.recording_id || recording.id;
    const existing = await env.NOTES.get(`note:${noteId}`);
    
    // Clean HTML from transcript
    const transcript = (recording.transcript || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '');

    const note = {
      id: noteId,
      title: recording.title || 'Untitled',
      transcript,
      duration: recording.duration || 0,
      summary: recording.creations?.find(c => c.type === 'summary')?.content || '',
      todos: recording.creations?.find(c => c.type === 'todo')?.content || '',
      points: recording.creations?.find(c => c.type === 'points')?.content || '',
      tidy: recording.creations?.find(c => c.type === 'tidy')?.content || '',
      tags: (recording.tags || []).map(t => t.name || t),
      subnotes: recording.subnotes || [],
      created_at: recording.created_at,
      updated_at: recording.updated_at,
      synced_to_craft: false
    };

    if (existing) {
      const existingNote = JSON.parse(existing);
      if (existingNote.updated_at !== note.updated_at) {
        note.synced_to_craft = existingNote.synced_to_craft;
        await env.NOTES.put(`note:${noteId}`, JSON.stringify(note));
        updated++;
      } else {
        skipped++;
      }
    } else {
      await env.NOTES.put(`note:${noteId}`, JSON.stringify(note));
      synced++;
    }
  }

  await env.NOTES.put('_last_sync', new Date().toISOString());
  await env.NOTES.put('_sync_count', String(parseInt(await env.NOTES.get('_sync_count') || '0') + 1));

  return json({
    success: true,
    fetched: recordings.length,
    new: synced,
    updated,
    skipped,
    last_sync: new Date().toISOString()
  }, corsHeaders);
}

async function getSyncStatus(env, corsHeaders) {
  const lastSync = await env.NOTES.get('_last_sync');
  const syncCount = await env.NOTES.get('_sync_count') || '0';
  
  const list = await env.NOTES.list({ prefix: 'note:' });
  const total = list.keys.length;
  
  let unsynced = 0;
  for (const key of list.keys) {
    const note = JSON.parse(await env.NOTES.get(key.name));
    if (!note.synced_to_craft) unsynced++;
  }

  return json({
    last_sync: lastSync,
    sync_count: parseInt(syncCount),
    total_notes: total,
    unsynced_to_craft: unsynced
  }, corsHeaders);
}

async function listNotes(env, url, corsHeaders) {
  const limit = parseInt(url.searchParams.get('limit') || '100');
  const unsynced = url.searchParams.get('unsynced') === 'true';
  
  const list = await env.NOTES.list({ prefix: 'note:', limit: 1000 });
  const notes = [];

  for (const key of list.keys) {
    const note = JSON.parse(await env.NOTES.get(key.name));
    if (unsynced && note.synced_to_craft) continue;
    notes.push(note);
    if (notes.length >= limit) break;
  }

  // Sort by created_at descending
  notes.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return json({
    count: notes.length,
    notes: notes.slice(0, limit)
  }, corsHeaders);
}

async function getNote(env, id, corsHeaders) {
  const note = await env.NOTES.get(`note:${id}`);
  if (!note) {
    return json({ error: 'Note not found' }, corsHeaders, 404);
  }
  return json(JSON.parse(note), corsHeaders);
}

async function deleteNote(env, id, corsHeaders) {
  await env.NOTES.delete(`note:${id}`);
  return json({ success: true, deleted: id }, corsHeaders);
}

async function markSynced(env, id, corsHeaders) {
  const note = await env.NOTES.get(`note:${id}`);
  if (!note) {
    return json({ error: 'Note not found' }, corsHeaders, 404);
  }
  
  const parsed = JSON.parse(note);
  parsed.synced_to_craft = true;
  parsed.synced_at = new Date().toISOString();
  await env.NOTES.put(`note:${id}`, JSON.stringify(parsed));
  
  return json({ success: true, id, synced_to_craft: true }, corsHeaders);
}

async function exportMarkdown(env, corsHeaders) {
  const list = await env.NOTES.list({ prefix: 'note:' });
  
  let markdown = '# VoiceNotes Export\n\n';
  markdown += `Generated: ${new Date().toISOString()}\n\n---\n\n`;

  for (const key of list.keys) {
    const note = JSON.parse(await env.NOTES.get(key.name));
    markdown += `## ${note.title}\n\n`;
    markdown += `**Created:** ${note.created_at}\n\n`;
    
    if (note.transcript) {
      markdown += `### Transcript\n\n${note.transcript}\n\n`;
    }
    if (note.summary) {
      markdown += `### Summary\n\n${note.summary}\n\n`;
    }
    if (note.todos) {
      markdown += `### Action Items\n\n${note.todos}\n\n`;
    }
    if (note.tags && note.tags.length > 0) {
      markdown += `**Tags:** ${note.tags.join(', ')}\n\n`;
    }
    markdown += '---\n\n';
  }

  return new Response(markdown, {
    headers: { ...corsHeaders, 'Content-Type': 'text/markdown' }
  });
}

function json(data, corsHeaders, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
