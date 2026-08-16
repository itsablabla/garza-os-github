'use strict';
/* Syncs Lark Wiki + Bases/Bitable to LOCAL_DIR via the internal lark-mcp gateway.
   Drive is handled separately by lark-cli. This script only needs wiki + bases. */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const MCP_URL  = process.env.LARK_MCP_URL || 'http://9o0rlv2llum5chtuyigaih5s:3000/intl/mcp';
const OUT_DIR  = process.env.LOCAL_DIR || '/data/lark';

let reqId = 0;
let mcpSessionId = null;

async function initSession() {
  const body = JSON.stringify({
    jsonrpc: '2.0', id: ++reqId, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'lark-sync', version: '1.0' } }
  });
  const res = await rawPost(body);
  mcpSessionId = res.sessionId;
}

function rawPost(body) {
  return new Promise((resolve, reject) => {
    const url = new URL(MCP_URL);
    const transport = url.protocol === 'https:' ? https : http;
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Content-Length': Buffer.byteLength(body),
    };
    if (mcpSessionId) headers['mcp-session-id'] = mcpSessionId;
    const req = transport.request({
      hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname, method: 'POST', headers
    }, res => {
      if (!mcpSessionId && res.headers['mcp-session-id']) {
        mcpSessionId = res.headers['mcp-session-id'];
      }
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        for (const line of raw.split('\n')) {
          if (line.startsWith('data: ')) {
            try { resolve(JSON.parse(line.slice(6))); } catch { resolve({}); }
            return;
          }
        }
        try { resolve(JSON.parse(raw)); } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

async function mcpCall(tool, args) {
  const body = JSON.stringify({
    jsonrpc: '2.0', id: ++reqId, method: 'tools/call',
    params: { name: tool, arguments: args }
  });
  const res = await rawPost(body).catch(e => { console.error('[mcp]', tool, e.message); return {}; });
  const text = res?.result?.content?.find(c => c.type === 'text')?.text;
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function safe(name) {
  return (name || '').replace(/[/\\:*?"<>|]/g, '_').trim() || '_unnamed';
}

function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
}

// ── Docs ─────────────────────────────────────────────────────────────────────

async function syncDoc(token, filePath) {
  const res = await mcpCall('docx_v1_document_rawContent', { path: { document_id: token } });
  const content = res.content || JSON.stringify(res);
  writeFile(filePath, content);
}

// ── Wiki ─────────────────────────────────────────────────────────────────────

async function syncWikiNodes(spaceId, parentNodeToken, localDir, depth) {
  if (depth > 8) return;
  const args = { path: { space_id: spaceId }, params: {} };
  if (parentNodeToken) args.params.parent_node_token = parentNodeToken;
  const res = await mcpCall('wiki_v2_spaceNode_list', args);
  for (const node of (res.items || [])) {
    const name = safe(node.title || node.node_token);
    if (node.obj_type === 'doc' || node.obj_type === 'docx') {
      await syncDoc(node.obj_token, path.join(localDir, name + '.md'));
    }
    if (node.has_child) {
      await syncWikiNodes(spaceId, node.node_token, path.join(localDir, name), depth + 1);
    }
  }
}

async function syncWiki() {
  const wikiDir = path.join(OUT_DIR, 'Wiki');
  fs.mkdirSync(wikiDir, { recursive: true });
  const res = await mcpCall('wiki_v2_space_list', {});
  const spaces = res.items || [];
  if (!spaces.length) {
    console.log('[wiki] No wiki spaces found (check token permissions)');
    return;
  }
  for (const space of spaces) {
    const name = safe(space.name || space.space_id);
    console.log('[wiki] Syncing space:', name);
    await syncWikiNodes(space.space_id, '', path.join(wikiDir, name), 0);
  }
  console.log('[wiki] Done — spaces:', spaces.length);
}

// ── Bases (Bitable) ──────────────────────────────────────────────────────────

async function syncBase(appToken, baseDir) {
  fs.mkdirSync(baseDir, { recursive: true });
  const tablesRes = await mcpCall('bitable_v1_appTable_list', { path: { app_token: appToken } });
  for (const table of (tablesRes.items || [])) {
    const tableName = safe(table.name || table.table_id);
    const rows = [];
    let pageToken = '';
    do {
      const args = {
        path: { app_token: appToken, table_id: table.table_id },
        params: { page_size: 100 },
      };
      if (pageToken) args.params.page_token = pageToken;
      const r = await mcpCall('bitable_v1_appTableRecord_list', args);
      pageToken = r.page_token || r.next_page_token || '';
      for (const rec of (r.items || [])) rows.push(rec.fields);
    } while (pageToken);
    writeFile(path.join(baseDir, tableName + '.json'), rows);
    console.log('[base] table', tableName, rows.length, 'rows');
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[wiki-bases] Starting sync →', OUT_DIR);
  await initSession().catch(e => console.warn('[init]', e.message));

  // Wiki
  await syncWiki().catch(e => console.error('[wiki] error:', e.message));

  // Bases: list Drive files of type bitable and sync each
  const basesDir = path.join(OUT_DIR, 'Bases');
  fs.mkdirSync(basesDir, { recursive: true });
  let pageToken = '';
  let baseCount = 0;
  do {
    const args = { params: { folder_token: process.env.LARK_FOLDER_TOKEN || '', type: 'bitable' } };
    if (pageToken) args.params.page_token = pageToken;
    const res = await mcpCall('drive_v1_file_list', args);
    pageToken = res.next_page_token || '';
    for (const f of (res.files || [])) {
      if (f.type === 'bitable') {
        const name = safe(f.name || f.token);
        console.log('[base] Syncing base:', name);
        await syncBase(f.token, path.join(basesDir, name));
        baseCount++;
      }
    }
  } while (pageToken);
  console.log('[wiki-bases] Done — bases:', baseCount);
}

main().catch(e => {
  console.error('[wiki-bases] Fatal:', e.message);
  process.exit(1);
});
