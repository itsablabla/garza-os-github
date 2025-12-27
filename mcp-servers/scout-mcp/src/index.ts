import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

const SCOUT_API_KEY = "uUQVQIPOTGZWw0plrLP1";
const SCOUT_API_BASE = "https://scoutapm.com/api/v2";

async function scoutFetch(endpoint: string) {
  const response = await fetch(`${SCOUT_API_BASE}${endpoint}`, {
    headers: {
      "Authorization": `Bearer ${SCOUT_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
  return response.json();
}

export class ScoutMCP extends McpAgent {
  server = new McpServer({
    name: "Scout APM Monitor",
    version: "1.0.0",
  });

  async init() {
    // List all Scout APM applications
    this.server.tool(
      "scout_list_apps",
      { active_since: z.string().optional().describe("ISO 8601 datetime to filter apps active since") },
      async ({ active_since }) => {
        try {
          let endpoint = "/apps";
          if (active_since) endpoint += `?active_since=${active_since}`;
          const data = await scoutFetch(endpoint);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        } catch (e: any) {
          return { content: [{ type: "text", text: `Error: ${e.message}` }] };
        }
      }
    );

    // Get app metrics
    this.server.tool(
      "scout_get_app_metrics",
      {
        app_id: z.number().describe("Application ID"),
        metric: z.string().describe("Metric name (response_time, throughput, etc)"),
        from_: z.string().describe("Start datetime ISO 8601"),
        to: z.string().describe("End datetime ISO 8601"),
      },
      async ({ app_id, metric, from_, to }) => {
        try {
          const endpoint = `/apps/${app_id}/metrics/${metric}?from=${from_}&to=${to}`;
          const data = await scoutFetch(endpoint);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        } catch (e: any) {
          return { content: [{ type: "text", text: `Error: ${e.message}` }] };
        }
      }
    );

    // Get app endpoints
    this.server.tool(
      "scout_get_app_endpoints",
      {
        app_id: z.number().describe("Application ID"),
        from_: z.string().describe("Start datetime ISO 8601"),
        to: z.string().describe("End datetime ISO 8601"),
      },
      async ({ app_id, from_, to }) => {
        try {
          const endpoint = `/apps/${app_id}/endpoints?from=${from_}&to=${to}`;
          const data = await scoutFetch(endpoint);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        } catch (e: any) {
          return { content: [{ type: "text", text: `Error: ${e.message}` }] };
        }
      }
    );

    // Get endpoint traces
    this.server.tool(
      "scout_get_endpoint_traces",
      {
        app_id: z.number().describe("Application ID"),
        endpoint_id: z.string().describe("Endpoint ID"),
        from_: z.string().describe("Start datetime ISO 8601"),
        to: z.string().describe("End datetime ISO 8601"),
      },
      async ({ app_id, endpoint_id, from_, to }) => {
        try {
          const endpoint = `/apps/${app_id}/endpoints/${endpoint_id}/traces?from=${from_}&to=${to}`;
          const data = await scoutFetch(endpoint);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        } catch (e: any) {
          return { content: [{ type: "text", text: `Error: ${e.message}` }] };
        }
      }
    );

    // Get individual trace
    this.server.tool(
      "scout_get_trace",
      {
        app_id: z.number().describe("Application ID"),
        trace_id: z.number().describe("Trace ID"),
      },
      async ({ app_id, trace_id }) => {
        try {
          const endpoint = `/apps/${app_id}/traces/${trace_id}`;
          const data = await scoutFetch(endpoint);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        } catch (e: any) {
          return { content: [{ type: "text", text: `Error: ${e.message}` }] };
        }
      }
    );

    // Get error groups
    this.server.tool(
      "scout_get_error_groups",
      {
        app_id: z.number().describe("Application ID"),
        from_: z.string().describe("Start datetime ISO 8601"),
        to: z.string().describe("End datetime ISO 8601"),
        endpoint_id: z.string().optional().describe("Filter by endpoint"),
      },
      async ({ app_id, from_, to, endpoint_id }) => {
        try {
          let endpoint = `/apps/${app_id}/errors?from=${from_}&to=${to}`;
          if (endpoint_id) endpoint += `&endpoint_id=${endpoint_id}`;
          const data = await scoutFetch(endpoint);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        } catch (e: any) {
          return { content: [{ type: "text", text: `Error: ${e.message}` }] };
        }
      }
    );

    // Get performance insights (N+1, memory bloat, slow queries)
    this.server.tool(
      "scout_get_insights",
      {
        app_id: z.number().describe("Application ID"),
        insight_type: z.string().optional().describe("Filter: n_plus_one, memory_bloat, slow_query"),
        limit: z.number().optional().describe("Max items per type (default 20)"),
      },
      async ({ app_id, insight_type, limit }) => {
        try {
          let endpoint = `/apps/${app_id}/insights`;
          const params = [];
          if (insight_type) params.push(`type=${insight_type}`);
          if (limit) params.push(`limit=${limit}`);
          if (params.length) endpoint += `?${params.join("&")}`;
          const data = await scoutFetch(endpoint);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        } catch (e: any) {
          return { content: [{ type: "text", text: `Error: ${e.message}` }] };
        }
      }
    );
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return ScoutMCP.serveSSE("/sse").fetch(request, env, ctx);
    }

    if (url.pathname === "/mcp") {
      return ScoutMCP.serve("/mcp").fetch(request, env, ctx);
    }

    return new Response("Scout APM MCP Server - Use /sse or /mcp endpoints", { status: 200 });
  },
};
