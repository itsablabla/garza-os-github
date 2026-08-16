'use strict';
/* Fetches all Lark content (Drive, Docs, Bases, Wiki) via the consolidated MCP
   gateway and writes it as files under OUTPUT_DIR, mirroring the Lark tree. */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const MCP_URL   = process.env.LARK_MCP_URL || 'https://lark.garzalabs.com/intl/mcp';
const OUT_DIR   = process.env.OUTPUT_DIR   || '/data/lark-sync';
const INTERVAL  = Number(process.env.SYNC_INTERVAL_MS || 15 * 60 * 1000); // 15 min

let reqId = 0;

function mcpCall(method, args) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: '2.0', id: ++reqId, method: 'tools/call',
      params: { name: method, arguments: args }
    });
    const url = new URL(MCP_URL);
    const transport = url.protocol === 'https:' ? https : http;
    const defaultPort = url.protocol === 'https:' ? 443 : 80;
    const req = transport.request({
      hostname: url.hostname, port: url.port || defaultPort, path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Content-Length': Buffer.byteLength(body),
      }
    }, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        // SSE: pick first `data:` line
        for (const line of raw.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(line.slice(6));
              const text = parsed?.result?.content?.find(c => c.type === 'text')?.text;
              resolve(text ? JSON.parse(text) : {});
            } catch { resolve({}); }
            return;
          }
        }
        resolve({});
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function safe(name) {
  return name.replace(/[/\\:*?"<>|]/g, '_').trim() || '_unnamed';
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeFile(p, content) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, content, 'utf8');
}

function writeMeta(p, obj) {
  writeFile(p + '.meta.json', JSON.stringify(obj, null, 2));
}

// ── Drive ────────────────────────────────────────────────────────────────────

const visitedFolders = new Set();

async function syncDriveFolder(folderToken, localDir, depth = 0) {
  if (depth > 8) return;
  if (visitedFolders.has(folderToken || 'root')) return;
  visitedFolders.add(folderToken || 'root');
  ensureDir(localDir);
  let pageToken = '';
  do {
    const args = { params: { folder_token: folderToken } };
    if (pageToken) args.params.page_token = pageToken;
    const res = await mcpCall('drive_v1_file_list', args).catch(() => ({}));
    pageToken = res.next_page_token || '';
    for (const file of (res.files || [])) {
      // Only process files whose parent matches this folder (avoid cross-folder leakage)
      if (folderToken && file.parent_token && file.parent_token !== folderToken) continue;
      if (visitedFolders.has(file.token)) continue;
      const name = safe(file.name || file.token);
      if (file.type === 'folder') {
        await syncDriveFolder(file.token, path.join(localDir, name), depth + 1);
      } else if (file.type === 'docx') {
        await syncDoc(file.token, path.join(localDir, name + '.md'));
      } else if (file.type === 'bitable') {
        await syncBase(file.token, path.join(localDir, name));
      } else if (file.type === 'sheet') {
        await syncSheet(file.token, path.join(localDir, name));
      } else {
        writeMeta(path.join(localDir, name), file);
      }
    }
  } while (pageToken);
}

// ── Docs ─────────────────────────────────────────────────────────────────────

async function syncDoc(token, filePath) {
  const res = await mcpCall('docx_v1_document_rawContent', { path: { document_id: token } }).catch(() => ({}));
  const content = res.content || JSON.stringify(res);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

// ── Bases (Bitable) ──────────────────────────────────────────────────────────

async function syncBase(appToken, baseDir) {
  ensureDir(baseDir);
  const tablesRes = await mcpCall('bitable_v1_appTable_list', { path: { app_token: appToken } }).catch(() => ({}));
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
      const r = await mcpCall('bitable_v1_appTableRecord_list', args).catch(() => ({}));
      pageToken = (r.page_token || r.next_page_token) || '';
      for (const rec of (r.items || [])) rows.push(rec.fields);
    } while (pageToken);
    writeFile(path.join(baseDir, tableName + '.json'), JSON.stringify(rows, null, 2));
  }
}

// ── Sheets ───────────────────────────────────────────────────────────────────

async function syncSheet(token, sheetDir) {
  ensureDir(sheetDir);
  const res = await mcpCall('sheets_v3_spreadsheetSheet_query', { path: { spreadsheet_token: token } }).catch(() => ({}));
  writeFile(path.join(sheetDir, 'sheets.json'), JSON.stringify(res.sheets || res, null, 2));
}

// ── Wiki ─────────────────────────────────────────────────────────────────────

async function syncWiki(wikiDir) {
  ensureDir(wikiDir);
  const spacesRes = await mcpCall('wiki_v2_space_list', {}).catch(() => ({}));
  for (const space of (spacesRes.items || [])) {
    const spaceDir = path.join(wikiDir, safe(space.name || space.space_id));
    ensureDir(spaceDir);
    await syncWikiNodes(space.space_id, '', spaceDir);
  }
}

async function syncWikiNodes(spaceId, parentNodeToken, localDir) {
  const args = { path: { space_id: spaceId }, params: {} };
  if (parentNodeToken) args.params.parent_node_token = parentNodeToken;
  const res = await mcpCall('wiki_v2_spaceNode_list', args).catch(() => ({}));
  for (const node of (res.items || [])) {
    const name = safe(node.title || node.node_token);
    if (node.obj_type === 'doc' || node.obj_type === 'docx') {
      await syncDoc(node.obj_token, path.join(localDir, name + '.md'));
    }
    if (node.has_child) {
      const childDir = path.join(localDir, name);
      ensureDir(childDir);
      await syncWikiNodes(spaceId, node.node_token, childDir);
    }
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function run() {
  console.log('[lark-sync] Starting sync to', OUT_DIR);
  ensureDir(path.join(OUT_DIR, 'Drive'));
  ensureDir(path.join(OUT_DIR, 'Wiki'));
  ensureDir(path.join(OUT_DIR, 'Bases'));

  try {
    console.log('[lark-sync] Syncing Drive...');
    await syncDriveFolder('', path.join(OUT_DIR, 'Drive'));

    console.log('[lark-sync] Syncing Wiki...');
    await syncWiki(path.join(OUT_DIR, 'Wiki'));

    console.log('[lark-sync] Done at', new Date().toISOString());
  } catch (e) {
    console.error('[lark-sync] Error:', e.message);
  }
}

run();
if (INTERVAL > 0) setInterval(run, INTERVAL);
