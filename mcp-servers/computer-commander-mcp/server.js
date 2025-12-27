// Computer Commander MCP Server - Local Docker Control
import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execAsync = promisify(exec);
const app = express();
app.use(express.json());

const API_KEY = process.env.CC_API_KEY || 'computercommander2024';
const PORT = process.env.PORT || 3100;

// Container name mapping
function getContainerName(instance) {
  return instance === 2 ? 'computer-commander-2' : 'computer-commander';
}

// Execute shell command
async function localExec(command, timeout = 30000) {
  try {
    const { stdout, stderr } = await execAsync(command, { timeout, maxBuffer: 10 * 1024 * 1024 });
    return stdout || stderr || '';
  } catch (error) {
    throw new Error(error.message || 'Command failed');
  }
}

// Auth middleware
app.use((req, res, next) => {
  const key = req.headers['x-api-key'] || req.query.key;
  if (key !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', server: 'computer-commander-mcp' });
});

// Tool handlers
const tools = {
  async computer_use_status(args) {
    const output = await localExec('docker ps -a --filter "name=computer-commander" --format "{{.Names}}\\t{{.Status}}\\t{{.Ports}}"');
    const containers = output.trim().split('\n').filter(Boolean).map(line => {
      const [name, status, ports] = line.split('\t');
      return { name, status, ports, running: status?.includes('Up') };
    });
    return { containers, count: containers.length };
  },

  async computer_use_logs(args) {
    const container = getContainerName(args.instance || 1);
    const lines = args.lines || 50;
    const output = await localExec(`docker logs ${container} --tail ${lines} 2>&1`);
    return { logs: output, container };
  },

  async computer_use_restart(args) {
    const container = getContainerName(args.instance || 1);
    await localExec(`docker restart ${container}`);
    return { success: true, action: 'restarted', container };
  },

  async computer_use_stop(args) {
    const container = getContainerName(args.instance || 1);
    await localExec(`docker stop ${container}`);
    return { success: true, action: 'stopped', container };
  },

  async computer_use_start(args) {
    const instance = args.instance || 1;
    const container = getContainerName(instance);
    try {
      await localExec(`docker start ${container}`);
      return { success: true, action: 'started', container };
    } catch {
      // Container doesn't exist, create it
      const port = instance === 2 ? 8502 : 8501;
      const vnc = instance === 2 ? 5902 : 5900;
      const novnc = instance === 2 ? 6082 : 6080;
      const http = instance === 2 ? 8082 : 8080;
      const cmd = `docker run -d --name ${container} -p ${vnc}:5900 -p ${novnc}:6080 -p ${http}:8080 -p ${port}:8501 ghcr.io/anthropics/anthropic-quickstarts:computer-use-demo-latest`;
      await localExec(cmd);
      return { success: true, action: 'created', container };
    }
  },

  async computer_use_urls(args) {
    const ip = '134.122.8.40';
    return {
      instances: [
        { instance: 1, container: 'computer-commander', streamlit: `http://${ip}:8501`, vnc: `http://${ip}:6080`, http: `http://${ip}:8080` },
        { instance: 2, container: 'computer-commander-2', streamlit: `http://${ip}:8502`, vnc: `http://${ip}:6082`, http: `http://${ip}:8082` }
      ],
      server: os.hostname()
    };
  },

  async computer_use_exec(args) {
    if (!args.command) throw new Error('Command required');
    const container = getContainerName(args.instance || 1);
    const output = await localExec(`docker exec ${container} bash -c "${args.command.replace(/"/g, '\\"')}"`);
    return { output, container };
  },

  async docker_exec(args) {
    // Alias for computer_use_exec
    return tools.computer_use_exec(args);
  }
};

// Direct tool call endpoint
app.post('/direct', async (req, res) => {
  try {
    const { tool, arguments: args } = req.body;
    if (!tools[tool]) {
      return res.status(400).json({ error: `Unknown tool: ${tool}` });
    }
    const result = await tools[tool](args || {});
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// MCP endpoint
app.post('/mcp', async (req, res) => {
  try {
    const { method, params, id } = req.body;
    let result;

    if (method === 'initialize') {
      result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'computer-commander-mcp', version: '1.0.0' } };
    } else if (method === 'tools/list') {
      result = { tools: Object.keys(tools).map(name => ({ name, description: `Computer Commander: ${name}` })) };
    } else if (method === 'tools/call') {
      if (!tools[params.name]) {
        return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${params.name}` } });
      }
      const r = await tools[params.name](params.arguments || {});
      result = { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
    } else {
      return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    }

    res.json({ jsonrpc: '2.0', id, result });
  } catch (error) {
    res.status(400).json({ jsonrpc: '2.0', error: { code: -32700, message: error.message } });
  }
});

app.listen(PORT, () => {
  console.log(`Computer Commander MCP listening on port ${PORT}`);
});
