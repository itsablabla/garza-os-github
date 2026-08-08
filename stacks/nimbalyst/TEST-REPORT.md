# Nimbalyst Deployment — Test Report

**URL:** https://nimbalyst.garzaos.cloud
**Creds:** `nimba` / `${NIMBALYST_BASIC_AUTH_PASSWORD}`
**Session:** https://app.devin.ai/sessions/68ec8727b8b84f5296095f7bf0155627

## Results

| # | Assertion | Result |
|---|-----------|--------|
| A1 | HTTPS + basic-auth (401/200) | **passed** |
| A2 | Web-desktop stream renders | **passed** |
| A3 | `OPENAI_BASE_URL` + `OPENAI_API_KEY` set in terminal | **passed** |
| A4 | Codex CLI round-trips through our shim → ChatGPT | **passed** |
| A5 | Nimbalyst "Project Manager" window opens | **passed** |

## Critical proof (A4)
From the xfce4 terminal on the web-desktop, `gtest` ran `codex exec "reply with exactly the single word PONG…"` and produced:
```
model: gpt-5.4
provider: garza
sandbox: danger-full-access
session id: 019da3c4-5755-7ed0-9d3d-cfef7fb94bc5
user: reply with exactly the single word PONG and nothing else
codex: PONG
tokens used 71
```
`provider: garza` = our shim; `model: gpt-5.4` = the BYOK-routed ChatGPT model; `PONG` = real completion. End-to-end path proven: Traefik (basic-auth) → KasmVNC → xfce4-terminal → Codex CLI → `llm.garzaos.cloud/v1/responses` → ChatGPT subscription.

## Screenshot
![Nimbalyst PONG + GUI](/home/ubuntu/nimbalyst-pong-proof.png)

## Issues hit during execution (now fixed)
1. **env vars empty in login shells** — `/etc/bash.bashrc` isn't read by `bash -l`. Fix: wrote `/etc/profile.d/garza-llm.sh`.
2. **`/config/.codex` was root-owned** — earlier `docker exec nimbalyst bash` (no `-u abc`) created it as root → EACCES. Fix: `chown -R abc:abc /config/.codex`.
3. **Codex ignored `OPENAI_BASE_URL` env var** — it needs an explicit provider entry in `~/.codex/config.toml`. Fix: wrote config.toml with `model_provider="garza"` + `[model_providers.garza] base_url=https://llm.garzaos.cloud/v1 wire_api="responses"`.
4. **`wire_api = "chat"` rejected** by Codex 0.121.0. Fix: switched to `"responses"` — confirmed our shim implements the Responses API (`POST /v1/responses` returns HTTP 200 with a real `resp_…` object).
5. **"Not inside trusted directory"** — Codex requires a git repo or `--skip-git-repo-check`. Fix: `gtest` passes the flag.

## Persistence note
All fixes above were applied inside the running container. They will be lost on rebuild. Two followups needed (will do **outside** test mode if you want):
- Bake `/etc/profile.d/garza-llm.sh` and `/config/.codex/config.toml` into the Dockerfile.
- Add an `entrypoint` hook that `chown -R abc:abc /config` at startup to prevent the root-owned regression.

## Out of scope (not tested)
- Claude Code routing — we have no Anthropic-shaped shim; CLI will prompt for its own key on first use.
- XFCE desktop wallpaper/panel — dbus-login1 perms prevent xfdesktop/xfce4-panel from starting cleanly in webtop. Cosmetic only — the Nimbalyst window is visible and usable.
