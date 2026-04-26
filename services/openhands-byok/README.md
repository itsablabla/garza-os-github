# OpenHands Cloud — BYOK + MCP configuration

How OpenHands Cloud at https://app.all-hands.dev is configured to run against the chatmock shim
(ChatGPT-backed, $0/request) with three additional MCP tools.

## LLM (BYOK)

Set via **Settings → LLM → Advanced**:

| Field | Value |
|---|---|
| **Custom Model** | `openai/chatgpt-4o` |
| **Base URL** | `https://llm.garzaos.cloud/v1` |
| **API Key** | `${CUSTOM_LLM_API_KEY}` |

### Why `chatgpt-4o` and not `gpt-5.4`

LiteLLM (used by OpenHands) auto-routes any `gpt-5*` model slug through the Responses API
(`/v1/responses`). The upstream ChatGPT backend returns empty `output:[]` on that path when
tools are defined, causing OpenHands to loop with *"Your last response did not include a function
call or a message."*

The shim's `model_registry.py` was patched to accept `chatgpt-4o` as an alias → LiteLLM routes
non-`gpt-5*` slugs through `/v1/chat/completions`, which returns proper tool-call messages.

See `services/chatmock-shim/README.md` for shim details.

## MCP tools

Configured via **Settings → MCP**. All three are official upstream MCP servers.

| Server | Transport | Config |
|---|---|---|
| **E2B** (code sandbox) | `STDIO` | Command: `uvx` · Args: `e2b-mcp-server` · Env: `E2B_API_KEY=${E2B_API_KEY}` |
| **Firecrawl** (web scrape/crawl) | `SHTTP` | URL: `https://mcp.firecrawl.dev/${FIRECRAWL_API_KEY}/v2/mcp` |
| **Tavily** (AI search) | `SHTTP` | URL: `https://mcp.tavily.com/mcp/?tavilyApiKey=${TAVILY_API_KEY}` |

Pre-existing MCP servers (left in place):
- `garza-mcp-unified` (SHTTP) — GARZA OS unified MCP gateway
- `rube.app/mcp` (SHTTP) — rube.app toolbox

## Required secrets (do not commit)

| Variable | Source |
|---|---|
| `CUSTOM_LLM_API_KEY` | chatmock shim (Bearer token) |
| `E2B_API_KEY` | https://e2b.dev/dashboard?tab=keys |
| `FIRECRAWL_API_KEY` | https://www.firecrawl.dev/app/api-keys |
| `TAVILY_API_KEY` | https://app.tavily.com/home |

All four keys are recoverable from `/opt/surfsense/.env` on the primary VPS.

## Files

| Path | Purpose |
|---|---|
| `TEST-PLAN.md` | End-to-end BYOK verification plan (PONG round-trip, 4 assertions) |
| `TEST-REPORT.md` | Verification results — all 4 assertions passed |

## Verification (LLM path only)

Start a new conversation at https://app.all-hands.dev and send:

> Reply with the single word PONG and nothing else. Do not use any tools.

Expected: reply contains `PONG`, model badge shows `openai/chatgpt-4o`, shim logs on the shim VPS
show `POST /v1/chat/completions HTTP/1.1 200` at the reply timestamp.

## Related

- `services/chatmock-shim/` — the LLM proxy OpenHands points at
- `stacks/nimbalyst/` — same BYOK pattern for Codex CLI on a self-hosted web-desktop
