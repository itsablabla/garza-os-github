// Beeper Scheduler - D1-backed message scheduling worker
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(processScheduledMessages(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'beeper-scheduler' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (url.pathname === '/run' && request.method === 'POST') {
      const result = await processScheduledMessages(env);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (url.pathname === '/queue') {
      const messages = await env.DB.prepare(
        "SELECT id, chat_id, recipient_name, message_text, status, scheduled_at, created_at FROM beeper_message_queue WHERE status = 'scheduled' ORDER BY scheduled_at ASC LIMIT 50"
      ).all();
      return new Response(JSON.stringify(messages.results), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (url.pathname === '/history') {
      const messages = await env.DB.prepare(
        "SELECT id, chat_id, recipient_name, message_text, status, scheduled_at, sent_at, error_message FROM beeper_message_queue ORDER BY id DESC LIMIT 50"
      ).all();
      return new Response(JSON.stringify(messages.results), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (url.pathname === '/schedule' && request.method === 'POST') {
      const body = await request.json();
      const { chat_id, message_text, scheduled_at, recipient_name, reply_to_message_id, notes, priority } = body;
      
      if (!chat_id || !message_text || !scheduled_at) {
        return new Response(JSON.stringify({ error: 'Missing required fields' }), {
          status: 400, headers: { 'Content-Type': 'application/json' }
        });
      }
      
      const result = await env.DB.prepare(
        "INSERT INTO beeper_message_queue (chat_id, message_text, status, scheduled_at, recipient_name, reply_to_message_id, notes, priority) VALUES (?, ?, 'scheduled', ?, ?, ?, ?, ?)"
      ).bind(chat_id, message_text, scheduled_at, recipient_name || null, reply_to_message_id || null, notes || null, priority || 0).run();
      
      return new Response(JSON.stringify({ success: true, id: result.meta.last_row_id, scheduled_at }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (url.pathname === '/cancel' && request.method === 'POST') {
      const body = await request.json();
      const result = await env.DB.prepare(
        "UPDATE beeper_message_queue SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status = 'scheduled'"
      ).bind(body.id).run();
      return new Response(JSON.stringify({ success: result.meta.changes > 0 }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({ service: 'beeper-scheduler', endpoints: ['GET /health', 'GET /queue', 'GET /history', 'POST /run', 'POST /schedule', 'POST /cancel'] }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

async function processScheduledMessages(env) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const results = { processed: 0, sent: 0, failed: 0, errors: [], time: now };
  
  const messages = await env.DB.prepare(
    "SELECT id, chat_id, message_text, reply_to_message_id, recipient_name FROM beeper_message_queue WHERE status = 'scheduled' AND scheduled_at <= ? ORDER BY priority DESC, scheduled_at ASC LIMIT 10"
  ).bind(now).all();
  
  if (!messages.results || messages.results.length === 0) {
    return { ...results, message: 'No messages due' };
  }
  
  results.processed = messages.results.length;
  
  for (const msg of messages.results) {
    try {
      const success = await sendBeeperMessage(env, msg.chat_id, msg.message_text, msg.reply_to_message_id);
      if (success) {
        await env.DB.prepare("UPDATE beeper_message_queue SET status = 'sent', sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").bind(msg.id).run();
        results.sent++;
      } else {
        throw new Error('Send returned false');
      }
    } catch (err) {
      await env.DB.prepare("UPDATE beeper_message_queue SET status = CASE WHEN retry_count >= 3 THEN 'failed' ELSE 'scheduled' END, retry_count = retry_count + 1, error_message = ?, updated_at = datetime('now') WHERE id = ?").bind(err.message.slice(0, 500), msg.id).run();
      results.failed++;
      results.errors.push({ id: msg.id, error: err.message });
    }
  }
  return results;
}

async function sendBeeperMessage(env, chatId, text, replyTo) {
  var encodedChatId = encodeURIComponent(chatId);
  var apiUrl = "https://beeper-local.garzahive.com/api/v1/chats/" + encodedChatId + "/send";
  
  var payload = { text: text };
  if (replyTo) payload.reply_to = replyTo;
  
  var response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  
  if (!response.ok) {
    var errText = await response.text();
    throw new Error("Beeper API error " + response.status + ": " + errText.slice(0, 200));
  }
  
  return true;
}
