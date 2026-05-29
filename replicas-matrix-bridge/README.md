# replicas-matrix-bridge

Cloudflare Worker that bridges a Matrix (Beeper) bot account to Replicas workspaces, mirroring the Telegram bridge UX. Sibling package to `replicas-telegram-bridge/`.

## Architecture (Phase 1 — unencrypted rooms)

```
You (Beeper/Element) → Matrix Client-Server API → MatrixListener DO (alarm-driven /sync)
                                                          ↓
                                                  /v1/replica spawn or follow-up
                                                          ↓
                                                  ReplicaPoller DO (per replica)
                                                          ↓
                                                  m.replace edit on the status message
```

Same `render.ts` / `markdown.ts` / state-machine semantics as the Telegram bridge — only the outbound calls differ. Tool-call lines, plan blocks (`Plan (X/N)` + `~item~`), narration messages, expandable old-log, phase emoji, time ticker, reactions on the user's prompt: all identical.

## Setup

### 1. Create a Beeper bot account

- Sign up `replicas-bot@…` on `beeper.com` as a second account.
- In Beeper Desktop → Settings → Help & About → **Show access token**. Format starts with `syt_…`.
- Note the bot's Matrix user ID (e.g. `@replicas-bot:beeper.com`) — visible at the top of the same page.

### 2. Wire Cloudflare

```bash
cd replicas-matrix-bridge
bun install

# Create the KV namespace (paste the returned id into wrangler.toml).
wrangler kv:namespace create MAP

# Set secrets.
wrangler secret put MATRIX_ACCESS_TOKEN     # syt_…
wrangler secret put MATRIX_USER_ID          # @replicas-bot:beeper.com
wrangler secret put REPLICAS_API_KEY        # same key the Telegram bridge uses

# Deploy.
wrangler deploy
```

### 3. Kick the listener once

```bash
curl -X POST https://replicas-matrix-bridge.<your-worker-subdomain>.workers.dev/start-listener
```

The cron trigger (`*/1 * * * *`) will keep it alive after that.

### 4. Invite the bot to a room

From your own Beeper account, invite `@replicas-bot:beeper.com` to a new DM. The listener auto-accepts within ~1s. Send a message — should produce 👀 + a status frame, edited in place as the agent works.

## Status frame example

```
🤔 Starting · 0s
```

becomes, mid-task:

```
🔧 Running · step 3 · 14s
<i>Reading the codebase to choose strategy…</i>

📋 Plan (1/3)
✓ scaffold
◦ wire it up
◦ test

🔧 ls -la src/
📖 src/index.ts
✏️ src/server.ts
```

and finally:

```
🎉 Done · 14s
```

— with the actual answer landing as a separate Markdown-rendered message right under it. The bot also sets reactions on the user's prompt (`👀` → phase → `🎉` or `😭`), pins the active status message, and keeps a typing indicator alive throughout.

## Cancelling a run

- Reply to the status message with `!cancel`. The listener picks it up and tells the DO to `DELETE /v1/replica/{id}`.

## Limitations

- **Unencrypted rooms only**. Beeper enforces E2EE by default; Matrix's Olm/Megolm key handling doesn't fit on Cloudflare Workers. Either use a manually-unencrypted DM, or wait for v2 (hosted listener with `matrix-bot-sdk`).
- **No inline keyboards**. Matrix has no equivalent; cancel is via `!cancel` reply.
- **No `<details>`**. Older log entries go into a plain `<blockquote>` (the user scrolls), not the expandable caret we use in Telegram.

## Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Worker entrypoint + HTTP routes |
| `src/listener.ts` | `MatrixListener` DO — holds the /sync long-poll |
| `src/poller.ts` | `ReplicaPoller` DO — Matrix-flavored ReplicaPoller |
| `src/dispatch.ts` | `handleMatrixMessage` — KV lookup → spawn/follow-up |
| `src/matrix.ts` | Matrix Client-Server API client (sendMessage, editMessage via m.replace, react via m.annotation, redact, pin, unpin, typing, joinRoom, sync, whoami) |
| `src/render.ts` | Pure render functions — copied verbatim from telegram bridge |
| `src/markdown.ts` | Markdown → HTML — copied verbatim from telegram bridge |
| `src/*.test.ts` | Vitest suite — 58 tests |
| `wrangler.toml` | KV/DO bindings, env vars, cron trigger |
