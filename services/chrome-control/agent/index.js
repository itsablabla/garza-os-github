#!/usr/bin/env node

import WebSocket from 'ws';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Configuration
const WORKER_URL = process.env.WORKER_URL || 'wss://chrome-control-mcp.YOUR_SUBDOMAIN.workers.dev/agent';
const RECONNECT_DELAY = 5000;

console.log('Chrome Control Agent starting...');
console.log(`Connecting to: ${WORKER_URL}`);

async function executeAppleScript(script) {
  try {
    const { stdout, stderr } = await execFileAsync('osascript', ['-e', script]);
    if (stderr) console.error('AppleScript stderr:', stderr);
    return stdout.trim();
  } catch (error) {
    console.error('AppleScript error:', error.message);
    throw error;
  }
}


async function executeTool(tool, args) {
  switch (tool) {
    case 'open_url': {
      const { url, new_tab = true } = args || {};
      try { new URL(url); } catch { throw new Error('Invalid URL'); }
      const script = new_tab
        ? `tell application "Google Chrome" to open location ${JSON.stringify(url)}`
        : `tell application "Google Chrome" to set URL of active tab of front window to ${JSON.stringify(url)}`;
      await executeAppleScript(script);
      return { content: [{ type: 'text', text: `Opened ${url} in Chrome` }] };
    }

    case 'get_current_tab': {
      const script = `
        tell application "Google Chrome"
          set currentTab to active tab of front window
          set tabInfo to {URL of currentTab, title of currentTab, id of currentTab}
          return tabInfo
        end tell
      `;
      const result = await executeAppleScript(script);
      const [url, title, id] = result.split(', ');
      return { content: [{ type: 'text', text: JSON.stringify({ url, title, id: parseInt(id) }, null, 2) }] };
    }

    case 'list_tabs': {
      const script = `
        tell application "Google Chrome"
          set tabsList to {}
          repeat with w in windows
            repeat with t in tabs of w
              set end of tabsList to {id of t as string, URL of t, title of t}
            end repeat
          end repeat
          set AppleScript's text item delimiters to "|"
          set output to ""
          repeat with tabInfo in tabsList
            set output to output & (item 1 of tabInfo) & "," & (item 2 of tabInfo) & "," & (item 3 of tabInfo) & "|"
          end repeat
          return output
        end tell
      `;
      const result = await executeAppleScript(script);
      const tabs = result.split('|').filter(t => t).map(t => {
        const [id, url, title] = t.split(',');
        return { id: parseInt(id), url, title };
      });
      return { content: [{ type: 'text', text: JSON.stringify(tabs, null, 2) }] };
    }


    case 'close_tab': {
      const { tab_id } = args || {};
      const script = `
        tell application "Google Chrome"
          repeat with w in windows
            repeat with t in tabs of w
              if (id of t as string) is "${tab_id}" then
                close t
                return "Tab closed"
              end if
            end repeat
          end repeat
          return "Tab not found"
        end tell
      `;
      const result = await executeAppleScript(script);
      return { content: [{ type: 'text', text: result }] };
    }

    case 'switch_to_tab': {
      const { tab_id } = args || {};
      const script = `
        tell application "Google Chrome"
          repeat with w in windows
            repeat with tabIndex from 1 to count of tabs of w
              set t to tab tabIndex of w
              if (id of t as string) is "${tab_id}" then
                set active tab index of w to tabIndex
                set index of w to 1
                activate
                return "Switched to tab"
              end if
            end repeat
          end repeat
          return "Tab not found"
        end tell
      `;
      const result = await executeAppleScript(script);
      return { content: [{ type: 'text', text: result }] };
    }


    case 'reload_tab': {
      const { tab_id } = args || {};
      const script = tab_id ? `
        tell application "Google Chrome"
          repeat with w in windows
            repeat with t in tabs of w
              if (id of t as string) is "${tab_id}" then
                reload t
                return "Tab reloaded"
              end if
            end repeat
          end repeat
          return "Tab not found"
        end tell
      ` : `tell application "Google Chrome" to reload active tab of front window`;
      const result = await executeAppleScript(script);
      return { content: [{ type: 'text', text: result || 'Tab reloaded' }] };
    }

    case 'go_back': {
      const { tab_id } = args || {};
      const script = tab_id ? `
        tell application "Google Chrome"
          repeat with w in windows
            repeat with t in tabs of w
              if (id of t as string) is "${tab_id}" then
                go back t
                return "Navigated back"
              end if
            end repeat
          end repeat
          return "Tab not found"
        end tell
      ` : `tell application "Google Chrome" to go back active tab of front window`;
      const result = await executeAppleScript(script);
      return { content: [{ type: 'text', text: result || 'Navigated back' }] };
    }


    case 'go_forward': {
      const { tab_id } = args || {};
      const script = tab_id ? `
        tell application "Google Chrome"
          repeat with w in windows
            repeat with t in tabs of w
              if (id of t as string) is "${tab_id}" then
                go forward t
                return "Navigated forward"
              end if
            end repeat
          end repeat
          return "Tab not found"
        end tell
      ` : `tell application "Google Chrome" to go forward active tab of front window`;
      const result = await executeAppleScript(script);
      return { content: [{ type: 'text', text: result || 'Navigated forward' }] };
    }

    case 'execute_javascript': {
      const { code, tab_id } = args || {};
      const script = tab_id ? `
        tell application "Google Chrome"
          repeat with w in windows
            repeat with t in tabs of w
              if (id of t as string) is "${tab_id}" then
                set result to execute t javascript ${JSON.stringify(code)}
                return result
              end if
            end repeat
          end repeat
          return "Tab not found"
        end tell
      ` : `tell application "Google Chrome" to execute active tab of front window javascript ${JSON.stringify(code)}`;
      const result = await executeAppleScript(script);
      return { content: [{ type: 'text', text: result || 'JavaScript executed' }] };
    }


    case 'get_page_content': {
      const { tab_id } = args || {};
      const script = tab_id ? `
        tell application "Google Chrome"
          repeat with w in windows
            repeat with t in tabs of w
              if (id of t as string) is "${tab_id}" then
                set pageContent to execute t javascript "document.body.innerText"
                return pageContent
              end if
            end repeat
          end repeat
          return "Tab not found"
        end tell
      ` : `tell application "Google Chrome" to execute active tab of front window javascript "document.body.innerText"`;
      const result = await executeAppleScript(script);
      return { content: [{ type: 'text', text: result }] };
    }

    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}


// WebSocket connection with auto-reconnect
function connect() {
  const ws = new WebSocket(WORKER_URL);
  
  ws.on('open', () => {
    console.log('✅ Connected to remote server');
  });
  
  ws.on('message', async (data) => {
    try {
      const { id, tool, args } = JSON.parse(data.toString());
      console.log(`Executing: ${tool}`, args);
      
      try {
        const result = await executeTool(tool, args);
        ws.send(JSON.stringify({ id, result }));
        console.log(`✅ ${tool} completed`);
      } catch (error) {
        ws.send(JSON.stringify({ id, error: error.message }));
        console.error(`❌ ${tool} failed:`, error.message);
      }
    } catch (e) {
      console.error('Failed to parse message:', e);
    }
  });
  
  ws.on('close', () => {
    console.log('❌ Disconnected. Reconnecting in 5s...');
    setTimeout(connect, RECONNECT_DELAY);
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error.message);
  });
}

connect();
