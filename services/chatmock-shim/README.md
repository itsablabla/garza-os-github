# chatmock shim — ChatGPT OAuth proxy (`https://llm.garzaos.cloud/v1`)

OpenAI-compatible HTTP proxy that surfaces the user's interactive **ChatGPT** subscription as a
standard `/v1/chat/completions` + `/v1/responses` API. Based on the open-source
[`chatmock`](https://github.com/RayBytes/chatmock) project.

- **Endpoint:** https://llm.garzaos.cloud/v1
- **Host VPS:** Hostinger VPS `1589219` at IP `${SHIM_VPS_IP}` (separate from primary VPS)
- **Path on host:** `/opt/chatgpt-proxies/chatmock/`
- **Process:** Docker container `chatmock` fronted by Traefik

## Why this exists

Every autonomous-agent stack in this org (Nimbalyst / OpenHands / Agent Zero / Sim Studio / etc.)
accepts a custom OpenAI-compatible base URL. Pointing them at this shim routes every model call
through the user's ChatGPT Pro subscription → **$0 per request** regardless of caller.

## Custom patches applied

Two patches on top of upstream `chatmock`. Both are required for LiteLLM-based callers
(OpenHands, Agent Zero, etc.) to get working tool-call responses.

### 1. `model_registry.py` — alias non-`gpt-5*` slugs

LiteLLM auto-routes any `gpt-5*` model slug through the **Responses API** (`/v1/responses`), which
upstream ChatGPT returns as reasoning-only output (empty `output:[]`) when tools are defined.
Aliasing `chatgpt-4o` / `gpt-4o` to the upstream `gpt-5.4` lets callers pick a slug that
LiteLLM routes to `/v1/chat/completions` instead — which returns a proper message with tool calls.

```python
# /opt/chatgpt-proxies/chatmock/model_registry.py (lines 44-47)
ModelSpec(
    public_id="gpt-5.4",
    aliases=("gpt5.4", "gpt-5.4-latest", "chatgpt-4o", "gpt-4o", "chatgpt"),
    allowed_efforts=frozenset(("none", "low", "medium", "high", "xhigh")),
```

### 2. `responses_api.py` — strip rejected params

Upstream ChatGPT Responses API rejects several OpenAI-style params that LiteLLM always sends.
Strip them server-side before forwarding.

```python
# /opt/chatgpt-proxies/chatmock/responses_api.py (lines 91-95)
normalized.pop("max_output_tokens", None)
# Strip params that OpenAI Responses API rejects for gpt-5 reasoning models
for _k in ("temperature", "top_p", "frequency_penalty", "presence_penalty",
           "logit_bias", "logprobs", "top_logprobs"):
    normalized.pop(_k, None)
```

## Known routing behavior

| Caller | Model slug | Path used | Works? |
|---|---|---|---|
| LiteLLM (via OpenHands) | `openai/gpt-5.4` | `/v1/responses` | No — empty output when tools defined |
| LiteLLM (via OpenHands) | `openai/chatgpt-4o` | `/v1/chat/completions` | **Yes** — this is the slug to use |
| Codex CLI (Nimbalyst) | `gpt-5.4` | `/v1/responses` | Yes — Codex handles reasoning-only output |
| Direct `curl` | any | either | Yes |

## Verification

```bash
curl -sS https://llm.garzaos.cloud/v1/chat/completions \
  -H "Authorization: Bearer $CUSTOM_LLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"chatgpt-4o","messages":[{"role":"user","content":"reply PONG"}]}' \
  | jq -r '.choices[0].message.content'
# Expected: PONG
```

## Install plan

See `INSTALL-PLAN.md` for the original provisioning walkthrough (OAuth setup, Traefik route,
container lifecycle).

## Required secrets

Never commit to this repo:

| Variable | Description |
|---|---|
| `CUSTOM_LLM_API_KEY` | Bearer token accepted by the shim (issued by chatmock on deploy) |
| `CHATGPT_OAUTH_REFRESH_TOKEN` | OAuth refresh token for upstream ChatGPT |
| `SHIM_VPS_IP` | IP of the Hostinger VPS hosting this shim |

## Related

- `stacks/nimbalyst/` — Codex/Claude-Code web-desktop pointed at this shim
- `services/openhands-byok/` — OpenHands Cloud BYOK config pointed at this shim
