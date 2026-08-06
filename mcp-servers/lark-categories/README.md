# lark-mcp-categories

Full **Lark/Feishu OpenAPI MCP** (official `@larksuiteoapi/lark-mcp` v0.5.1) split into **16 category servers** behind one path router.

The full Lark surface is **1,255 tools**. Instead of one giant server, each category runs its own streamable-HTTPS lark-mcp instance (own `LARK_TOOLS` subset) and the router exposes them at:

```
https://lark-mcp.s1.garzalabs.com/<category>/mcp
```

## Categories (16)

| # | Category | Path | Tools | Port |
|---|----------|------|------:|------|
| 1 | admin | /admin/mcp | 64 | 8081 |
| 2 | apaas | /apaas/mcp | 37 | 8082 |
| 3 | approval | /approval/mcp | 29 | 8083 |
| 4 | attendance | /attendance/mcp | 37 | 8084 |
| 5 | docs | /docs/mcp | 68 | 8085 |
| 6 | bitable | /bitable/mcp | 46 | 8086 |
| 7 | calendar | /calendar/mcp | 41 | 8087 |
| 8 | contact | /contact/mcp | 91 | 8088 |
| 9 | hr | /hr/mcp | 218 | 8089 |
| 10 | drive | /drive/mcp | 52 | 8090 |
| 11 | hire | /hire/mcp | 178 | 8091 |
| 12 | im | /im/mcp | 66 | 8092 |
| 13 | mail | /mail/mcp | 67 | 8093 |
| 14 | task | /task/mcp | 74 | 8094 |
| 15 | vc | /vc/mcp | 55 | 8095 |
| 16 | misc | /misc/mcp | 132 | 8096 |

Domains → category map (see `categories.json` for the exact tool list):
mail→mail; im→im; calendar→calendar; contact+directory→contact; drive→drive; docx+sheets+wiki+base+minutes→docs; bitable→bitable; task→task; approval→approval; corehr→hr; hire→hire; vc→vc; attendance→attendance; apaas→apaas; admin+acs+application+auth+tenant+passport+mdm→admin; everything else→misc.

## Environment

| Var | Required | Description |
|-----|----------|-------------|
| `APP_ID` | yes | Lark app id (cli_xxx) |
| `APP_SECRET` | yes | Lark app secret |
| `LARK_DOMAIN` | no | Default `https://open.larksuite.com` |
| `PORT` | no | Router listen port (default 3000) |

Instance auth uses the app's `tenant_access_token` (auto). Personal-mailbox/user-level APIs need user identity (out of scope here).

## Health

`GET /healthz` → `ok` (upstream instances auto-restart on crash).

## Bifrost registry

Register each category in the Bifrost MCP registry as an HTTP (Streamable) client:
`https://lark-mcp.s1.garzalabs.com/<category>/mcp`, auth `none`, `tools_to_execute: ["*"]`.
