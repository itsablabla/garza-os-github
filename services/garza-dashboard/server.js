const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;

const apps = {
  flyio: {
    active: [
      { name: 'beeper-matrix-mcp', url: 'https://beeper-matrix-mcp.fly.dev', purpose: 'Beeper Matrix API bridge' },
      { name: 'claude-browser', url: 'https://claude-browser.fly.dev', purpose: 'Browser automation agent' },
      { name: 'claude-mcp-manager', url: 'https://claude-mcp-manager.fly.dev', purpose: 'MCP connection manager' },
      { name: 'email-craft-fly', url: 'https://email-craft-fly.fly.dev', purpose: 'Email to Craft pipeline' },
      { name: 'garza-ears', url: 'https://garza-ears.fly.dev', purpose: 'Voice memo transcription' },
      { name: 'garza-n8n', url: 'https://garza-n8n.fly.dev', purpose: 'N8N workflow server' },
      { name: 'garza-sentinel', url: 'https://garza-sentinel.fly.dev', purpose: 'Slack compliance monitoring' },
      { name: 'garza-ssh-relay-2', url: 'https://garza-ssh-relay-2.fly.dev', purpose: 'SSH tunnel relay' }
    ],
    suspended: [
      { name: 'garza-home-mcp', url: 'https://garza-home-mcp.fly.dev', purpose: 'Home automation MCP v2' },
      { name: 'garza-matrix', url: 'https://garza-matrix.fly.dev', purpose: 'Matrix homeserver bridge' },
      { name: 'garza-ssh-relay', url: 'https://garza-ssh-relay.fly.dev', purpose: 'SSH relay v1' },
      { name: 'jessica-bot', url: 'https://jessica-bot.fly.dev', purpose: 'Jessica daily messages' },
      { name: 'last-rock-dev', url: 'https://last-rock-dev.fly.dev', purpose: 'Last Rock Labs dev MCP' }
    ]
  },
  workers: {
    core: [
      { name: 'garza-mcp', url: 'https://garza-mcp.garzahive.workers.dev', purpose: 'Main GARZA OS MCP' },
      { name: 'garza-cloud-mcp', url: 'https://garza-cloud-mcp.garzahive.workers.dev', purpose: 'Cloud orchestration' },
      { name: 'mcp-gateway', url: 'https://mcp-gateway.garzahive.workers.dev', purpose: 'MCP routing gateway' },
      { name: 'garza-cf-ssh-backup', url: 'https://garza-cf-ssh-backup.garzahive.workers.dev', purpose: 'SSH backup' },
      { name: 'garza-health-monitor', url: 'https://garza-health-monitor.garzahive.workers.dev', purpose: 'Health monitoring' }
    ],
    automation: [
      { name: 'beeper-scheduler', url: 'https://beeper-scheduler.garzahive.workers.dev', purpose: 'Message scheduling' },
      { name: 'jessica-cron', url: 'https://jessica-cron.garzahive.workers.dev', purpose: 'Jessica Program' },
      { name: 'travis-friendship', url: 'https://travis-friendship.garzahive.workers.dev', purpose: 'Travis Program' },
      { name: 'email-craft', url: 'https://email-craft.garzahive.workers.dev', purpose: 'Email to Craft' }
    ],
    bridges: [
      { name: 'garza-n8n-mcp', url: 'https://garza-n8n-mcp.garzahive.workers.dev', purpose: 'N8N MCP' },
      { name: 'hoobs-mcp', url: 'https://hoobs-mcp.garzahive.workers.dev', purpose: 'HOOBS MCP' },
      { name: 'scout-mcp-garza', url: 'https://scout-mcp-garza.garzahive.workers.dev', purpose: 'Scout APM' },
      { name: 'desktop-commander-mcp', url: 'https://desktop-commander-mcp.garzahive.workers.dev', purpose: 'Desktop MCP' },
      { name: 'chrome-control-mcp', url: 'https://chrome-control-mcp.garzahive.workers.dev', purpose: 'Chrome MCP' }
    ],
    specialty: [
      { name: 'garza-youversion', url: 'https://garza-youversion.garzahive.workers.dev', purpose: 'Bible integration' }
    ]
  },
  mcp: {
    primary: [
      { name: 'Beeper MCP', url: 'https://beeper-mcp.garzahive.com', purpose: 'Unified messaging' },
      { name: 'CF MCP', url: 'https://mcp-cf.garzahive.com', purpose: 'Mac orchestration' },
      { name: 'N8N MCP', url: 'https://n8n-mcp.garzahive.com', purpose: 'Workflow automation' },
      { name: 'SSH Backup', url: 'https://ssh-backup2.garzahive.com', purpose: 'SSH redundancy' }
    ]
  }
};

app.get('/health', (req, res) => res.json({ status: 'ok', app: 'garza-dashboard' }));
app.get('/api/apps', (req, res) => res.json(apps));

app.get('/check', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({ status: 'error' });
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5000);
    const r = await fetch(url + '/health', { signal: controller.signal });
    res.json({ status: r.ok ? 'online' : 'offline' });
  } catch {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      res.json({ status: r.ok ? 'online' : 'offline' });
    } catch { res.json({ status: 'offline' }); }
  }
});

app.get('/', (req, res) => res.send(HTML));
app.listen(PORT, () => console.log('Dashboard on ' + PORT));

const HTML = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GARZA OS Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:linear-gradient(135deg,#0f0f23,#1a1a2e,#16213e);min-height:100vh;color:#e4e4e7;padding:20px}
.header{text-align:center;margin-bottom:30px;padding:20px}
.header h1{font-size:2.5rem;background:linear-gradient(90deg,#a855f7,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.stats{display:flex;justify-content:center;gap:30px;margin-top:15px;flex-wrap:wrap}
.stat{background:rgba(255,255,255,.05);padding:15px 25px;border-radius:12px;border:1px solid rgba(255,255,255,.1)}
.stat-value{font-size:1.8rem;font-weight:bold;color:#a855f7}
.stat-label{font-size:.85rem;color:#9ca3af;margin-top:5px}
.section{margin-bottom:30px}
.section-title{font-size:1.3rem;margin-bottom:15px;display:flex;align-items:center;gap:10px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:15px}
.card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:18px;transition:all .2s}
.card:hover{background:rgba(255,255,255,.06);border-color:rgba(168,85,247,.3);transform:translateY(-2px)}
.card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.card-name{font-weight:600;font-size:1rem;color:#f4f4f5}
.card-purpose{font-size:.85rem;color:#9ca3af;margin-bottom:10px}
.card-url{font-size:.75rem;color:#6366f1;word-break:break-all;text-decoration:none}
.status{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:20px;font-size:.75rem;font-weight:500}
.status.checking{background:rgba(251,191,36,.15);color:#fbbf24}
.status.online{background:rgba(34,197,94,.15);color:#22c55e}
.status.offline{background:rgba(239,68,68,.15);color:#ef4444}
.status.suspended{background:rgba(156,163,175,.15);color:#9ca3af}
.status-dot{width:8px;height:8px;border-radius:50%;background:currentColor}
.status.checking .status-dot{animation:pulse 1s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.subsection{margin-bottom:25px}
.subsection-title{font-size:.9rem;color:#9ca3af;margin-bottom:12px;padding-left:5px;border-left:3px solid #a855f7}
.refresh-btn{background:linear-gradient(90deg,#a855f7,#6366f1);border:none;padding:10px 20px;border-radius:8px;color:#fff;font-weight:600;cursor:pointer;margin-top:20px}
.refresh-btn:hover{opacity:.9}
.refresh-btn:disabled{opacity:.5;cursor:not-allowed}
.last-updated{font-size:.8rem;color:#6b7280;margin-top:10px}
</style></head><body>
<div class="header"><h1>GARZA OS</h1><p style="color:#9ca3af">Live Infrastructure Dashboard</p>
<div class="stats">
<div class="stat"><div class="stat-value" id="total">35+</div><div class="stat-label">Total Apps</div></div>
<div class="stat"><div class="stat-value" id="online">--</div><div class="stat-label">Online</div></div>
<div class="stat"><div class="stat-value" id="issues">--</div><div class="stat-label">Issues</div></div>
</div>
<button class="refresh-btn" onclick="checkAll()">Check All Status</button>
<div class="last-updated" id="updated"></div></div>
<div class="section"><div class="section-title">Fly.io Apps</div>
<div class="subsection"><div class="subsection-title">Active</div><div class="grid" id="fly-active"></div></div>
<div class="subsection"><div class="subsection-title">Suspended</div><div class="grid" id="fly-suspended"></div></div></div>
<div class="section"><div class="section-title">Cloudflare Workers</div>
<div class="subsection"><div class="subsection-title">Core</div><div class="grid" id="cf-core"></div></div>
<div class="subsection"><div class="subsection-title">Automation</div><div class="grid" id="cf-auto"></div></div>
<div class="subsection"><div class="subsection-title">Bridges</div><div class="grid" id="cf-bridges"></div></div>
<div class="subsection"><div class="subsection-title">Specialty</div><div class="grid" id="cf-spec"></div></div></div>
<div class="section"><div class="section-title">MCP Servers</div><div class="grid" id="mcp"></div></div>
<script>
let apps={},status={};
async function load(){const r=await fetch('/api/apps');apps=await r.json();render()}
function card(a,sus){const s=status[a.url]||(sus?'suspended':'checking'),t=s==='suspended'?'Suspended':s==='checking'?'Checking...':s==='online'?'Online':'Offline';
return '<div class="card"><div class="card-header"><span class="card-name">'+a.name+'</span><span class="status '+s+'"><span class="status-dot"></span>'+t+'</span></div><div class="card-purpose">'+a.purpose+'</div><a href="'+a.url+'" target="_blank" class="card-url">'+a.url+'</a></div>'}
function render(){document.getElementById('fly-active').innerHTML=apps.flyio.active.map(a=>card(a)).join('');
document.getElementById('fly-suspended').innerHTML=apps.flyio.suspended.map(a=>card(a,1)).join('');
document.getElementById('cf-core').innerHTML=apps.workers.core.map(a=>card(a)).join('');
document.getElementById('cf-auto').innerHTML=apps.workers.automation.map(a=>card(a)).join('');
document.getElementById('cf-bridges').innerHTML=apps.workers.bridges.map(a=>card(a)).join('');
document.getElementById('cf-spec').innerHTML=apps.workers.specialty.map(a=>card(a)).join('');
document.getElementById('mcp').innerHTML=apps.mcp.primary.map(a=>card(a)).join('');
document.getElementById('online').textContent=Object.values(status).filter(s=>s==='online').length||'--';
document.getElementById('issues').textContent=Object.values(status).filter(s=>s==='offline').length||'--'}
async function check(url){try{const r=await fetch('/check?url='+encodeURIComponent(url));return(await r.json()).status}catch{return'offline'}}
async function checkAll(){const btn=document.querySelector('.refresh-btn');btn.disabled=1;btn.textContent='Checking...';
const all=[...apps.flyio.active,...apps.workers.core,...apps.workers.automation,...apps.workers.bridges,...apps.workers.specialty,...apps.mcp.primary];
for(const a of all){status[a.url]=await check(a.url);render()}
btn.disabled=0;btn.textContent='Check All Status';document.getElementById('updated').textContent='Last: '+new Date().toLocaleTimeString()}
load()
</script></body></html>`;
