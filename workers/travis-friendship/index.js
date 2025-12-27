const BEEPER_API = "https://api.beeper.com/bridgebox/jadengarza/bridge/imessagecloud/send_message";
const BEEPER_KEY = "f5fdda83-f867-49b2-975d-d2d88ea66f59";
const NOTIFY_CHAT = "!OGnJyJWhFfYdeGRXNo:beeper.com";

async function sendNotification(text) {
  try {
    const resp = await fetch(BEEPER_API, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + BEEPER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: NOTIFY_CHAT, message: text })
    });
    return { ok: resp.ok, status: resp.status };
  } catch (e) { return { ok: false, error: e.message }; }
}

function getWeeklyVerse() {
  const verses = [
    { reference: "Proverbs 17:17", text: "A friend loves at all times, and a brother is born for a time of adversity.", theme: "friendship" },
    { reference: "Ecclesiastes 4:9-10", text: "Two are better than one, because they have a good return for their labor.", theme: "partnership" },
    { reference: "Proverbs 27:17", text: "As iron sharpens iron, so one person sharpens another.", theme: "growth" },
    { reference: "1 Thessalonians 5:11", text: "Therefore encourage one another and build each other up.", theme: "encouragement" },
    { reference: "Galatians 6:2", text: "Carry each other's burdens, and in this way you will fulfill the law of Christ.", theme: "support" },
    { reference: "Colossians 3:16", text: "Let the message of Christ dwell among you richly.", theme: "wisdom" },
    { reference: "Hebrews 10:24-25", text: "Let us consider how we may spur one another on toward love and good deeds.", theme: "action" },
    { reference: "Romans 12:10", text: "Be devoted to one another in love. Honor one another above yourselves.", theme: "devotion" },
    { reference: "Philippians 2:3-4", text: "In humility value others above yourselves.", theme: "humility" },
    { reference: "John 15:13", text: "Greater love has no one than this: to lay down one's life for one's friends.", theme: "sacrifice" }
  ];
  const weekOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));
  return verses[weekOfYear % verses.length];
}

async function sundayCheckIn(env) {
  const travis = await env.RELATIONSHIPS_DB.prepare("SELECT * FROM contacts WHERE id = 'travis-001'").first();
  if (!travis) return { success: false, error: "Travis not found" };
  
  const lastContact = travis.last_contact_date ? new Date(travis.last_contact_date) : null;
  const daysSince = lastContact ? Math.floor((Date.now() - lastContact.getTime()) / (1000 * 60 * 60 * 24)) : 999;
  const verse = getWeeklyVerse();
  
  let msg = "🙏 **Travis Check-in**\n\n";
  msg += "Days since contact: " + daysSince + "\n\n";
  msg += "📖 " + verse.reference + "\n";
  msg += '"' + verse.text + '"\n';
  msg += "_Theme: " + verse.theme + "_";
  if (daysSince >= 7) msg += "\n\n⚠️ Over a week - reach out today!";
  
  const result = await sendNotification(msg);
  return { success: result.ok, verse, daysSince, notification: result };
}

async function frequencyCheck(env) {
  const result = await env.RELATIONSHIPS_DB.prepare("SELECT id, name, last_contact_date, check_in_frequency_days FROM contacts WHERE last_contact_date IS NOT NULL").all();
  const overdue = [];
  const today = Date.now();
  
  for (const c of result.results || []) {
    const lastContact = new Date(c.last_contact_date);
    const daysSince = Math.floor((today - lastContact.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince >= (c.check_in_frequency_days || 14)) {
      overdue.push({ name: c.name, daysSince });
    }
  }
  
  if (overdue.length > 0) {
    const names = overdue.map(c => c.name + " (" + c.daysSince + "d)").join(", ");
    await sendNotification("⏰ **Friendship Check-in Needed**\n\nOverdue: " + names);
  }
  
  return overdue;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
    
    if (path === "/health") return new Response(JSON.stringify({ status: "ok", service: "travis-friendship" }), { headers });
    
    if (path === "/status") {
      const travis = await env.RELATIONSHIPS_DB.prepare("SELECT * FROM contacts WHERE id = 'travis-001'").first();
      const interactions = await env.RELATIONSHIPS_DB.prepare("SELECT * FROM interactions WHERE contact_id = 'travis-001' ORDER BY date DESC LIMIT 5").all();
      const lastContact = travis?.last_contact_date ? new Date(travis.last_contact_date) : null;
      const daysSince = lastContact ? Math.floor((Date.now() - lastContact.getTime()) / (1000 * 60 * 60 * 24)) : 999;
      const health = daysSince <= 7 ? "green" : daysSince <= 14 ? "yellow" : "red";
      return new Response(JSON.stringify({ contact: travis, daysSince, health, interactions: interactions.results }), { headers });
    }
    
    if (path === "/verse") return new Response(JSON.stringify(getWeeklyVerse()), { headers });
    if (path === "/trigger/sunday") { const r = await sundayCheckIn(env); return new Response(JSON.stringify(r), { headers }); }
    if (path === "/trigger/frequency") { const o = await frequencyCheck(env); return new Response(JSON.stringify({ triggered: true, overdue: o }), { headers }); }
    
    if (path === "/log" && request.method === "POST") {
      const data = await request.json();
      const today = new Date().toISOString().split("T")[0];
      await env.RELATIONSHIPS_DB.prepare("INSERT INTO interactions (contact_id, date, initiated_by, channel, topics, new_info, follow_up, mood, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(data.contact_id, today, data.initiated_by, data.channel || "whatsapp", data.topics || "", data.new_info || "", data.follow_up || "", data.mood || "neutral", data.summary || "").run();
      await env.RELATIONSHIPS_DB.prepare("UPDATE contacts SET last_contact_date = ?, last_initiated_by = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(today, data.initiated_by, data.contact_id).run();
      return new Response(JSON.stringify({ success: true }), { headers });
    }
    
    if (path === "/contacts") {
      const result = await env.RELATIONSHIPS_DB.prepare("SELECT * FROM contacts").all();
      return new Response(JSON.stringify(result.results), { headers });
    }
    
    return new Response(JSON.stringify({ service: "travis-friendship", endpoints: ["/health", "/status", "/verse", "/trigger/sunday", "/trigger/frequency", "POST /log", "/contacts"] }), { headers });
  },
  
  async scheduled(event, env, ctx) {
    const hour = new Date().getUTCHours();
    const dayOfWeek = new Date().getUTCDay();
    if (dayOfWeek === 0 && hour === 14) ctx.waitUntil(sundayCheckIn(env));
    if (hour === 15) ctx.waitUntil(frequencyCheck(env));
  }
};
