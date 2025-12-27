/**
 * SSH/Shell Integration Snippets
 * Copy these into your MCP server
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// =============================================================================
// CONFIG - SSH HOSTS
// =============================================================================
const SSH_HOSTS = {
  mac: { host: '45.147.93.59', user: 'customer' },
  garzahive: { host: '134.122.8.40', user: 'root' },
  // Add more hosts as needed
};

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================
const shellTools = [
  {
    name: 'shell_exec',
    description: 'Execute local shell command',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute' },
        timeout: { type: 'number', description: 'Timeout in ms (default 30000)' }
      },
      required: ['command']
    }
  },
  {
    name: 'ssh_exec',
    description: 'Execute command on remote host via SSH',
    inputSchema: {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'Host alias (mac, garzahive) or user@ip' },
        command: { type: 'string', description: 'Command to execute' },
        timeout: { type: 'number', description: 'Timeout in ms (default 30000)' }
      },
      required: ['host', 'command']
    }
  }
];

// =============================================================================
// HANDLERS
// =============================================================================
async function handleShellTool(name, args) {
  const timeout = args.timeout || 30000;
  
  switch (name) {
    case 'shell_exec':
      try {
        const { stdout, stderr } = await execAsync(args.command, { timeout });
        return { 
          content: [{ 
            type: 'text', 
            text: JSON.stringify({ output: stdout, stderr, success: true }) 
          }] 
        };
      } catch (error) {
        return { 
          content: [{ 
            type: 'text', 
            text: JSON.stringify({ error: error.message, success: false }) 
          }] 
        };
      }
    
    case 'ssh_exec':
      try {
        let sshTarget = args.host;
        
        // Resolve host alias
        if (SSH_HOSTS[args.host]) {
          const h = SSH_HOSTS[args.host];
          sshTarget = `${h.user}@${h.host}`;
        }
        
        const sshCmd = `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${sshTarget} "${args.command.replace(/"/g, '\\"')}"`;
        const { stdout, stderr } = await execAsync(sshCmd, { timeout });
        
        return { 
          content: [{ 
            type: 'text', 
            text: JSON.stringify({ output: stdout, stderr, success: true }) 
          }] 
        };
      } catch (error) {
        return { 
          content: [{ 
            type: 'text', 
            text: JSON.stringify({ error: error.message, success: false }) 
          }] 
        };
      }
    
    default:
      return null;
  }
}

export { shellTools, handleShellTool, SSH_HOSTS };
