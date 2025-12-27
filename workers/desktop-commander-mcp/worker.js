// Desktop Commander MCP - Remote file/process control via WebSocket agent
const API_KEY = "30e198cf037ffd6accc4aa739e6d9b448e23aa67cd4070503eb06c0acb5235be";

function checkAuth(request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") || request.headers.get("X-API-Key");
  return key === API_KEY;
}

const TOOLS = [
  { name: "get_config", description: "Get server configuration", inputSchema: { type: "object", properties: {} } },
  { name: "read_file", description: "Read file contents", inputSchema: { type: "object", properties: { path: { type: "string" }, offset: { type: "number" }, length: { type: "number" } }, required: ["path"] } },
  { name: "read_multiple_files", description: "Read multiple files", inputSchema: { type: "object", properties: { paths: { type: "array", items: { type: "string" } } }, required: ["paths"] } },
  { name: "write_file", description: "Write file contents", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, mode: { type: "string", enum: ["rewrite", "append"] } }, required: ["path", "content"] } },
  { name: "create_directory", description: "Create directory", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "list_directory", description: "List directory contents", inputSchema: { type: "object", properties: { path: { type: "string" }, depth: { type: "number" } }, required: ["path"] } },
  { name: "move_file", description: "Move or rename file", inputSchema: { type: "object", properties: { source: { type: "string" }, destination: { type: "string" } }, required: ["source", "destination"] } },
  { name: "get_file_info", description: "Get file metadata", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "edit_block", description: "Find and replace in file", inputSchema: { type: "object", properties: { file_path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" } }, required: ["file_path"] } },
  { name: "start_process", description: "Start terminal process", inputSchema: { type: "object", properties: { command: { type: "string" }, timeout_ms: { type: "number" } }, required: ["command", "timeout_ms"] } },
  { name: "read_process_output", description: "Read process output", inputSchema: { type: "object", properties: { pid: { type: "number" } }, required: ["pid"] } },
  { name: "interact_with_process", description: "Send input to process", inputSchema: { type: "object", properties: { pid: { type: "number" }, input: { type: "string" } }, required: ["pid", "input"] } },
  { name: "force_terminate", description: "Terminate process", inputSchema: { type: "object", properties: { pid: { type: "number" } }, required: ["pid"] } },
  { name: "list_sessions", description: "List terminal sessions", inputSchema: { type: "object", properties: {} } },
  { name: "list_processes", description: "List running processes", inputSchema: { type: "object", properties: {} } },
  { name: "kill_process", description: "Kill process by PID", inputSchema: { type: "object", properties: { pid: { type: "number" } }, required: ["pid"] } },
  { name: "start_search", description: "Search files or content", inputSchema: { type: "object", properties: { path: { type: "string" }, pattern: { type: "string" }, searchType: { type: "string", enum: ["files", "content"] } }, required: ["path", "pattern"] } }
];

export class DesktopCommanderAgent {
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
        console.error("Failed to parse agent message:", e);
      }
    });
    
    server.addEventListener("close", () => {
      this.agentSocket = null;
      for (const [id, pending] of this.pendingRequests) {
        pending.reject(new Error("Agent disconnected"));
        this.pendingRequests.delete(id);
      }
    });
    
    server.addEventListener("error", (e) => console.error("Agent WebSocket error:", e));
    return new Response(null, { status: 101, webSocket: client });
  }

  async executeCommand(request) {
    if (!this.agentSocket) {
      return new Response(JSON.stringify({ error: "Local agent not connected. Start the agent on your Mac." }), { status: 503, headers: { "Content-Type": "application/json" } });
    }
    const { tool, args } = await request.json();
    const id = crypto.randomUUID();
    
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        resolve(new Response(JSON.stringify({ error: "Command timed out (60s)" }), { status: 504, headers: { "Content-Type": "application/json" } }));
      }, 60000);
      
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
    
    const agentId = env.DC_AGENT.idFromName("default");
    const agent = env.DC_AGENT.get(agentId);
    
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
          result = { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "desktop-commander-remote", version: "1.0.0" } };
          break;
        case "tools/list":
          result = { tools: TOOLS };
          break;
        case "tools/call":
          const { name, arguments: args } = params;
          const execResponse = await agent.fetch(new Request("http://internal/execute", { method: "POST", body: JSON.stringify({ tool: name, args }) }));
          const execResult = await execResponse.json();
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
      return new Response(`<html><body style="font-family:system-ui;padding:2rem"><h1>🔐 Desktop Commander MCP</h1><p>Agent: ${status.connected ? "✅" : "❌"}</p></body></html>`, { headers: { ...cors, "Content-Type": "text/html" } });
    }
    
    return new Response("Not found", { status: 404, headers: cors });
  }
};
