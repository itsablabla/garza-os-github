# 🚀 GARZA OS App Index & Dashboard

**Source:** Craft doc 16391
**Live Dashboard:** https://garza-dashboard.fly.dev
**Last Updated:** December 25, 2025
**Total Apps:** 35+

---

## 📊 Quick Stats

| Category | Count | Status |
| --- | --- | --- |
| Cloudflare Workers | 15 | ✅ Active |
| MCP Servers | 12 | ✅ Active |
| D1 Databases | 4 | ✅ Active |
| KV Namespaces | 5 | ✅ Active |
| R2 Buckets | 1 | ✅ Active |
| System Programs | 6 | ✅ Active |

---

## 🚀 Fly.io Apps (13 Apps)

### Active/Deployed

| App | Purpose | Status |
| --- | --- | --- |
| **beeper-matrix-mcp** | Beeper Matrix API bridge | ✅ Deployed |
| **claude-browser** | Browser automation agent | ✅ Deployed |
| **claude-mcp-manager** | MCP connection manager | ✅ Deployed |
| **email-craft-fly** | Email to Craft pipeline | ✅ Deployed |
| **garza-ears** | Voice memo transcription (Whisper + Claude) | ✅ Deployed |
| **garza-n8n** | N8N workflow server | ✅ Deployed |
| **garza-sentinel** | Slack compliance monitoring | ✅ Deployed |
| **garza-ssh-relay-2** | SSH tunnel relay | ✅ Deployed |

### Suspended (On-Demand)

| App | Purpose | Status |
| --- | --- | --- |
| **garza-home-mcp** | Home automation MCP v2 | 💤 Suspended |
| **garza-matrix** | Matrix homeserver bridge | 💤 Suspended |
| **garza-ssh-relay** | SSH relay v1 | 💤 Suspended |
| **jessica-bot** | 💜 Jessica daily messages | 💤 Suspended |
| **last-rock-dev** | Last Rock Labs dev MCP | 💤 Suspended |

---

## ☁️ Cloudflare Workers (15 Apps)

### Core Infrastructure

| App | Purpose | Created | Status |
| --- | --- | --- | --- |
| **garza-mcp** | Main GARZA OS MCP server - primary brain | Dec 22 | ✅ Active |
| **garza-cloud-mcp** | Cloud orchestration MCP | Dec 24 | ✅ Active |
| **mcp-gateway** | MCP routing gateway | Dec 26 | ✅ Active |
| **garza-cf-ssh-backup** | SSH backup via Cloudflare | Dec 22 | ✅ Active |
| **garza-health-monitor** | System health monitoring | Dec 22 | ✅ Active |

### Communication & Automation

| App | Purpose | Created | Status |
| --- | --- | --- | --- |
| **beeper-scheduler** | Scheduled message delivery | Dec 24 | ✅ Active |
| **jessica-cron** | 💜 Jessica Program automation | Dec 26 | ✅ Active |
| **travis-friendship** | 🤝 Travis friendship nurturing | Dec 26 | ✅ Active |
| **email-craft** | Email → Craft integration | Dec 26 | ✅ Active |

### MCP Bridges

| App | Purpose | Created | Status |
| --- | --- | --- | --- |
| **garza-n8n-mcp** | N8N workflow MCP | Dec 25 | ✅ Active |
| **hoobs-mcp** | HOOBS home automation MCP | Dec 25 | ✅ Active |
| **scout-mcp-garza** | Scout APM monitoring MCP | Dec 24 | ✅ Active |
| **desktop-commander-mcp** | Desktop automation MCP | Dec 22 | ✅ Active |
| **chrome-control-mcp** | Browser automation MCP | Dec 22 | ✅ Active |

### Specialty

| App | Purpose | Created | Status |
| --- | --- | --- | --- |
| **garza-youversion** | Bible/YouVersion integration | Dec 25 | ✅ Active |

---

## 🔌 MCP Servers (External Connections)

### Primary MCPs

| Server | URL | Purpose |
| --- | --- | --- |
| **Beeper** | beeper-mcp.garzahive.com | Unified messaging (iMessage, Slack, etc.) |
| **Craft** | mcp.craft.do | Knowledge base & memory |
| **Stripe** | mcp.stripe.com | Financial operations |
| **Garza Hive MCP** | Via Fly.io | VPS operations |
| **Garza Home MCP** | garza-home-mcp.fly.dev | Home automation |
| **CF MCP** | mcp-cf.garzahive.com | Mac orchestration |

### Secondary MCPs

| Server | URL | Purpose |
| --- | --- | --- |
| **N8N MCP** | n8n-mcp.garzahive.com | Workflow automation |
| **SSH Backup** | ssh-backup2.garzahive.com | SSH redundancy |
| **Telnet Backup** | ssh-backup.garzahive.com | Telnet access |
| **Cloudflare** | bindings.mcp.cloudflare.com | CF Workers & D1 |
| **Zapier** | mcp.zapier.com | Zapier automations |
| **Coupler.io** | mcp.coupler.io | Data sync |

---

## 💜 System Programs (Active)

### Relationship Programs

| Program | Doc ID | Purpose | Frequency |
| --- | --- | --- | --- |
| **Jessica Program** | 15958 | Love & connection automation | Daily |
| **Travis Program** | 15862 | Friendship development | Weekly |
| **Jada Soul** | 14522 | AI companion persona | Continuous |

### Operational Programs

| Program | Doc ID | Purpose |
| --- | --- | --- |
| **Inbox Zero** | 13996 | Email automation |
| **GARZA SENTINEL** | 14306 | Security monitoring |
| **Memory System** | 14366 | Memory architecture |

---

## 🏗️ Infrastructure

### Servers

| Server | Location | Purpose | Status |
| --- | --- | --- | --- |
| **Mac Mini Boulder** | Boulder house | Desktop automation | ✅ Active |
| **GarzaHive-01** | DigitalOcean | VPS operations | 🔄 Phasing out |
| **GarzaHive-02** | DigitalOcean | VPS operations | 🔄 Phasing out |
| **Fly.io** | Edge | New hosting target | ✅ Preferred |

### Key Databases

| DB | Type | Purpose |
| --- | --- | --- |
| **Craft Space** | Document DB | Knowledge base |
| **garza-mcp** | D1 (18.9 MB) | Main structured data |
| **garza-cloud-mcp** | D1 (90 KB) | Cloud MCP state |
| **garza-relationships** | D1 | Relationship tracking |
| **garza-identity-graph** | D1 (118 KB) | Identity resolution |
| **garza-cache** | KV | Cache layer |
| **garza-state** | KV | Persistent state |
| **garza-mcp-kv** | KV | MCP key-value |
| **garza-cloud-mcp-storage** | R2 | Object storage |

---

## 📁 Key Documentation

| Doc | ID | Purpose |
| --- | --- | --- |
| GARZA OS Master Config | 14219 | All rules, voice, safety |
| MCP Registry | 7037 | Integration map |
| Identity Map | 6996 | Contact chat IDs |
| Run Registry | 6991 | Scheduled runs |
| Run State | 6995 | Cooldowns & status |

---

## 🔧 Maintenance Commands

### Health Checks

```bash
# Check CF Workers
curl https://[worker].garzahive.workers.dev/health

# Check MCP Server
curl https://[server].garzahive.com/health
```

### Quick Deploy (CF Worker)

```bash
cd [project] && wrangler deploy
```

---

## 📈 Roadmap

### In Progress

- [ ] Consolidate GarzaHive → Fly.io
- [ ] Unified dashboard UI
- [ ] Better health monitoring

### Planned

- [ ] Mobile push notifications
- [ ] Voice command interface
- [ ] Auto-healing infrastructure
