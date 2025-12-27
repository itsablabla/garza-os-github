const http = require('http');
const https = require('https');

const ZAPIER_MCP_URL = "https://mcp.zapier.com/api/mcp/a/17598012/mcp";
const CLAUDE_API_KEY = "{{ANTHROPIC_API_KEY}}";

function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = { hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search, method: options.method || 'GET', headers: options.headers || {} };
    const req = https.request(reqOptions, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, data }); } });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function checkEmails() {
  const logs = [];
  try {
    logs.push("Starting...");
    const emailResp = await fetchJSON(ZAPIER_MCP_URL, { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {name: "gmail_find_email", arguments: { instructions: "Find emails from last 15 min", output_hint: "subject, from, snippet", query: "newer_than:15m" }}}) });
    const emailText = emailResp.data?.result?.content?.[0]?.text || "";
    logs.push("Email: " + emailResp.status);
    let summary = "No new emails";
    if (emailText && emailText.length > 50) {
      const claudeResp = await fetchJSON("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": CLAUDE_API_KEY, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 512, messages: [{role: "user", content: "Brief email summary:\n- Urgent: [any]\n- Action: [items]\n- FYI: [info]\n\nEmails:\n" + emailText}] }) });
      summary = claudeResp.data?.content?.[0]?.text || summary;
    }
    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-US", {hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Denver"});
    return { success: true, time: timeStr, summary, had_emails: emailText.length > 50, logs };
  } catch (e) { return { success: false, error: e.message, logs }; }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/' || req.url === '/health') { res.end(JSON.stringify({status: "ok", service: "email-craft"})); }
  else if (req.url === '/run') { res.end(JSON.stringify(await checkEmails())); }
  else { res.statusCode = 404; res.end('{"error":"Not found"}'); }
});

server.listen(process.env.PORT || 8080, () => console.log("Running on " + (process.env.PORT || 8080)));
