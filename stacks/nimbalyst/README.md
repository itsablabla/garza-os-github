# Nimbalyst — Web-Desktop Cursor-Cloud-Agents Replacement

Web-accessible XFCE desktop running [Nimbalyst](https://nimbalyst.com/) (visual workspace for
**Codex + Claude Code**), pre-wired to route Codex CLI calls through the custom ChatGPT-backed
endpoint at `https://llm.garzaos.cloud/v1`. $0 per request.

- **URL:** https://nimbalyst.garzaos.cloud
- **Base image:** `linuxserver/webtop:ubuntu-xfce` (KasmVNC)
- **Auth:** HTTP basic-auth (Traefik middleware)
- **VPS:** primary (`${VPS_IP}`)

## Files

| Path | Purpose |
| --- | --- |
| `Dockerfile` | Builds `nimbalyst-local:latest` with Nimbalyst AppImage + Codex CLI + Claude Code CLI baked in |
| `docker-compose.yml` | Compose service + Traefik labels for HTTPS + basic-auth |
| `TEST-PLAN.md` | End-to-end verification plan |
| `TEST-REPORT.md` | Verification results (all 5 assertions passed) |

## What gets baked into the image

- **`/etc/profile.d/garza-llm.sh`** — exports `OPENAI_BASE_URL`, `OPENAI_API_KEY` for all login shells
- **`/etc/bash.bashrc`** — sources the profile script for non-login shells (fixes Codex env inheritance)
- **`/etc/skel/.codex/config.toml`** — Codex provider config (`garza` provider, `wire_api="responses"`, trusted `/config`)
- **`/usr/local/bin/gtest`** — one-shot verification helper (runs a PONG round-trip)
- **`/custom-cont-init.d/10-garza-llm`** — entrypoint hook that on every container start:
  - seeds `/config/.codex/config.toml` + Nimbalyst desktop launcher if missing
  - runs `chown -R abc:abc /config` so root-owned regressions from ad-hoc `docker exec` can't break Codex

## Required secrets (do not hardcode)

Inject via environment at `docker compose up` time, NOT at build time:

| Variable | Description |
| --- | --- |
| `CUSTOM_LLM_API_KEY` | API key for `https://llm.garzaos.cloud/v1` (chatmock shim) |
| `NIMBALYST_BASIC_AUTH_PASSWORD` | HTTP basic-auth password for the web-desktop |

The committed Dockerfile references these as shell-expandable placeholders — replace with a real
build-time `ENV` only when rebuilding locally on the VPS. **Never commit the actual values.**

## Verification

From inside the container:
```bash
gtest
```
Expected output:
```
OPENAI_BASE_URL=https://llm.garzaos.cloud/v1
model: gpt-5.4
provider: garza
codex: PONG
```

## How it replaces Cursor Cloud Agents

Cursor Cloud Agents bill against the Cursor Pro subscription and refuse custom LLM endpoints. This
web-desktop gives the same "prompt → clone repo → edit → test → commit" UX, but:

- Runs on **your** VPS (not Cursor's cloud)
- Routes every model call through **your** ChatGPT subscription via the chatmock shim
- **$0 per task** — no Cursor credits, no paid OpenAI tokens
- Both Codex CLI and (optionally) Claude Code CLI available in any terminal

## Related services

- `services/chatmock-shim/` — the upstream LLM proxy that this image points at
- `services/openhands-byok/` — same-pattern BYOK on OpenHands Cloud
