'use strict';
/*
 * Syncs Lark Wiki + Bases (Bitables) to LOCAL_DIR via the user access token.
 *  - Wiki  : wiki spaces -> nodes (recursive) -> docx raw_content as .md
 *  - Bases : drive files of type bitable (from LARK_BASES_FOLDER_TOKEN or My Space root)
 *            -> tables -> records as .json
 * Drive docs are handled separately by lark-cli (+sync).
 */
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const OUT_DIR  = process.env.LOCAL_DIR || '/data/lark';
const DOMAIN   = (process.env.LARK_DOMAIN || 'https://open.larksuite.com').replace(/\/+$/, '');
const USER_TOK = process.env.LARKSUITE_CLI_USER_ACCESS_TOKEN || '';
const BASES_FOLDER = process.env.LARK_BASES_FOLDER_TOKEN || ''; // '' = My Space root

function safe(name) {
  return (name || '').replace(/[/\\:*?"<>|]/g, '_').trim() || '_unnamed';
}
function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
}

// ---------- direct REST (user token) ----------
function restGet(apiPath, qs) {
  return new Promise((resolve, reject) => {
    const url = new URL(DOMAIN + apiPath + (qs ? '?' + qs : ''));
    const transport = url.protocol === 'https:' ? https : http;
    const headers = { Accept: 'application/json' };
    if (USER_TOK) headers.Authorization = 'Bearer ' + USER_TOK;
    const req = transport.get({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      headers,
    }, (res) => {
      let raw = '';
      res.on('data', (d) => (raw += d));
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('bad json: ' + raw.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function restPage(apiPath, qs, itemsKey) {
  const all = [];
  let pageToken = '';
  for (let i = 0; i < 200; i++) {
    const q = qs + (pageToken ? '&page_token=' + encodeURIComponent(pageToken) : '');
    const j = await restGet(apiPath, q);
    if (!j || j.code !== 0) throw new Error(JSON.stringify(j || {}).slice(0, 300));
    const data = j.data || {};
    const items = data[itemsKey] || [];
    for (const it of items) all.push(it);
    pageToken = data.page_token || data.next_page_token || '';
    if (!pageToken || !data.has_more) break;
  }
  return all;
}

// ---------- Wiki ----------
async function walkWikiNodes(spaceId, parentToken, localDir, depth) {
  if (depth > 8) return;
  let nodes;
  try {
    const qs = 'page_size=50' + (parentToken ? '&parent_node_token=' + encodeURIComponent(parentToken) : '');
    nodes = await restPage('/open-apis/wiki/v2/spaces/' + spaceId + '/nodes', qs, 'items');
  } catch (e) {
    console.log('[wiki] node list error:', e.message);
    return;
  }
  for (const node of nodes) {
    const n = safe(node.title || node.node_token);
    if (node.obj_type === 'doc' || node.obj_type === 'docx') {
      try {
        const rc = await restGet('/open-apis/docx/v1/documents/' + node.obj_token + '/raw_content', '');
        const content = (rc.data && rc.data.content) || JSON.stringify(rc);
        writeFile(path.join(localDir, n + '.md'), content);
      } catch (e) {
        console.log('[wiki] doc error:', n, e.message);
      }
    }
    if (node.has_child) {
      await walkWikiNodes(spaceId, node.node_token, path.join(localDir, n), depth + 1);
    }
  }
}

async function syncWiki() {
  const wikiDir = path.join(OUT_DIR, 'Wiki');
  fs.mkdirSync(wikiDir, { recursive: true });
  if (!USER_TOK) {
    console.log('[wiki] No user token — wiki sync skipped (set LARKSUITE_CLI_USER_ACCESS_TOKEN)');
    return;
  }
  let spaces;
  try {
    spaces = await restPage('/open-apis/wiki/v2/spaces', 'page_size=50', 'items');
  } catch (e) {
    console.log('[wiki] space list error:', e.message);
    return;
  }
  if (!spaces.length) {
    console.log('[wiki] No wiki spaces found (check token permissions)');
    return;
  }
  for (const space of spaces) {
    const name = safe(space.name || space.space_id);
    console.log('[wiki] Syncing space:', name);
    await walkWikiNodes(space.space_id, '', path.join(wikiDir, name), 0);
  }
  console.log('[wiki] Done — spaces:', spaces.length);
}

// ---------- Bases (Bitables) ----------
async function syncBase(appToken, baseDir) {
  fs.mkdirSync(baseDir, { recursive: true });
  let tables;
  try {
    tables = await restPage('/open-apis/bitable/v1/apps/' + appToken + '/tables', 'page_size=100', 'items');
  } catch (e) {
    console.log('[base] tables error:', e.message);
    return;
  }
  for (const table of tables) {
    const tname = safe(table.name || table.table_id);
    const rows = [];
    try {
      const recs = await restPage(
        '/open-apis/bitable/v1/apps/' + appToken + '/tables/' + table.table_id + '/records',
        'page_size=100',
        'items'
      );
      for (const rec of recs) rows.push(rec.fields);
    } catch (e) {
      console.log('[base] records error:', table.name || table.table_id, e.message);
    }
    writeFile(path.join(baseDir, tname + '.json'), rows);
    console.log('[base] table', tname, rows.length, 'rows');
  }
}

async function syncBases() {
  const basesDir = path.join(OUT_DIR, 'Bases');
  fs.mkdirSync(basesDir, { recursive: true });
  if (!USER_TOK) {
    console.log('[base] No user token — bases sync skipped');
    return;
  }
  let files;
  try {
    const qs = 'page_size=200' + (BASES_FOLDER ? '&folder_token=' + encodeURIComponent(BASES_FOLDER) : '');
    files = await restPage('/open-apis/drive/v1/files', qs, 'files');
  } catch (e) {
    console.log('[base] discovery error:', e.message);
    return;
  }
  const bitables = files.filter((f) => f.type === 'bitable');
  let count = 0;
  for (const f of bitables) {
    const name = safe(f.name || f.token);
    console.log('[base] Syncing base:', name);
    await syncBase(f.token, path.join(basesDir, name));
    count++;
  }
  console.log('[wiki-bases] Done — bases:', count);
}

// ---------- main ----------
async function main() {
  console.log('[wiki-bases] Starting sync →', OUT_DIR);
  await syncWiki().catch((e) => console.error('[wiki] error:', e.message));
  await syncBases().catch((e) => console.error('[bases] error:', e.message));
}
main().catch((e) => { console.error('[wiki-bases] Fatal:', e.message); process.exit(1); });
