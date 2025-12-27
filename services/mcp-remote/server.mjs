import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";

const execAsync = promisify(exec);
const PORT = process.env.PORT || 3333;
const API_KEY = process.env.MCP_API_KEY || "garza-remote-" + Math.random().toString(36).slice(2);

const app = express();
const transports = new Map();

// Simple API key auth middleware - accepts header OR query param
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const queryKey = req.query.key;
  
  if (authHeader === `Bearer ${API_KEY}` || queryKey === API_KEY) {
    return next();
  }
  return res.status(401).json({ error: "Unauthorized" });
};

// Create MCP server instance
function createMcpServer() {
  const server = new McpServer({
    name: "garza-remote-mcp",
    version: "1.0.0",
  });

  // Tool: Execute shell command
  server.tool(
    "execute_command",
    "Execute a shell command on the remote Mac",
    {
      command: { type: "string", description: "The shell command to execute" },
      timeout_ms: { type: "number", description: "Timeout in milliseconds", default: 30000 }
    },
    async ({ command, timeout_ms = 30000 }) => {
      try {
        const { stdout, stderr } = await execAsync(command, { 
          timeout: timeout_ms,
          maxBuffer: 10 * 1024 * 1024,
          shell: "/bin/zsh"
        });
        return { content: [{ type: "text", text: stdout + (stderr ? `\nSTDERR: ${stderr}` : "") }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}\n${error.stderr || ""}` }] };
      }
    }
  );

  // Tool: Read file
  server.tool(
    "read_file",
    "Read contents of a file",
    {
      path: { type: "string", description: "Path to the file" }
    },
    async ({ path: filePath }) => {
      try {
        const content = await fs.readFile(filePath, "utf-8");
        return { content: [{ type: "text", text: content }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error reading file: ${error.message}` }] };
      }
    }
  );

  // Tool: Write file
  server.tool(
    "write_file",
    "Write content to a file",
    {
      path: { type: "string", description: "Path to the file" },
      content: { type: "string", description: "Content to write" }
    },
    async ({ path: filePath, content }) => {
      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content);
        return { content: [{ type: "text", text: `Successfully wrote to ${filePath}` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error writing file: ${error.message}` }] };
      }
    }
  );

  // Tool: List directory
  server.tool(
    "list_directory",
    "List contents of a directory",
    {
      path: { type: "string", description: "Path to the directory" }
    },
    async ({ path: dirPath }) => {
      try {
        const items = await fs.readdir(dirPath, { withFileTypes: true });
        const listing = items.map(item => 
          `${item.isDirectory() ? "[DIR]" : "[FILE]"} ${item.name}`
        ).join("\n");
        return { content: [{ type: "text", text: listing }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error listing directory: ${error.message}` }] };
      }
    }
  );

  return server;
}

// SSE endpoint for MCP
app.get("/sse", authMiddleware, async (req, res) => {
  console.log("New SSE connection");
  
  const transport = new SSEServerTransport("/messages", res);
  const server = createMcpServer();
  
  const sessionId = Math.random().toString(36).slice(2);
  transports.set(sessionId, { transport, server });
  
  res.on("close", () => {
    console.log("SSE connection closed");
    transports.delete(sessionId);
  });
  
  await server.connect(transport);
});

// Messages endpoint for MCP
app.post("/messages", express.json(), authMiddleware, async (req, res) => {
  // Find the transport for this session
  for (const [id, { transport }] of transports) {
    try {
      await transport.handlePostMessage(req, res);
      return;
    } catch (e) {
      continue;
    }
  }
  res.status(404).json({ error: "No active session" });
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", server: "garza-remote-mcp" });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 Garza Remote MCP Server running on port ${PORT}`);
  console.log(`\n📡 Connect URL: http://45.147.93.59:${PORT}/sse`);
  console.log(`🔑 API Key: ${API_KEY}`);
  console.log(`\nAdd to your MCP client config:`);
  console.log(JSON.stringify({
    "garza-mac": {
      "transport": "sse",
      "url": `http://45.147.93.59:${PORT}/sse`,
      "headers": {
        "Authorization": `Bearer ${API_KEY}`
      }
    }
  }, null, 2));
});
