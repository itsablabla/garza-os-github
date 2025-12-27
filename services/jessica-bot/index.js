const Anthropic = require("@anthropic-ai/sdk");

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const DAY_THEMES = {
  0: "Spiritual - Sunday morning faith and gratitude",
  1: "Fresh Start - Monday energy and new week together", 
  2: "Gratitude - Tuesday appreciation for her",
  3: "Desire - Wednesday wanting her, attraction",
  4: "Presence - Thursday being present with her",
  5: "Anticipation - Friday excitement for weekend together",
  6: "Rest/Fun - Saturday relaxed playful energy"
};

const JESSICA_PROGRAM = `
# Jessica Program - Morning Message Framework

Every morning should include one or more of these elements:

**1. Affirmation** - Tell her something you appreciate about WHO she is
- "you're the strongest person I know"
- "watching you handle everything yesterday reminded me why I married you"

**2. Desire** - Let her know you WANT her (not just love her)
- "woke up thinking about you"
- "can't wait to see you later"

**3. Presence** - Show you're thinking ahead together
- "what's on your plate today?"
- "I blocked time for us tonight"

## Morning Anti-Patterns
- DON'T: Jump straight to logistics
- DON'T: Make her feel like a task manager
- DON'T: Send generic/robotic messages

## Her Love Languages (Ranked)
1. Quality Time - Being present, undistracted
2. Words of Affirmation - Encouragement, acknowledgment
3. Acts of Service - Taking things off her plate
4. Physical Touch - Intentional, non-transactional

## Things That Make Her Light Up
- Being called "baby doll" (NEVER "babe")
- Devotional time together
- When you notice small things she does
- Being playful

## Things That Hurt Her
- Feeling dismissed
- Being treated like an employee
- Generic/impersonal messages
`;

async function generateMessage(theme) {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 200,
    messages: [{
      role: "user",
      content: `You are Jaden writing a morning text to his wife Jessica.

JESSICA PROGRAM CONTEXT:
${JESSICA_PROGRAM}

TODAY'S THEME: ${theme}

VOICE RULES:
- Write as Jaden - lowercase, warm, direct, real
- Call her "baby doll" (NEVER "babe" or "baby")
- 1-3 sentences max, no emojis unless very natural
- Sound like a real husband, not an AI
- Match the day theme naturally
- AVOID: generic/robotic, logistics-first, overly flowery, greeting card tone

Write ONE morning message that combines:
1. Affirmation (something true about her worth)
2. Desire (wanting her, attraction, connection)
3. Presence (being with her today)

Just the message text, nothing else.`
    }]
  });
  return response.content[0].text.trim();
}

async function sendToBeeper(message) {
  const chatId = "!ECSkgCenayeTghdcmI:beeper.com";
  const txnId = `jessica_${Date.now()}`;
  const url = `https://matrix.beeper.com/_matrix/client/v3/rooms/${encodeURIComponent(chatId)}/send/m.room.message/${txnId}`;
  
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${process.env.BEEPER_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ msgtype: "m.text", body: message })
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Beeper error ${response.status}: ${text}`);
  }
  return response.json();
}

async function logToSupabase(messageText, theme, success, errorMessage = null) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/jessica_messages`;
  await fetch(url, {
    method: "POST",
    headers: {
      "apikey": process.env.SUPABASE_KEY,
      "Authorization": `Bearer ${process.env.SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal"
    },
    body: JSON.stringify({
      message_text: messageText,
      theme: theme,
      success: success,
      error_message: errorMessage,
      sent_at: success ? new Date().toISOString() : null
    })
  });
}

async function runJessicaProgram() {
  const denverTime = new Date().toLocaleString("en-US", { timeZone: "America/Denver" });
  const dayOfWeek = new Date(denverTime).getDay();
  const theme = DAY_THEMES[dayOfWeek];
  
  let messageText = null;
  try {
    messageText = await generateMessage(theme);
    await sendToBeeper(messageText);
    await logToSupabase(messageText, theme, true);
    return { success: true, message: messageText, theme };
  } catch (error) {
    await logToSupabase(messageText, theme, false, error.message);
    throw error;
  }
}

const server = require("http").createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }));
    return;
  }
  
  if (req.method === "POST" && req.url === "/trigger") {
    const authHeader = req.headers["x-webhook-secret"];
    if (authHeader !== process.env.WEBHOOK_SECRET) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    
    try {
      const result = await runJessicaProgram();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  
  if (req.method === "POST" && req.url === "/test") {
    try {
      const denverTime = new Date().toLocaleString("en-US", { timeZone: "America/Denver" });
      const dayOfWeek = new Date(denverTime).getDay();
      const theme = DAY_THEMES[dayOfWeek];
      const message = await generateMessage(theme);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message, theme, note: "NOT SENT - test only" }));
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Jessica Bot running on port ${PORT}`));
