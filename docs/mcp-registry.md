# MCP Registry & Integration Map

**Last Updated:** December 26, 2025
**Source:** Craft doc 7037

---

## Active MCP Servers

### 1. CF MCP (Mac Server - Brain)
**Role:** Control plane, orchestration, SSH gateway

| Tool | Purpose |
|------|---------|
| `ssh_exec` / `ssh_hosts` | Manage ALL remote servers including GarzaHive |
| `shell_exec` | Local Mac operations |
| `computer_use_*` | Docker computer use instances |
| `get_state` / `set_state` | Lightweight state/config storage |
| `log_event` / `query_logs` | Centralized logging |
| `telnet_exec` | Network device management |
| `fs_*` | File system operations |
| `beeper_*` | Messaging integration |
| `unifi_*` | Camera and sensor control |

### 2. Garza Home MCP (Fly.io)
**URL:** `https://garza-home-mcp.fly.dev/sse?key=garza-home-v2-...`
**Role:** Home automation, Bible tools, lightweight integrations

| Tool Category | Tools |
|---------------|-------|
| Security | Abode alarm control (`abode_*`) |
| Cameras | UniFi Protect (`unifi_*`) |
| Messaging | Beeper integration (`beeper_*`) |
| Email | ProtonMail (`*_protonmail`) |
| Knowledge | Bible tools (`bible_*`) |
| Graph | Graphiti knowledge graph (`graphiti_*`) |

### 3. Garza Hive MCP (Legacy - Phasing Out)
**URL:** `https://mcp.garzahive.com/sse`
**Role:** Worker node, persistent services, file operations

| Tool | Purpose |
|------|---------|
| `read_file` / `write_file` / `edit_block` | File operations |
| `start_process` / `interact_with_process` | Long-running processes |
| `docker_*` | Container workloads |
| `execute_command` | Direct server work |

### 4. Craft MCP
**URL:** `https://mcp.craft.do/links/.../mcp`
**Role:** Central knowledge base, persistent memory

| Category | Tools |
|----------|-------|
| Blocks | `blocks_add`, `blocks_get`, `blocks_update`, `blocks_delete`, `blocks_move` |
| Documents | `documents_create`, `documents_list`, `documents_search`, `documents_move`, `documents_delete` |
| Collections | `collections_create`, `collectionItems_add`, `collectionItems_get`, `collectionSchema_*` |
| Tasks | `tasks_add`, `tasks_get`, `tasks_update`, `tasks_delete` |
| Folders | `folders_list`, `folders_create`, `folders_move`, `folders_delete` |

### 5. Beeper MCP
**Desktop API:** localhost:23373
**REST API:** localhost:8765 with `X-API-Key: garza-beeper-2024`

| Tool | Purpose |
|------|---------|
| `search` | Search chats, participants, messages |
| `search_chats` | Search by title/network/participants |
| `search_messages` | Cross-chat message search |
| `list_messages` | Get messages from specific chat |
| `send_message` | Send text message |
| `get_chat` | Get chat metadata |
| `archive_chat` | Archive/unarchive |
| `set_chat_reminder` | Set reminder |

### 6. LRLab MCP (Last Rock Labs)
**URL:** `https://lrlab-mcp.fly.dev/sse?key=lrlab-dev-v2-...`
**Role:** Development tools, Scout APM integration

| Tool | Purpose |
|------|---------|
| `scout_list_apps` | List Scout APM applications |
| `scout_get_app_metrics` | Get application metrics |
| `scout_get_insights` | Get N+1 queries, memory bloat |
| `scout_get_traces` | Get trace details |

---

## Fly.io SSH Relays

### Relay 1 (garza-ssh-relay.fly.dev)
- **API Key:** `gsr_48ff311f08fe0a13c0bbcc0a`
- **Region:** DEN (Denver)
- **Used by:** Garza Home MCP

### Relay 2 (garza-ssh-relay-2.fly.dev)
- **API Key:** `gsr2_c9d78e33df694b3c487455c2`
- **Region:** DFW (Dallas)
- **Used by:** Garza Hive MCP

### Available SSH Hosts
| Alias | IP | Description |
|-------|-----|-------------|
| garzahive-01 | 192.241.139.240 | GarzaHive VPS |
| ssh-bastion | 143.198.190.20 | SSH Bastion |
| oasis | 206.189.203.81 | Oasis Prod |
| assets | 167.99.145.135 | Assets Prod |
| fwa | 157.230.182.134 | FWA Exchange |
| paynomad | 143.198.228.240 | PayNomad Prod |
| mac | (local) | Mac Mini |

---

## Native Integrations (Not MCP)

### Google Calendar
- `list_gcal_calendars`, `fetch_gcal_event`, `list_gcal_events`, `find_free_time`
- Default calendar: `primary`
- User timezone: `America/Denver`

### Gmail
- `read_gmail_profile`, `search_gmail_messages`, `read_gmail_thread`
- Supports Gmail search operators

### Google Drive
- `google_drive_search`, `google_drive_fetch`
- Query operators: name, fullText, mimeType, modifiedTime, starred, parents

---

## Quick Reference

| Need | Tool/Server |
|------|-------------|
| Send message | Beeper MCP |
| Store knowledge | Craft MCP |
| Home automation | Garza Home MCP |
| File operations | CF MCP (local) or Garza Hive |
| SSH to servers | CF MCP `ssh_exec` or Fly Relay |
| Calendar events | Google Calendar |
| Email | Gmail + ProtonMail |
| Web research | `web_search` + `web_fetch` |
| Past conversations | `conversation_search` |
