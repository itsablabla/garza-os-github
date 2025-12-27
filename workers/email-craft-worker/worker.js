// Email to Craft Worker
const ZAPIER_MCP_URL = "https://mcp.zapier.com/api/mcp/a/17598012/mcp";
const CRAFT_API_URL = "https://connect.craft.do/links/KvkWq8X8cFZ/api/v1/blocks/add";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(JSON.stringify({status: "ok", service: "email-craft", time: new Date().toISOString()}), {
        headers: {"Content-Type": "application/json"}
      });
    }
    
    if (url.pathname === "/run") {
      try {
        // Fetch emails via Zapier MCP
        const emailResp = await fetch(ZAPIER_MCP_URL, {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({
            jsonrpc: "2.0", id: 1, method: "tools/call",
            params: {name: "gmail_find_email", arguments: {instructions: "Find emails from last 15 min", output_hint: "subject, from, snippet", query: "newer_than:15m"}}
          })
        });
        const emailData = await emailResp.json();
        const emailText = emailData?.result?.content?.[0]?.text || "";
        
        let summary = "✅ No new emails in last 15 minutes";
        if (emailText) {
          // Summarize with Claude
          const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {"Content-Type": "application/json", "x-api-key": env.CLAUDE_API_KEY, "anthropic-version": "2023-06-01"},
            body: JSON.stringify({
              model: "claude-sonnet-4-20250514", max_tokens: 512,
              messages: [{role: "user", content: `Brief email summary:\n📧 Email Summary\n- 🔴 Urgent: [any urgent]\n- 📋 Action needed: [items]\n- ℹ️ FYI: [info]\n- 📊 Stats: X new emails\n\nEmails:\n${emailText}`}]
            })
          });
          const claudeData = await claudeResp.json();
          summary = claudeData?.content?.[0]?.text || summary;
        }
        
        // Post to Craft
        const now = new Date();
        const timeStr = now.toLocaleTimeString("en-US", {hour: "numeric", minute: "2-digit", hour12: true});
        const markdown = `## 📬 Email Check - ${timeStr}\n\n${summary}`;
        
        await fetch(CRAFT_API_URL, {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({position: {date: "today", position: "end"}, blocks: [{type: "text", markdown}]})
        });
        
        return new Response(JSON.stringify({success: true, had_emails: !!emailText, time: now.toISOString()}), {
          headers: {"Content-Type": "application/json"}
        });
      } catch (e) {
        return new Response(JSON.stringify({error: e.message}), {status: 500, headers: {"Content-Type": "application/json"}});
      }
    }
    
    return new Response("Not found", {status: 404});
  }
};
