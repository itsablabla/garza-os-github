import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import cors from "cors";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import net from "net";

const execAsync = promisify(exec);
const API_KEY = process.env.MCP_API_KEY || "computeruse2024garzahive";
const MAC_IP = "45.147.93.59";

// Fix PATH for Docker and other tools
process.env.PATH = `/usr/local/bin:/opt/homebrew/bin:${process.env.PATH}`;

// Known SSH hosts (from ~/.ssh/config)
const SSH_HOSTS = {
  "garzahive": { host: "64.227.106.134", user: "root", desc: "GarzaHive-02 (DigitalOcean SFO3)" },
  "garzahive-02": { host: "64.227.106.134", user: "root", desc: "GarzaHive-02 (alias)" },
  "vps": { host: "64.227.106.134", user: "root", desc: "GarzaHive-02 VPS (alias)" },
  "mac": { host: "ssh.garzahive.com", user: "customer", desc: "Remote Mac via CF Tunnel" },
  "boulder": { host: "boulder-ssh.garzahive.com", user: "jadengarza", desc: "Mac mini Boulder via CF Tunnel" }
};

const app = express();
app.use(cors());
app.use(express.json());

const transports = {};

// Container configs
const INSTANCES = {
  1: { name: "claude-computer-use-1", streamlit: 8501, vnc: 6080, vncPort: 5900 },
  2: { name: "claude-computer-use-2", streamlit: 8502, vnc: 6081, vncPort: 5901 }
};

function createServer() {
  const server = new Server(
    { name: "computer-use-mcp", version: "1.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "computer_use_status",
        description: "Get status of Claude Computer Use instances",
        inputSchema: {
          type: "object",
          properties: {
            instance: { type: "number", description: "Instance number (1 or 2), or omit for both" }
          }
        }
      },
      {
        name: "computer_use_logs",
        description: "Get logs from a Claude Computer Use instance",
        inputSchema: {
          type: "object",
          properties: {
            instance: { type: "number", description: "Instance number (1 or 2)", default: 1 },
            lines: { type: "number", description: "Number of log lines", default: 50 }
          },
          required: ["instance"]
        }
      },
      {
        name: "computer_use_restart",
        description: "Restart a Claude Computer Use instance",
        inputSchema: {
          type: "object",
          properties: {
            instance: { type: "number", description: "Instance number (1 or 2)" }
          },
          required: ["instance"]
        }
      },
      {
        name: "computer_use_stop",
        description: "Stop a Claude Computer Use instance",
        inputSchema: {
          type: "object",
          properties: {
            instance: { type: "number", description: "Instance number (1 or 2)" }
          },
          required: ["instance"]
        }
      },
      {
        name: "computer_use_start",
        description: "Start a Claude Computer Use instance",
        inputSchema: {
          type: "object",
          properties: {
            instance: { type: "number", description: "Instance number (1 or 2)" }
          },
          required: ["instance"]
        }
      },
      {
        name: "computer_use_urls",
        description: "Get access URLs for Claude Computer Use instances",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "docker_exec",
        description: "Execute a command inside a Computer Use container (DISPLAY=:1 auto-set)",
        inputSchema: {
          type: "object",
          properties: {
            instance: { type: "number", description: "Instance number (1 or 2)" },
            command: { type: "string", description: "Command to run inside container" }
          },
          required: ["instance", "command"]
        }
      },
      {
        name: "browser_open",
        description: "Open a URL in Firefox inside the container",
        inputSchema: {
          type: "object",
          properties: {
            instance: { type: "number", description: "Instance number (1 or 2)" },
            url: { type: "string", description: "URL to open" }
          },
          required: ["instance", "url"]
        }
      },
      {
        name: "browser_screenshot",
        description: "Take a screenshot of the container desktop",
        inputSchema: {
          type: "object",
          properties: {
            instance: { type: "number", description: "Instance number (1 or 2)" },
            filename: { type: "string", description: "Output filename (default: screenshot.png)" }
          },
          required: ["instance"]
        }
      },
      {
        name: "browser_type",
        description: "Type text in the container (using xdotool)",
        inputSchema: {
          type: "object",
          properties: {
            instance: { type: "number", description: "Instance number (1 or 2)" },
            text: { type: "string", description: "Text to type" }
          },
          required: ["instance", "text"]
        }
      },
      {
        name: "browser_key",
        description: "Send keyboard keys (Return, Escape, ctrl+l, etc.)",
        inputSchema: {
          type: "object",
          properties: {
            instance: { type: "number", description: "Instance number (1 or 2)" },
            keys: { type: "string", description: "Keys to send (e.g., 'Return', 'ctrl+l', 'Escape')" }
          },
          required: ["instance", "keys"]
        }
      },
      {
        name: "browser_click",
        description: "Click at coordinates or current mouse position",
        inputSchema: {
          type: "object",
          properties: {
            instance: { type: "number", description: "Instance number (1 or 2)" },
            x: { type: "number", description: "X coordinate (optional)" },
            y: { type: "number", description: "Y coordinate (optional)" },
            button: { type: "number", description: "Mouse button (1=left, 2=middle, 3=right)", default: 1 }
          },
          required: ["instance"]
        }
      },
      {
        name: "protect_server_status",
        description: "Check UniFi Protect Vision server status",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "protect_server_logs",
        description: "Get Protect Vision server logs",
        inputSchema: {
          type: "object",
          properties: {
            lines: { type: "number", description: "Number of log lines", default: 50 }
          }
        }
      },
      {
        name: "protect_server_restart",
        description: "Restart Protect Vision server",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "protect_server_stop",
        description: "Stop Protect Vision server",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "protect_server_start",
        description: "Start Protect Vision server",
        inputSchema: { type: "object", properties: {} }
      }
    ]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      return await handleTool(name, args);
    } catch (error) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
  });

  return server;
}

// Unified tool handler
async function handleTool(name, args) {
  switch (name) {
    case "computer_use_status": {
      const inst = args?.instance;
      if (inst && INSTANCES[inst]) {
        const { stdout } = await execAsync(`docker inspect --format='{{.State.Status}}' ${INSTANCES[inst].name}`);
        return { content: [{ type: "text", text: `Instance ${inst} (${INSTANCES[inst].name}): ${stdout.trim()}` }] };
      }
      const { stdout } = await execAsync(`docker ps -a --filter "name=claude-computer-use" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"`);
      return { content: [{ type: "text", text: stdout }] };
    }
    
    case "computer_use_logs": {
      const { instance, lines = 50 } = args;
      if (!INSTANCES[instance]) throw new Error("Invalid instance. Use 1 or 2.");
      const { stdout, stderr } = await execAsync(`docker logs --tail ${lines} ${INSTANCES[instance].name}`);
      return { content: [{ type: "text", text: stdout || stderr || "No logs" }] };
    }
    
    case "computer_use_restart": {
      const { instance } = args;
      if (!INSTANCES[instance]) throw new Error("Invalid instance. Use 1 or 2.");
      await execAsync(`docker restart ${INSTANCES[instance].name}`);
      return { content: [{ type: "text", text: `Instance ${instance} restarted successfully` }] };
    }
    
    case "computer_use_stop": {
      const { instance } = args;
      if (!INSTANCES[instance]) throw new Error("Invalid instance. Use 1 or 2.");
      await execAsync(`docker stop ${INSTANCES[instance].name}`);
      return { content: [{ type: "text", text: `Instance ${instance} stopped` }] };
    }
    
    case "computer_use_start": {
      const { instance } = args;
      if (!INSTANCES[instance]) throw new Error("Invalid instance. Use 1 or 2.");
      await execAsync(`docker start ${INSTANCES[instance].name}`);
      return { content: [{ type: "text", text: `Instance ${instance} started` }] };
    }
    
    case "computer_use_urls": {
      const urls = `Claude Computer Use Access URLs:

Instance 1:
  - Streamlit UI: https://computer1.garzahive.com
  - VNC (noVNC): https://vnc1.garzahive.com
  - Local: http://${MAC_IP}:8501

Instance 2:
  - Streamlit UI: https://computer2.garzahive.com
  - VNC (noVNC): https://vnc2.garzahive.com
  - Local: http://${MAC_IP}:8502`;
      return { content: [{ type: "text", text: urls }] };
    }
    
    case "docker_exec": {
      const { instance, command } = args;
      if (!INSTANCES[instance]) throw new Error("Invalid instance. Use 1 or 2.");
      // Wrap command with bash and DISPLAY set
      const wrappedCmd = `docker exec ${INSTANCES[instance].name} bash -c "export DISPLAY=:1 && ${command.replace(/"/g, '\\"')}"`;
      const { stdout, stderr } = await execAsync(wrappedCmd, { timeout: 30000 });
      return { content: [{ type: "text", text: stdout || stderr || "Done" }] };
    }
    
    // Browser convenience tools
    case "browser_open": {
      const { instance, url } = args;
      if (!INSTANCES[instance]) throw new Error("Invalid instance. Use 1 or 2.");
      await execAsync(`docker exec -d ${INSTANCES[instance].name} bash -c "export DISPLAY=:1 && firefox-esr '${url}' &"`, { timeout: 10000 });
      return { content: [{ type: "text", text: `Opening ${url} in Firefox on instance ${instance}` }] };
    }
    
    case "browser_screenshot": {
      const { instance, filename = "screenshot.png" } = args;
      if (!INSTANCES[instance]) throw new Error("Invalid instance. Use 1 or 2.");
      const filepath = `/tmp/${filename}`;
      await execAsync(`docker exec ${INSTANCES[instance].name} bash -c "export DISPLAY=:1 && scrot ${filepath}"`, { timeout: 10000 });
      const { stdout } = await execAsync(`docker exec ${INSTANCES[instance].name} ls -la ${filepath}`);
      return { content: [{ type: "text", text: `Screenshot saved: ${stdout.trim()}` }] };
    }
    
    case "browser_type": {
      const { instance, text } = args;
      if (!INSTANCES[instance]) throw new Error("Invalid instance. Use 1 or 2.");
      await execAsync(`docker exec ${INSTANCES[instance].name} bash -c "export DISPLAY=:1 && xdotool type '${text.replace(/'/g, "'\\''")}'"`, { timeout: 10000 });
      return { content: [{ type: "text", text: `Typed: ${text}` }] };
    }
    
    case "browser_key": {
      const { instance, keys } = args;
      if (!INSTANCES[instance]) throw new Error("Invalid instance. Use 1 or 2.");
      await execAsync(`docker exec ${INSTANCES[instance].name} bash -c "export DISPLAY=:1 && xdotool key ${keys}"`, { timeout: 10000 });
      return { content: [{ type: "text", text: `Sent keys: ${keys}` }] };
    }
    
    case "browser_click": {
      const { instance, x, y, button = 1 } = args;
      if (!INSTANCES[instance]) throw new Error("Invalid instance. Use 1 or 2.");
      let cmd = `export DISPLAY=:1 && `;
      if (x !== undefined && y !== undefined) {
        cmd += `xdotool mousemove ${x} ${y} && `;
      }
      cmd += `xdotool click ${button}`;
      await execAsync(`docker exec ${INSTANCES[instance].name} bash -c "${cmd}"`, { timeout: 10000 });
      return { content: [{ type: "text", text: x !== undefined ? `Clicked at (${x}, ${y})` : `Clicked button ${button}` }] };
    }
    
    case "protect_server_status": {
      const ps = await execAsync("ps aux | grep protect-vision-server | grep -v grep").catch(() => ({ stdout: "" }));
      const health = await fetch("http://localhost:3847/health").then(r => r.json()).catch(e => ({ error: e.message }));
      const running = ps.stdout.includes("protect-vision-server");
      return { content: [{ type: "text", text: JSON.stringify({ running, health, port: 3847, pid: running ? ps.stdout.match(/\s+(\d+)\s+/)?.[1] : null }, null, 2) }] };
    }
    
    case "protect_server_logs": {
      const lines = args?.lines || 50;
      const { stdout, stderr } = await execAsync(`cat /Users/customer/Projects/protect-vision-server/logs/*.log 2>/dev/null | tail -${lines}`).catch(() => ({ stdout: "", stderr: "" }));
      return { content: [{ type: "text", text: stdout || stderr || "No logs found" }] };
    }
    
    case "protect_server_restart": {
      await execAsync("pkill -f protect-vision-server || true");
      await new Promise(r => setTimeout(r, 1000));
      await execAsync("cd /Users/customer/Projects/protect-vision-server && nohup node server.js >> logs/server.log 2>&1 &");
      await new Promise(r => setTimeout(r, 2000));
      const ps = await execAsync("ps aux | grep protect-vision-server | grep -v grep").catch(() => ({ stdout: "" }));
      return { content: [{ type: "text", text: JSON.stringify({ success: ps.stdout.includes("protect-vision-server"), message: "Server restarted" }, null, 2) }] };
    }
    
    case "protect_server_stop": {
      await execAsync("pkill -f protect-vision-server || true");
      return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Server stopped" }, null, 2) }] };
    }
    
    case "protect_server_start": {
      const existing = await execAsync("ps aux | grep protect-vision-server | grep -v grep").catch(() => ({ stdout: "" }));
      if (existing.stdout.includes("protect-vision-server")) {
        return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Already running" }, null, 2) }] };
      }
      await execAsync("cd /Users/customer/Projects/protect-vision-server && nohup node server.js >> logs/server.log 2>&1 &");
      await new Promise(r => setTimeout(r, 2000));
      const ps = await execAsync("ps aux | grep protect-vision-server | grep -v grep").catch(() => ({ stdout: "" }));
      return { content: [{ type: "text", text: JSON.stringify({ success: ps.stdout.includes("protect-vision-server"), message: "Server started" }, null, 2) }] };
    }
    
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Direct tool execution result helper
async function handleToolDirect(name, args) {
  switch (name) {
    case "computer_use_status": {
      const inst = args?.instance;
      if (inst && INSTANCES[inst]) {
        const { stdout } = await execAsync(`docker inspect --format='{{.State.Status}}' ${INSTANCES[inst].name}`);
        return { status: stdout.trim(), instance: inst, container: INSTANCES[inst].name };
      }
      const { stdout } = await execAsync(`docker ps -a --filter "name=claude-computer-use" --format "{{.Names}}\\t{{.Status}}"`);
      return { containers: stdout.trim() };
    }
    case "computer_use_logs": {
      const { instance, lines = 50 } = args || {};
      if (!INSTANCES[instance]) throw new Error("Invalid instance. Use 1 or 2.");
      const { stdout, stderr } = await execAsync(`docker logs --tail ${lines} ${INSTANCES[instance].name}`);
      return { logs: stdout || stderr || "No logs" };
    }
    case "computer_use_restart": {
      const { instance } = args || {};
      if (!INSTANCES[instance]) throw new Error("Invalid instance. Use 1 or 2.");
      await execAsync(`docker restart ${INSTANCES[instance].name}`);
      return { success: true, message: `Instance ${instance} restarted` };
    }
    case "computer_use_stop": {
      const { instance } = args || {};
      if (!INSTANCES[instance]) throw new Error("Invalid instance. Use 1 or 2.");
      await execAsync(`docker stop ${INSTANCES[instance].name}`);
      return { success: true, message: `Instance ${instance} stopped` };
    }
    case "computer_use_start": {
      const { instance } = args || {};
      if (!INSTANCES[instance]) throw new Error("Invalid instance. Use 1 or 2.");
      await execAsync(`docker start ${INSTANCES[instance].name}`);
      return { success: true, message: `Instance ${instance} started` };
    }
    case "computer_use_urls": {
      return {
        instance1: {
          streamlit: "https://computer1.garzahive.com",
          vnc: "https://vnc1.garzahive.com",
          local: `http://${MAC_IP}:8501`
        },
        instance2: {
          streamlit: "https://computer2.garzahive.com",
          vnc: "https://vnc2.garzahive.com",
          local: `http://${MAC_IP}:8502`
        }
      };
    }
    case "docker_exec": {
      const { instance, command } = args || {};
      if (!INSTANCES[instance]) throw new Error("Invalid instance. Use 1 or 2.");
      // Wrap command with bash and DISPLAY set
      const wrappedCmd = `docker exec ${INSTANCES[instance].name} bash -c "export DISPLAY=:1 && ${command.replace(/"/g, '\\"')}"`;
      const { stdout, stderr } = await execAsync(wrappedCmd, { timeout: 30000 });
      return { output: stdout || stderr || "Done" };
    }
    
    // Browser convenience tools
    case "browser_open": {
      const { instance, url } = args || {};
      if (!INSTANCES[instance]) throw new Error("Invalid instance. Use 1 or 2.");
      await execAsync(`docker exec -d ${INSTANCES[instance].name} bash -c "export DISPLAY=:1 && firefox-esr '${url}' &"`, { timeout: 10000 });
      return { success: true, message: `Opening ${url}`, instance };
    }
    
    case "browser_screenshot": {
      const { instance, filename = "screenshot.png" } = args || {};
      if (!INSTANCES[instance]) throw new Error("Invalid instance. Use 1 or 2.");
      const filepath = `/tmp/${filename}`;
      await execAsync(`docker exec ${INSTANCES[instance].name} bash -c "export DISPLAY=:1 && scrot ${filepath}"`, { timeout: 10000 });
      const { stdout } = await execAsync(`docker exec ${INSTANCES[instance].name} ls -la ${filepath}`);
      return { success: true, file: stdout.trim() };
    }
    
    case "browser_type": {
      const { instance, text } = args || {};
      if (!INSTANCES[instance]) throw new Error("Invalid instance. Use 1 or 2.");
      await execAsync(`docker exec ${INSTANCES[instance].name} bash -c "export DISPLAY=:1 && xdotool type '${text.replace(/'/g, "'\\''")}'"`, { timeout: 10000 });
      return { success: true, typed: text };
    }
    
    case "browser_key": {
      const { instance, keys } = args || {};
      if (!INSTANCES[instance]) throw new Error("Invalid instance. Use 1 or 2.");
      await execAsync(`docker exec ${INSTANCES[instance].name} bash -c "export DISPLAY=:1 && xdotool key ${keys}"`, { timeout: 10000 });
      return { success: true, keys };
    }
    
    case "browser_click": {
      const { instance, x, y, button = 1 } = args || {};
      if (!INSTANCES[instance]) throw new Error("Invalid instance. Use 1 or 2.");
      let cmd = `export DISPLAY=:1 && `;
      if (x !== undefined && y !== undefined) {
        cmd += `xdotool mousemove ${x} ${y} && `;
      }
      cmd += `xdotool click ${button}`;
      await execAsync(`docker exec ${INSTANCES[instance].name} bash -c "${cmd}"`, { timeout: 10000 });
      return { success: true, x, y, button };
    }
    
    // SSH Tools
case "ssh_exec": {
      const { host, command, timeout = 30000 } = args || {};
      if (!host) throw new Error("Host is required");
      if (!command) throw new Error("Command is required");
      
      // If host is "mac", execute locally (we're on Mac)
      if (host === "mac") {
        const { stdout, stderr } = await execAsync(command, { timeout });
        return { 
          host: "mac (local)",
          hostInfo: SSH_HOSTS[host] || { desc: "Local execution" },
          output: stdout || stderr || "Done" 
        };
      }
      
      // For other hosts, use SSH with proper user@host format
      const hostInfo = SSH_HOSTS[host];
      let sshTarget;
      if (hostInfo) {
        sshTarget = `${hostInfo.user}@${hostInfo.host}`;
      } else {
        sshTarget = host;
      }
      
      const { stdout, stderr } = await execAsync(`ssh -i /Users/customer/.ssh/id_ed25519 -o ConnectTimeout=10 -o StrictHostKeyChecking=no ${sshTarget} "${command.replace(/"/g, '\\"')}"`, { timeout });
      return { 
        host: host,
        hostInfo: hostInfo || { desc: "Custom host" },
        output: stdout || stderr || "Done" 
      };
    }
    
    case "ssh_hosts": {
      return { 
        hosts: Object.entries(SSH_HOSTS).map(([alias, info]) => ({
          alias,
          ...info
        }))
      };
    }
    
    // Shell execution on local Mac
    case "shell_exec": {
      const { command, timeout = 30000, cwd } = args || {};
      if (!command) throw new Error("Command is required");
      
      const options = { timeout, maxBuffer: 10 * 1024 * 1024 };
      if (cwd) options.cwd = cwd;
      
      const { stdout, stderr } = await execAsync(command, options);
      return { output: stdout || stderr || "Done" };
    }
    
    // Telnet
    case "telnet_exec": {
      const { host, port = 23, commands, timeout = 10000 } = args || {};
      if (!host) throw new Error("Host is required");
      if (!commands || !Array.isArray(commands)) throw new Error("Commands array is required");
      
      return await new Promise((resolve, reject) => {
        const client = new net.Socket();
        let output = "";
        let commandIndex = 0;
        
        const timer = setTimeout(() => {
          client.destroy();
          resolve({ host, port, output, status: "timeout" });
        }, timeout);
        
        client.connect(port, host, () => {
          if (commands.length > 0) {
            setTimeout(() => {
              client.write(commands[commandIndex] + "\r\n");
              commandIndex++;
            }, 500);
          }
        });
        
        client.on("data", (data) => {
          output += data.toString();
          if (commandIndex < commands.length) {
            setTimeout(() => {
              client.write(commands[commandIndex] + "\r\n");
              commandIndex++;
            }, 200);
          } else if (commandIndex >= commands.length) {
            setTimeout(() => {
              clearTimeout(timer);
              client.destroy();
              resolve({ host, port, output, status: "completed" });
            }, 500);
          }
        });
        
        client.on("error", (err) => {
          clearTimeout(timer);
          reject(new Error(`Telnet error: ${err.message}`));
        });
        
        client.on("close", () => {
          clearTimeout(timer);
          resolve({ host, port, output, status: "closed" });
        });
      });
    }
    
    // Filesystem Tools (Desktop Commander compatible)
    case "fs_read_file": {
      const { path, offset = 0, length = 1000 } = args || {};
      if (!path) throw new Error("Path is required");
      
      const fs = await import('fs/promises');
      const pathModule = await import('path');
      const resolvedPath = pathModule.default.resolve(path);
      
      const stat = await fs.stat(resolvedPath);
      if (stat.isDirectory()) throw new Error("Cannot read a directory");
      
      const content = await fs.readFile(resolvedPath, 'utf-8');
      const lines = content.split('\n');
      
      let startLine, endLine;
      if (offset < 0) {
        // Negative offset = read from end
        startLine = Math.max(0, lines.length + offset);
        endLine = lines.length;
      } else {
        startLine = offset;
        endLine = Math.min(startLine + length, lines.length);
      }
      
      const selectedLines = lines.slice(startLine, endLine);
      return { 
        path: resolvedPath,
        content: selectedLines.join('\n'),
        totalLines: lines.length,
        linesReturned: selectedLines.length,
        startLine,
        endLine
      };
    }
    
    case "fs_write_file": {
      const { path, content, mode = "rewrite" } = args || {};
      if (!path) throw new Error("Path is required");
      if (content === undefined) throw new Error("Content is required");
      
      const fs = await import('fs/promises');
      const pathModule = await import('path');
      const resolvedPath = pathModule.default.resolve(path);
      
      if (mode === "append") {
        await fs.appendFile(resolvedPath, content);
      } else {
        await fs.writeFile(resolvedPath, content);
      }
      
      const stat = await fs.stat(resolvedPath);
      return { success: true, path: resolvedPath, size: stat.size, mode };
    }
    
    case "fs_list_directory": {
      const { path, depth = 2 } = args || {};
      if (!path) throw new Error("Path is required");
      
      const fs = await import('fs/promises');
      const pathModule = await import('path');
      const resolvedPath = pathModule.default.resolve(path);
      
      async function listDir(dir, currentDepth) {
        if (currentDepth > depth) return [];
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const results = [];
        
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue; // Skip hidden
          const fullPath = pathModule.default.join(dir, entry.name);
          const relPath = pathModule.default.relative(resolvedPath, fullPath);
          
          if (entry.isDirectory()) {
            results.push({ type: 'dir', path: relPath });
            if (currentDepth < depth) {
              try {
                const children = await listDir(fullPath, currentDepth + 1);
                results.push(...children);
              } catch (e) {
                results.push({ type: 'denied', path: relPath });
              }
            }
          } else {
            results.push({ type: 'file', path: relPath });
          }
        }
        return results;
      }
      
      const entries = await listDir(resolvedPath, 1);
      return { path: resolvedPath, entries, count: entries.length };
    }
    
    case "fs_create_directory": {
      const { path } = args || {};
      if (!path) throw new Error("Path is required");
      
      const fs = await import('fs/promises');
      const pathModule = await import('path');
      const resolvedPath = pathModule.default.resolve(path);
      
      await fs.mkdir(resolvedPath, { recursive: true });
      return { success: true, path: resolvedPath };
    }
    
    case "fs_move_file": {
      const { source, destination } = args || {};
      if (!source) throw new Error("Source is required");
      if (!destination) throw new Error("Destination is required");
      
      const fs = await import('fs/promises');
      const pathModule = await import('path');
      const srcPath = pathModule.default.resolve(source);
      const destPath = pathModule.default.resolve(destination);
      
      await fs.rename(srcPath, destPath);
      return { success: true, source: srcPath, destination: destPath };
    }
    
    case "fs_get_file_info": {
      const { path } = args || {};
      if (!path) throw new Error("Path is required");
      
      const fs = await import('fs/promises');
      const pathModule = await import('path');
      const resolvedPath = pathModule.default.resolve(path);
      
      const stat = await fs.stat(resolvedPath);
      const info = {
        path: resolvedPath,
        size: stat.size,
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
        created: stat.birthtime.toISOString(),
        modified: stat.mtime.toISOString(),
        permissions: stat.mode.toString(8)
      };
      
      if (stat.isFile()) {
        try {
          const content = await fs.readFile(resolvedPath, 'utf-8');
          const lines = content.split('\n');
          info.lineCount = lines.length;
          info.lastLine = lines.length - 1;
        } catch (e) {
          // Binary file
        }
      }
      
      return info;
    }
    
    case "fs_edit_block": {
      const { file_path, old_string, new_string = "", expected_replacements = 1 } = args || {};
      if (!file_path) throw new Error("file_path is required");
      if (!old_string) throw new Error("old_string is required");
      
      const fs = await import('fs/promises');
      const pathModule = await import('path');
      const resolvedPath = pathModule.default.resolve(file_path);
      
      let content = await fs.readFile(resolvedPath, 'utf-8');
      const matches = content.split(old_string).length - 1;
      
      if (matches === 0) {
        throw new Error(`String not found in file: "${old_string.substring(0, 50)}..."`);
      }
      
      if (matches !== expected_replacements) {
        throw new Error(`Expected ${expected_replacements} occurrence(s) but found ${matches}`);
      }
      
      content = content.split(old_string).join(new_string);
      await fs.writeFile(resolvedPath, content);
      
      return { success: true, path: resolvedPath, replacements: matches };
    }
    
    case "fs_delete_file": {
      const { path } = args || {};
      if (!path) throw new Error("Path is required");
      
      const fs = await import('fs/promises');
      const pathModule = await import('path');
      const resolvedPath = pathModule.default.resolve(path);
      
      await fs.rm(resolvedPath, { recursive: true });
      return { success: true, path: resolvedPath };
    }

    // UniFi Protect Vision Server Tools
    case "protect_server_status": {
      const ps = await execAsync("ps aux | grep protect-vision-server | grep -v grep").catch(() => ({ stdout: "" }));
      const health = await fetch("http://localhost:3847/health").then(r => r.json()).catch(e => ({ error: e.message }));
      const running = ps.stdout.includes("protect-vision-server");
      return { running, health, port: 3847, pid: running ? ps.stdout.match(/\s+(\d+)\s+/)?.[1] : null };
    }
    
    case "protect_server_logs": {
      const lines = args?.lines || 50;
      const { stdout, stderr } = await execAsync(`cat /Users/customer/Projects/protect-vision-server/logs/*.log 2>/dev/null | tail -${lines}`).catch(() => ({ stdout: "", stderr: "" }));
      return { logs: stdout || stderr || "No logs found" };
    }
    
    case "protect_server_restart": {
      await execAsync("pkill -f protect-vision-server || true");
      await new Promise(r => setTimeout(r, 1000));
      await execAsync("cd /Users/customer/Projects/protect-vision-server && nohup node server.js >> logs/server.log 2>&1 &");
      await new Promise(r => setTimeout(r, 2000));
      const ps = await execAsync("ps aux | grep protect-vision-server | grep -v grep").catch(() => ({ stdout: "" }));
      return { success: ps.stdout.includes("protect-vision-server"), message: "Server restarted" };
    }
    
    case "protect_server_stop": {
      await execAsync("pkill -f protect-vision-server || true");
      return { success: true, message: "Server stopped" };
    }
    
    case "protect_server_start": {
      const existing = await execAsync("ps aux | grep protect-vision-server | grep -v grep").catch(() => ({ stdout: "" }));
      if (existing.stdout.includes("protect-vision-server")) {
        return { success: true, message: "Already running" };
      }
      await execAsync("cd /Users/customer/Projects/protect-vision-server && nohup node server.js >> logs/server.log 2>&1 &");
      await new Promise(r => setTimeout(r, 2000));
      const ps = await execAsync("ps aux | grep protect-vision-server | grep -v grep").catch(() => ({ stdout: "" }));
      return { success: ps.stdout.includes("protect-vision-server"), message: "Server started" };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

app.get("/sse", async (req, res) => {
  const key = req.query.key || req.headers["x-api-key"];
  if (key !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  
  console.log("New SSE connection");
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;
  
  res.on("close", () => {
    console.log(`Session ${transport.sessionId} closed`);
    delete transports[transport.sessionId];
  });

  const server = createServer();
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (!transport) {
    return res.status(400).json({ error: "No transport found" });
  }
  await transport.handlePostMessage(req, res, req.body);
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", version: "1.1.0", sessions: Object.keys(transports).length });
});

// Direct tool execution endpoint (for CF MCP proxy)
app.post("/direct", async (req, res) => {
  const key = req.query.key || req.headers["x-api-key"];
  if (key !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { tool, arguments: args } = req.body;
  if (!tool) {
    return res.status(400).json({ error: "Missing tool name" });
  }

  try {
    const result = await handleToolDirect(tool, args);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Computer Use MCP Server v1.1.0 on port ${PORT}`);
  console.log(`API Key: ${API_KEY}`);
});
