# Nimbalyst Deployment — Test Plan (v2, post-troubleshoot)

## Context (not a PR)
This verifies the Nimbalyst Docker deployment on the VPS:
- URL: `https://nimbalyst.garzaos.cloud`
- Auth: basic-auth `nimba` / `${NIMBALYST_BASIC_AUTH_PASSWORD}`
- Goal: confirm the web-desktop renders, Nimbalyst GUI opens, AND Codex (from a terminal in the web-desktop) routes to `https://llm.garzaos.cloud/v1` (ChatGPT-backed, $0 per request)

## Root-cause fixes applied during troubleshooting
| Issue | Fix |
|---|---|
| env vars missing in login shells | Wrote `/etc/profile.d/garza-llm.sh` with `OPENAI_BASE_URL`/`OPENAI_API_KEY` |
| `/config/.codex` owned by root → EACCES for abc | `chown -R abc:abc /config/.codex` |
| Codex ignoring env vars (went to api.openai.com) | Created `/config/.codex/config.toml` with `model_provider="garza"` + `[model_providers.garza] base_url=https://llm.garzaos.cloud/v1 wire_api="responses"` |
| `wire_api="chat"` rejected by Codex 0.121.0 | Switched to `wire_api="responses"` (our shim supports Responses API — verified HTTP 200 on `POST /v1/responses`) |
| "Not inside trusted directory" | Pass `--skip-git-repo-check` to `codex exec` |

## Primary flow (to execute in browser)
1. Open `https://nimbalyst.garzaos.cloud`, authenticate, wait for Selkies stream.
2. Observe the Nimbalyst Project Manager window (already auto-launched in the container).
3. In the xfce4-terminal window on the desktop, run `gtest` (a helper that sources env, cd's to `/config`, and runs `codex exec`).
4. Observe PONG in the terminal output.

## Assertions (concrete pass/fail)
| # | Assertion | Expected | Pass criterion |
|---|-----------|----------|----------------|
| A1 | HTTPS + basic-auth gate | Unauth → 401; auth → 200 | Already verified via curl |
| A2 | Web-desktop stream renders | Selkies WebRTC delivers frames; Nimbalyst window visible | Screenshot shows `Project Manager - Nimbalyst` window |
| A3 | OPENAI_BASE_URL exported in terminal | Terminal prints `OPENAI_BASE_URL=https://llm.garzaos.cloud/v1` and `OPENAI_API_KEY=sk-garza-d284c2...` | Exact string match |
| A4 | Codex end-to-end via our shim | Terminal prints `codex` block followed by `PONG`, `provider: garza`, `model: gpt-5.4` | "PONG" appears in codex output |
| A5 | Nimbalyst window opens | XWindows tree shows `Project Manager - Nimbalyst` | Visible in screenshot from A2 |

## Already verified via shell (not yet via browser)
- A3: `echo OPENAI_BASE_URL=$OPENAI_BASE_URL` → `https://llm.garzaos.cloud/v1`
- A4: `codex exec --skip-git-repo-check "reply with exactly the single word PONG..."` → `codex\nPONG\ntokens used 1,224\nPONG` with `provider: garza, model: gpt-5.4`
- A5: `xwininfo -root -tree` lists `Project Manager - Nimbalyst` (1100x700)

## What could hide a broken deployment (adversarial)
- If Codex weren't really hitting our shim: A4 would fail with `api.openai.com 401` (this is what happened before we set `wire_api="responses"` + config.toml — adversarial check passed by observing that failure mode).
- If basic-auth were broken: A1 fails before anything else (Selkies 401).
- If the Nimbalyst launcher were broken: A5 fails (no window).
- If the shim proxy weren't actually routing to ChatGPT: A4 would return a stub/error; we get a real gpt-5.4 response with token count.

## Out of scope
- Claude Code (no Anthropic-protocol endpoint; will prompt for its own key)
- WebRTC stream performance / codec settings
- Persistence of config.toml across container rebuild (will be addressed post-test as a permanent Dockerfile change)
