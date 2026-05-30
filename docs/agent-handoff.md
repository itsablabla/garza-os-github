# Replicas Bridges — Agent Handoff (2026-05-29)

> You're the next agent on this work. Read this top-to-bottom before touching code.
> Jaden has limited patience for re-explanations; this doc exists so you don't waste it.

---

## 1. What this is

Two Cloudflare Workers that bridge between chat platforms and the **Replicas** agent runtime so a user can `@Jada` (the bot persona) in Beeper / Matrix or Telegram and have a Replicas workspace spawn, run their prompt, and surface tool calls + final reply back into the chat in real time.

| Bridge | Repo path | Worker name | Latest deploy |
|---|---|---|---|
| **Matrix** (Beeper, matrix.org) | `replicas-matrix-bridge/` | `replicas-matrix-bridge` | `941d8c95` (commit `e5f0ae3`) |
| **Telegram** | `replicas-telegram-bridge/` | `replicas-telegram-bridge` | `e050ce54` (commit `8728c39`) |

Both live in repo **`itsablabla/garza-os-github`**, branch **`feat/replicas-telegram-bridge`** (yes, the matrix work happens on the telegram-named branch — historical).

All commits through `e5f0ae3` are pushed.

## 2. Who you're working for

**Jaden Garza.** Owner of Garza OS / Replicas. He is:

- Fast-moving. Will tell you "you did a bad job" if a change makes the chat UX worse.
- Specific about likes: **real-time animation of tool calls, line by line**. The streaming feel IS the product. He explicitly called out the 👀 → 🎉 prompt-reaction emojis as core to the experience.
- Allergic to: invisible work, missing outcomes (Done frame without a body), multi-message fragmentation, fancy UI rewrites that hide tool calls behind expandables.

**What I got wrong in this session** (so you don't repeat):

1. **Focus-window UI rewrite (commit `8728c39`)** — I built a three-tier `CURRENT / RECENT / OLDER` window that collapsed tool calls into compressed lines and an expandable. Jaden hated it: "Most of the changes you made were pretty terrible." Reverted in `dd74c60`. The tool-call stream IS the showpiece — do not hide it.
2. **Took too long to notice the reaction emojis were silently 429ing** under rate limit. They are user-facing status signals — treat them as load-bearing.
3. **Telegram bridge still has the focus-window code** as of commit `8728c39`. Matrix is reverted; TG isn't, because Jaden was actively testing Matrix only. **Open item:** revert TG's `render.ts` to match Matrix when you get to it.

## 3. End-to-end flow (Matrix bridge)

```
User sends "@Jada do X" in a Beeper room
  ↓
MatrixListener DO (global, alarmed every 1s)
  → polls /sync
  → decrypts m.room.encrypted via OlmVault (Megolm v1)
  → for each m.room.message in joined rooms (filtered by self-tx + shouldHandleMessage)
       → calls dispatch.handleMatrixMessage(roomId, eventId, body)
  ↓
dispatch.handleMatrixMessage (in-process, src/dispatch.ts)
  → KV dedupe by eventId (60s TTL)
  → fires 👀 reaction on user's prompt (now with retry-on-429)
  → fires "🤔 Starting · 0s" initial frame in parallel with Replicas spawn
  → if existing replica for room → sendFollowUp + startWatcher (parallel)
  → else → createReplica + startWatcher
  → /ack endpoint forwards ackReactionId + initialStatusEventId to the watcher
  ↓
ReplicaPoller DO (one per replicaId, alarmed every 180ms while active)
  → fetch /v1/replica/{id}/history
  → diff against lastSeenCount, project new events:
       claude-assistant.thinking   → currentAction (italic preview)
       claude-assistant.tool_use   → push "🔧 <code>cmd</code>" to lines, bump phase
       claude-assistant.text       → parsePlan OR push "💬 <i>narration</i>"
       claude-user.tool_result     → push "<i>↳ output</i>" or "<i>✗ error</i>"
       claude-system               → systemInfo (model + MCP count + tool count)
       context-usage               → contextUsage (ctx %)
       claude-result               → setTerminal(Done, resultHtml=markdownToHtml(result))
  → renderAndSend on each tick: edits the SAME Matrix event (statusEventId)
  → on 429: terminal renders retry inline, non-terminal renders defer
  → after Done: pendingCleanup=true, 30s alarm wipes state
```

## 4. Critical files (Matrix bridge)

All paths relative to `replicas-matrix-bridge/src/`.

### Hot path — touch these most

- **`poller.ts` (764 lines)** — ReplicaPoller DO. The state machine.
  - L74-85: timing constants. **Don't tighten these** — they were loosened (1000→2000ms edit interval, 3000→4000ms ticker) because matrix.org rate-limits at ~30 events/min/room.
  - L96-132: `fetch()` — routes `/watch`, `/cancel`, `/ack`, `/debug`.
  - L134-228: `handleWatch` — steering path (existing turn, mid-flight follow-up) vs fresh-spawn path. Steering gate now includes `priorPhase !== DONE && priorPhase !== FAILED` (commit `3dc3f33`) to close the race window where a follow-up landed between `setTerminal` and `pendingCleanup`.
  - L260-518: `alarmInner` — the diff loop. Reads /history, projects events into `lines[]`, `plan`, `systemInfo`, `resultMeta`. Handles `sawResult` → `setTerminal` → mark cleanup. **Note:** the trailing `💬 narration` line is popped on `sawResult` (commit `9394264`) so the embedded `resultHtml` in Done doesn't duplicate the body.
  - L570-655: `renderAndSend` — the edit-or-send code. **Terminal renders retry on 429 inline (4 attempts honoring `retry_after_ms`)** because the alternative is the 30s cleanup wiping state before the Done frame lands. Non-terminal renders defer via `rateLimitedUntil` in DO storage.
  - L657-676: `setTerminal` — accepts `resultHtml`. When set, it gets embedded inline in the Done frame.
  - L678-722: `swapReaction` — redacts prior reaction + places new one. Both halves retry up to 4 times on 429 (commit `dd74c60`).

- **`render.ts` (444 lines)** — pure rendering. Platform-independent (Matrix HTML).
  - `renderActive` / `renderTerminal` — the simple `recent[-4]` + older-blockquote-expandable model. **Do not rebuild the focus window here.**
  - `renderPlan` — first not-done item gets `►` marker.
  - `formatCost` — `$0.08` not `$0.0781`; sub-cent → `<$0.01`; drops decimals past $10.
  - `StatusState.terminal.resultHtml` — when set, `renderTerminal` embeds it below the op log. Single message per turn (avoids the Beeper-drops-second-message bug).

- **`matrix.ts` (334 lines)** — Client-Server API helpers.
  - `MatrixError` carries `retryAfterMs` parsed from 429 bodies (commit `d79c798`).
  - `sendMessage` accepts an optional `txnId` for idempotent retries (commit `82d3256`).
  - `editMessage`, `react`, `redact`, `pin`, `unpin`, `sync`, `joinRoom`, `typing`.

- **`dispatch.ts` (234 lines)** — in-process turn-spawn or follow-up.
  - `reactWithRetry` helper (commit `dd74c60`) for the initial 👀 ack so it survives 429.
  - `prefixWithRoutingHeader` — wraps user text with `[matrix:room=...:event=...]` + hint comment so the Replicas agent knows how to format its reply.
  - Reads per-room model override from KV (`!model` command — commit `2837f9b`).

- **`listener.ts` (347 lines)** — MatrixListener DO. Single global instance.
  - 1s alarm calls `/sync` with a 28s long-poll.
  - Filters out the bot's own sends via `ev.unsigned.transaction_id` (works even when the bot account is the same Matrix user — "self-bot mode", see memory).
  - Decrypts incoming `m.room.encrypted` via Megolm (calls `tryDecrypt`), looking up session keys from static import + OlmVault.
  - `shouldHandleMessage` — 2-person room → always dispatch; larger room → require `@mention`.
  - `!cancel` and `!model` commands handled inline (no replica spawn).

### Encryption surface (only touch if you must)

- **`megolm.ts`** — pure-JS Megolm v1 decryption (AES-CBC + HMAC). No WASM needed.
- **`olm.wasm` + `olm-init.ts`** — @matrix-org/olm WASM bootstrap for CF Workers via `OLM_OPTIONS.instantiateWasm` shim.
- **`olm-vault.ts` (455 lines)** — OlmVault DO. Holds the bot's Olm Account pickle, identity keys, OTK pool, and the live keystore of Megolm sessions captured via `/sendToDevice` `m.room_key` events.
- **`ssss.ts`** — Recovery key decode + SSSS (Secret Storage v1) decryption for cross-signing keys.
- **`megolm-keys.ts`** — Parses Element key export JSON.

**Memory note**: the bot has a dedicated device on matrix.org (`device_id = Ww3fWv0z7s`). Don't reuse Jaden's Element session token — `/keys/upload` overwrites. (See `~/.claude/projects/-home-user-workspaces/memory/feedback_matrix_dedicated_device.md` if it exists.)

### Telegram bridge

`replicas-telegram-bridge/src/` mirrors matrix structure minus the encryption:
- `index.ts` — webhook handler + `/start`/`/cancel`/`/model` commands
- `poller.ts` — same ReplicaPoller pattern, slightly different message-cap handling (TG's 4096-char `editMessageText` limit)
- `render.ts` — same render model. **Has stale focus-window code** as of commit `8728c39`. Revert when convenient (mirror Matrix's `render.ts`).
- `markdown.ts` — markdown → Telegram HTML

The Telegram bridge **keeps the separate final-reply send** (no embed-in-Done-frame) because TG's per-message char cap is too tight.

## 5. The state model (Durable Object storage keys)

Per-replica `ReplicaPoller` instance stores:

| Key | Type | Purpose |
|---|---|---|
| `watch` | WatchSpec | replicaId, roomId, startEventId, userText, ackReactionId, initialStatusEventId |
| `lastSeenCount` | number | events.length watermark for diff |
| `lines` | string[] | the rolling tool-call/narration log; this is what renders |
| `phase` | Phase | STARTING/PLANNING/EDITING/RUNNING/TESTING/SHIPPING/DONE/FAILED |
| `stepCount` | number | bumped per tool_use |
| `currentAction` | string | latest thinking/narration preview (italic) |
| `plan` | PlanState | parsed from "Plan (N/M)" headed text blocks |
| `systemInfo` | SystemInfo | model + mcpCount + mcpActive + toolCount |
| `contextUsage` | ContextUsage | totalTokens, maxTokens, pct |
| `resultMeta` | ResultMeta | costUsd, inputTokens, outputTokens |
| `statusEventId` | string | the Matrix event we keep editing |
| `reactionEventId` | string | for swapping 👀 → 🎉 |
| `lastRendered` | string | dedup check (skip re-edit if text unchanged) |
| `lastEditAt` | number | enforces EDIT_MIN_INTERVAL_MS |
| `lastTypingAt` | number | enforces TYPING_INTERVAL_MS |
| `pinned` | boolean | pinned the status frame on first send |
| `pendingCleanup` | boolean | terminal reached; alarm in 30s will wipe everything |
| `rateLimitedUntil` | number | timestamp; non-terminal renders skip until this passes |
| `startedAt` | number | turn start time for elapsed display |

## 6. Recent commits — what + why

Newest first. Use these when triaging "why does this exist".

| Hash | Title | Why |
|---|---|---|
| `e5f0ae3` | terminal renders retry on 429 | Done frame was silently dying when the edit 429'd because the 30s cleanup wiped state |
| `dd74c60` | revert focus window; harden reactions | Jaden hated the UI rewrite; reactions were silently 429ing |
| `d79c798` | stop fragmenting status frames under rate limit | matrix.org 429s + fall-through to `sendMessage` created N bubbles per turn |
| `0a552a9` | embed result body in Done frame | Beeper was dropping the separate final-reply message; embedded body = single message per turn |
| `8728c39` | **(REVERTED on Matrix, stale on TG)** focus-window UI | over-engineered; Jaden wants the line-by-line stream |
| `3dc3f33` | close setTerminal→pendingCleanup race | `🎉` was landing prematurely on the next prompt during a ~1s window |
| `9394264` | kill Done-frame edit loop + cross-tick narration dup | trailing `💬` survived past terminal; drain-pending fell through to ticker |
| `82d3256` | kill duplicated final-reply renders | retry loop without stable txn id was double-sending |
| `fcf6da1` | Telegram parity with Matrix tier 1+2 perf | TTFB cut on TG side |
| `e9722e7` | surface every Replicas event + restyle | claude-system, claude-user tool_result, claude-result, context-usage all projected |

## 7. Production endpoints

| URL | What |
|---|---|
| `https://replicas-matrix-bridge.jadengarza.workers.dev/health` | quick liveness ping |
| `https://replicas-matrix-bridge.jadengarza.workers.dev/debug/listener` | inspect MatrixListener since-token + alarm |
| `https://replicas-matrix-bridge.jadengarza.workers.dev/debug/watcher/{replicaId}` | inspect a ReplicaPoller DO's full state + next alarm |
| `https://replicas-matrix-bridge.jadengarza.workers.dev/debug/vault/identity` | OlmVault curve25519 + ed25519 public keys |
| `https://replicas-matrix-bridge.jadengarza.workers.dev/debug/vault/keystore` | live captured Megolm session keys |
| `https://replicas-telegram-bridge.jadengarza.workers.dev/` | TG webhook root |

Admin endpoints (POST): `/admin/listener/reset`, `/admin/vault/{reset,cross-sign,bootstrap,upload-device,upload-otks}`.

## 8. Replicas API surface used

Read `~/.replicas/REPLICAS_API_CONTROL_PLANE.md` first. Key endpoints:

- `POST /v1/replica` — spawn a new replica. We use `environment_id`, `coding_agent="claude"`, `model` (per-room override), `lifecycle_policy="delete_after_inactivity"`, `auto_stop_minutes=60`, `metadata.matrix_room_id`/`matrix_event_id`.
- `POST /v1/replica/{id}/messages` — send a follow-up. 404/410 means the replica expired; we cancel-and-respawn.
- `GET /v1/replica/{id}/history?include=content&verbose=1` — full event stream, polled every 180ms. **The API does NOT support `since`/`offset`/`limit` cursors** — confirmed via probe (Tier 4 perf was a no-op).
- `DELETE /v1/replica/{id}` — used by `/cancel` handler.

Auth: `Authorization: Bearer ${REPLICAS_API_KEY}` + `Replicas-Org-Id: 778b1aa3-4327-45a4-9874-c8a3a72df610`.

## 9. Operational essentials

### Deploy

```bash
# Matrix
cd replicas-matrix-bridge && CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... npx wrangler deploy

# Telegram
cd replicas-telegram-bridge && CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... npx wrangler deploy
```

CF creds live in the Garza OS Global env (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`) — pull from the Replicas env vars endpoint if not in shell.

### Tail logs

```bash
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
  npx wrangler tail replicas-matrix-bridge --format pretty
```

Filter for the symptom you're hunting — `editMessage`, `react`, `429`, `editMessage 429`, `pendingFinalReply` (legacy), etc.

### Inspect a stuck watcher

`GET /debug/watcher/{replicaId}` returns `{state: {...}, alarmAt}`. Empty `state` = the DO has been wiped (cleanup ran or never started). `alarmAt = null` post-cleanup is normal.

### Typecheck + tests

```bash
cd replicas-matrix-bridge && bun run typecheck && bun test src/render.test.ts
cd replicas-telegram-bridge && bun run typecheck && bun test src/render.test.ts
```

`bun test` will fail on some old `matrix.test.ts` tests because of a `vi.stubGlobal is not a function` mismatch — those are pre-existing vitest-under-bun issues, **not your changes**. Ignore unless they're in `render.test.ts`.

## 10. Known issues / open work

1. **Telegram bridge still has focus-window code** — commit `8728c39` ships with `parseOps`/`renderOpsFocused`/`compressToolLine` in `replicas-telegram-bridge/src/render.ts`. Matrix was reverted in `dd74c60` but Telegram wasn't because Jaden was testing Matrix. To revert: copy `replicas-matrix-bridge/src/render.ts` and `render.test.ts` onto the TG side (they were already file-identical before the focus-window divergence, EXCEPT for the `MAX_RENDER_CHARS` cap — TG should stay at 3800 because of the 4096-char `editMessageText` limit). Telegram poller doesn't use `resultHtml` embedding either — keep TG's separate-message flow.

2. **The DeepSeek V3.1 empty-turn bug on OpenClaw CT 232** — unrelated to bridges; Jaden's note. ~1 in 3 turns return `stopReason=stop payloads=0` on the Jada persona with longer history. Options offered: cap `dmHistoryLimit` on main agent (currently only dev2 has it at 8), or switch to Hermes 4 405B. Not acted on. See memory file `project_openclaw_ct232.md` if it exists.

3. **Beeper-side rendering of Matrix edits** — Beeper sometimes shows each edit as a separate visible bubble in its UI (visible in screenshots). My read: this is a Beeper rendering decision, not a Matrix wire issue (the latest edit IS the canonical state). The fix on our side was minimizing the number of edits (slower cadence + reaction retries). If Jaden is still seeing fragmentation post-`e5f0ae3`, the next move is probably to verify edits are landing as real edits (not new messages from the 429 fall-through, which the latest code prevents).

4. **Rate-limit budget is per-room** — multiple concurrent group rooms eat the budget. If Jaden's bot gets popular, may need exponential backoff sharing across rooms via a global counter in OlmVault DO or a dedicated rate-limit DO.

5. **No fallback if Done edit ultimately fails after 4 retries** — currently it logs and gives up. If matrix.org is rate-limited for 30+ seconds, the cleanup wipe loses the embedded answer body. Possible fix: send a separate fresh message with just the result body as last resort, accepting fragmentation only at the worst case.

## 11. The Slack thread

Jaden runs this work from Slack DM `D0B6JL0UTT8`, thread `1780030352.364909` — that's where status updates land. Slack creds in shell env (`SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`, `SLACK_THREAD_TS`). When you ship anything user-visible, post a short summary there.

## 12. Things Jaden specifically likes (don't break)

- **Live edits** — the bot's frame updates every couple seconds during a turn. Slowing the cadence is fine; turning it into "send a new message per phase change" is not.
- **Phase emoji on the user's prompt** — 👀 on receive, 🎉 / 😭 at completion. These are the AT-A-GLANCE status signals. They have retry-on-429 now. **Audit them if anything related changes.**
- **Sonnet 4.6 default + per-room `!model` command** — switching to sonnet/opus/haiku alias or full id (commit `2837f9b`).
- **Auto-respond in 2-person rooms** without requiring mentions (commit `2837f9b`).
- **Markdown rendering of the agent's final reply** — bold, inline code, lists, headers. Done by `markdownToHtml` and now embedded in the Done frame for Matrix.

## 13. Things Jaden has explicitly disliked (don't reintroduce)

- The focus-window collapse of tool calls. Tool calls are the showpiece.
- Stacked reaction emojis (the 👀 and 🎉 both staying — must redact prior before placing next).
- Two messages per turn (Done frame + separate reply) in Matrix when one would do.
- Empty Done frames where the answer never lands.
- Big rewrites without checking in first. **Talk before you ship anything beyond a clear bug fix.**

## 14. Where to find more

- `~/.replicas/REPLICAS_API_CONTROL_PLANE.md` — Replicas REST surface
- `~/.replicas/plans/matrix-bridge-plan.md` — original architecture sketch
- `~/.replicas/plans/telegram-status-ux-research.md` — UX research for status frames
- `~/.replicas/plans/factory-droid-status-research.md` — research for design patterns
- `~/.replicas/plans/2026-05-29_bridge-ui-cleanup-proposal.md` — the focus-window proposal (now superseded; kept as historical reference for what NOT to do)
- `~/.claude/projects/-home-user-workspaces/memory/MEMORY.md` — agent memory index, contains feedback notes and project state

## 15. First moves I'd recommend

1. **Read the latest commits** (`git log --oneline -20`) and skim `replicas-matrix-bridge/src/poller.ts` end-to-end (it's 764 lines but well-structured).
2. **Verify the deployed version** matches HEAD: `npx wrangler deployments list | head` should show `941d8c95-5b5f-4dea-aed5-4acc8b44d80d` as current for matrix.
3. **Send a test prompt** in Beeper to confirm end-to-end works (look for 👀 → in-place "Starting → Planning → Running → Done" updates → 🎉 with embedded body).
4. **If Jaden flags more wonkiness in group chats**, tail logs first (`wrangler tail replicas-matrix-bridge`) and look for `429` / `editMessage 429` patterns before assuming a code bug.
5. **Then go back to the Telegram revert** (open issue #1 above) — should be quick: copy `render.ts` from matrix, adjust `MAX_RENDER_CHARS`, leave poller untouched.

Good luck. Don't rebuild the focus window.
