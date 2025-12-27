// Chrome Control MCP - Remote browser control via WebSocket agent
const API_KEY = "30e198cf037ffd6accc4aa739e6d9b448e23aa67cd4070503eb06c0acb5235be";

function checkAuth(request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") || request.headers.get("X-API-Key");
  return key === API_KEY;
}

const TOOLS = [
  { name: "open_url", description: "Open a URL in Chrome", inputSchema: { type: "object", properties: { url: { type: "string" }, new_tab: { type: "boolean", default: true } }, required: ["url"] } },
  { name: "get_current_tab", description: "Get current active tab", inputSchema: { type: "object", properties: {} } },
  { name: "list_tabs", description: "List all open tabs", inputSchema: { type: "object", properties: { window_id: { type: "number" } } } },
  { name: "close_tab", description: "Close a tab", inputSchema: { type: "object", properties: { tab_id: { type: "number" } }, required: ["tab_id"] } },
  { name: "switch_to_tab", description: "Switch to a tab", inputSchema: { type: "object", properties: { tab_id: { type: "number" } }, required: ["tab_id"] } },
  { name: "reload_tab", description: "Reload a tab", inputSchema: { type: "object", properties: { tab_id: { type: "number" } } } },
  { name: "go_back", description: "Navigate back", inputSchema: { type: "object", properties: { tab_id: { type: "number" } } } },
  { name: "go_forward", description: "Navigate forward", inputSchema: { type: "object", properties: { tab_id: { type: "number" } } } },
  { name: "execute_javascript", description: "Execute JS in tab", inputSchema: { type: "object", properties: { code: { type: "string" }, tab_id: { type: "number" } }, required: ["code"] } },
  { name: "get_page_content", description: "Get page content", inputSchema: { type: "object", properties: { tab_id: { type: "number" } } } }
];

export class ChromeAgent {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.agentSocket = null;
    this.pendingRequests = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/agent" && request.headers.get("Upgrade") === "websocket") return this.handleAgentConnection(request);
    if (url.pathname === "/execute" && request.method === "POST") return this.executeCommand(request);
    if (url.pathname === "/status") return new Response(JSON.stringify({ connected: this.agentSocket !== null, pendingRequests: this.pendingRequests.size }), { headers: { "Content-Type": "application/json" } });
    return new Response("Not found", { status: 404 });
  }

  handleAgentConnection(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.agentSocket = server;
    server.accept();
    
    server.addEventListener("message", (event) => {
      try {
        const response = JSON.parse(event.data);
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          pending.resolve(response);
          this.pendingRequests.delete(response.id);
        }
      } catch (e) {
        console.error("Parse error:", e);
      }
    });
    
    server.addEventListener("close", () => {
      this.agentSocket = null;
      for (const [id, pending] of this.pendingRequests) {
        pending.reject(new Error("Agent disconnected"));
        this.pendingRequests.delete(id);
      }
    });
    
    server.addEventListener("error", (e) => console.error("WebSocket error:", e));
    return new Response(null, { status: 101, webSocket: client });
  }

  async executeCommand(request) {
    if (!this.agentSocket) return new Response(JSON.stringify({ error: "Agent not connected" }), { status: 503, headers: { "Content-Type": "application/json" } });
    const { tool, args } = await request.json();
    const id = crypto.randomUUID();
    
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        resolve(new Response(JSON.stringify({ error: "Timeout" }), { status: 504, headers: { "Content-Type": "application/json" } }));
      }, 30000);
      
      this.pendingRequests.set(id, {
        resolve: (response) => {
          clearTimeout(timeout);
          resolve(new Response(JSON.stringify(response), { headers: { "Content-Type": "application/json" } }));
        },
        reject: (error) => {
          clearTimeout(timeout);
          resolve(new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } }));
        }
      });
      this.agentSocket.send(JSON.stringify({ id, tool, args }));
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-API-Key" };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    
    const agentId = env.CHROME_AGENT.idFromName("default");
    const agent = env.CHROME_AGENT.get(agentId);
    
    if (url.pathname === "/agent") {
      if (!checkAuth(request)) return new Response("Unauthorized", { status: 401, headers: cors });
      return agent.fetch(request);
    }
    
    if (url.pathname === "/mcp" && request.method === "POST") {
      if (!checkAuth(request)) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
      
      const body = await request.json();
      const { method, params, id: reqId } = body;
      let result;
      
      switch (method) {
        case "initialize":
          result = { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "chrome-control-remote", version: "1.0.0" } };
          break;
        case "tools/list":
          result = { tools: TOOLS };
          break;
        case "tools/call":
          const { name, arguments: args } = params;
          const execRes = await agent.fetch(new Request("http://internal/execute", { method: "POST", body: JSON.stringify({ tool: name, args }) }));
          const execResult = await execRes.json();
          result = execResult.error ? { content: [{ type: "text", text: `Error: ${execResult.error}` }], isError: true } : execResult.result;
          break;
        default:
          return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32601, message: "Method not found" }, id: reqId }), { headers: { ...cors, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", result, id: reqId }), { headers: { ...cors, "Content-Type": "application/json" } });
    }
    
    if (url.pathname === "/") {
      const statusRes = await agent.fetch(new Request("http://internal/status"));
      const status = await statusRes.json();
      return new Response(`<html><body style="font-family:system-ui;padding:2rem"><h1>🔐 Chrome Control MCP</h1><p>Agent: ${status.connected ? "✅" : "❌"}</p></body></html>`, { headers: { ...cors, "Content-Type": "text/html" } });
    }
    
    return new Response("Not found", { status: 404, headers: cors });
  }
};
