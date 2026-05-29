# Research: ACP + Telegram Bot Status Surface Patterns

**Date:** 2026-05-29
**Why:** Jaden asked for a deep-research pass on how *open ACP / AI Telegram bots* surface live status. The bridges already work; this is to find any pattern we should borrow vs. confirm we're aligned with the field.

## Detailed Deep-Dive (2026-05-29, second follow-up)

Read every relevant TG plugin file in [Open-ACP/OpenACP](https://github.com/Open-ACP/OpenACP) end-to-end after Jaden asked to go deeper. This section documents the actual implementation mechanics — race-conditions, dedup tricks, state machines — that the prior summary missed. Each subsection cites concrete files + line ranges.

### 1. ThinkingIndicator state machine ([`activity.ts:33-147`](https://github.com/Open-ACP/OpenACP/blob/main/src/plugins/telegram/activity.ts#L33-L147))

```
                      show()                  dismiss()/finalize…()
   [idle, no msg]  ────────────►  [showing]  ─────────────────────►  [dismissed, msg stays in chat]
                                       │  ▲
                              every 15s│  │ refresh timer rearms
                                       ▼  │
                                "💭 Still thinking... (Ns)"
                                       │
                            elapsed ≥ 3min: stopRefreshTimer
```

Concrete details that matter:

- **`sending` + `dismissed` flags both checked inside the sendQueue continuation.** Lines 67-73: after `await sendQueue.enqueue(...)` resolves, re-checks `this.dismissed` because the agent may have started streaming text during the queue wait. If dismissed, the message stays in chat (no delete call to save API cost) but `msgId` is never captured.
- **Refresh timer is internal, not driven by alarms.** `setInterval(..., 15_000)` runs in-process; doesn't survive worker restart. Workers reset = thinking indicator goes stale until next event. Acceptable because they run a long-lived Node process, not a CF Worker.
- **3-minute auto-stop is enforced by the refresh callback itself** (line 118: `if (Date.now() - this.showTime >= THINKING_MAX_MS) { stopRefreshTimer; return }`). No separate timeout. If thinking runs >3 min, the message just stops updating at the last "Still thinking... (180s)" and that text remains forever.
- **`finalizeWithViewerLink(url)` is the "high mode" exit.** When the tunnel service is configured, the agent's full chain-of-thought is stored to a web viewer; the indicator gets edited to `💭 Thinking...      <a href="...">View thinking</a>`. This is the OpenACP equivalent of our `<blockquote expandable>` collapse — but as a separate hosted page, not inline expansion.

### 2. ToolCard ([`activity.ts:159-294`](https://github.com/Open-ACP/OpenACP/blob/main/src/plugins/telegram/activity.ts#L159-L294))

The most complex piece. Renders a SINGLE Telegram message representing the live state of N tool calls — header `<b>📋 Tools (M/N)</b>` then completed-tools-first, then plan section, then running-tools.

Key implementation details:

- **`flushPromise` is a Promise chain.** Every `_sendOrEdit` is chained via `.then(() => this._sendOrEdit(...))`. Serializes ALL card edits — no two card edits run concurrently, period. Snapshots flow through the chain in order even when emitted faster than Telegram can accept them.
- **Snapshot dedup at line 236**: `if (this.msgId && fullText === this.lastSentText) return`. Cheap text equality check before any API call. Stops re-edits when the render didn't actually change.
- **Overflow strip for >4096 chars** (lines 222-233): if the rendered card exceeds Telegram's per-message limit, the spec list is mapped with `outputContent: null` and re-rendered. Drops the inline tool-output previews while keeping the tool-call headers + status. Only the FIRST chunk gets this treatment.
- **Overflow chunks recycled as edits, not new sends each render** (lines 261-279): chunks 1..N go into separate Telegram messages tracked in `overflowMsgIds[]`. Subsequent renders that produce the same chunk count edit those messages in place. If chunk count DECREASES, stale messages are deleted with `deleteMessage`.
- **`aborted` flag for destroy()**: if `destroy()` runs while a flush is in flight (e.g., session cancelled), the next `_sendOrEdit` checks `this.aborted` and bails out without making the API call.

### 3. ActivityTracker — the orchestrator ([`activity.ts:309-490`](https://github.com/Open-ACP/OpenACP/blob/main/src/plugins/telegram/activity.ts#L309-L490))

Owns the ThinkingIndicator + current ToolCard + (importantly) the **previous** ToolCard.

```
                   onNewPrompt()                                   onTextStart() / onThought()
   [idle]  ──────────────────────────►  [new turn]  ───────────────────────────────────────►  ...
              ↓                                       ↓
       previousToolCard ← undefined           sealToolCardIfNeeded():
       toolStateMap ← clear()                   previousToolCard ← toolCard
       toolCard ← new ToolCard                  toolStateMap ← new ToolStateMap()
                                                toolCard ← new ToolCard
                                                                ↓
                                                onToolUpdate() arrives for an OLD tool id:
                                                    if previousToolStateMap.get(id): route THERE
                                                    else: route to current
```

Two patterns we should pay attention to:

- **The seal-and-keep pattern.** `sealToolCardIfNeeded()` finalizes the current card, moves it to `previousToolCard`, and opens a fresh card. The previous card is NOT deleted — it stays in chat as historical record AND its `previousToolStateMap` is kept around so that late-arriving `onToolUpdate` events for tools that started before the seal still update the right (old) card. Line 429-436 explicitly handles this out-of-order case.
- **The clear-on-new-prompt pattern.** `onNewPrompt` resets `previousToolCard = undefined` AND clears the `toolStateMap`. So a new prompt FULLY isolates from prior cards — even an out-of-order update arriving for an ancient tool id won't accidentally edit a 3-minute-old card. The boundary between turns is hard; the boundary between phases within a turn (seal) is soft.

For us: we don't have this distinction because our rolling log is a flat `lines[]` array. An out-of-order Replicas event (rare, but possible — tool_result arriving after another tool_use has already started) just appends to lines and renders as a sequence. We don't actually mutate prior tool-call renderings. Different design tradeoff — ours is simpler but loses the "this specific tool's status updated" semantics.

### 4. MessageDraft — streaming the final text ([`streaming.ts:22-289`](https://github.com/Open-ACP/OpenACP/blob/main/src/plugins/telegram/streaming.ts#L22-L289))

This is where the agent's actual reply text accumulates. Separate from ToolCard. Three subtle patterns worth borrowing:

- **Snapshot the buffer BEFORE the first await.** Lines 66-69, with an explicit comment: "append() can be called synchronously while we're awaiting sendQueue, so this.buffer may change." `const snapshot = this.buffer;` captures the value going OUT, so `lastSentBuffer` accurately tracks what landed. Our equivalent would be `text = render(s)` then comparing `text` to `lastRendered` — we DO this correctly today.
- **Do NOT reset `messageId` on transient errors.** Lines 135-139, explicit comment: "transient errors would cause the next flush to sendMessage the full buffer as a NEW message, creating duplicates." Same lesson we learned the hard way in our Matrix bridge with the fall-through-to-sendMessage fragmentation bug. They got there preemptively.
- **`displayTruncated` flag for finalize correctness.** Lines 102-106 and 165-167: if `flush()` had to truncate because intermediate HTML > 4096, set the flag. `finalize()` checks: if buffer == lastSentBuffer AND !displayTruncated, skip (already sent). But if displayTruncated, MUST resend the full buffer even though it equals last. Subtle dedup-vs-correctness conflict that's easy to get wrong.
- **"Enqueue all chunks in a tight synchronous loop"** for split messages (lines 204-247). The comment is explicit: "prevents concurrent handlers (usage, session_end) from slipping their messages between our chunks in the sendQueue." We don't have this risk because we don't have a global sendQueue — each replica's DO is its own ordering domain. But noted for the design space.
- **HTML→plaintext fallback on each chunk.** Lines 229-244: if HTML send fails (malformed tags after a chunk boundary), enqueues a plain-text fallback with `chunkMd.slice(0, 4096)` and no `parse_mode`. Acceptable degradation. We don't do this — we just log and move on. Worth considering for the Matrix `markdownToHtml` path if we ever get a malformed-HTML edge case.

### 5. formatting.ts — render shapes ([`formatting.ts:213-248`](https://github.com/Open-ACP/OpenACP/blob/main/src/plugins/telegram/formatting.ts#L213-L248))

The actual visual shape of a ToolCard:

```
📋 Tools (3/5) ✅
                                                ← `headerCheck = allComplete ? " ✅" : ""`
🔧 Bash · "npm test"
   📄 View file
                                                ← completed-tools section, in order

── Plan: 2/4 ──
✅ 1. Locate the failing test
✅ 2. Add a fixture
🔄 3. Re-run tests
⬜ 4. Update changelog
────                                            ← plan only renders if planEntries.length > 0

🔧 Write · src/foo.ts
                                                ← running-tools section
```

Visual conventions worth noting:

- **Completed tools render BEFORE plan, running tools render AFTER.** The plan acts as a divider; the user reads top-down as "what's done → what's next → what's happening right now."
- **Plan status icons match ACP status names exactly**: `⬜ pending`, `🔄 in_progress`, `✅ completed`. We use `◦ ► ✓` instead. Either works; theirs is closer to ACP semantics.
- **Tool kind icons resolved per-tool via `resolveToolIcon(tool)`**, not by Phase. So a `Read` tool always shows 📖 even in a "Running" phase. Ours uses Phase emoji on the header and tool emoji on the line — the same info shows up in two places, which we get away with because Telegram lines are short.
- **High-verbosity mode adds `Input:` + `Output:` `<pre>` blocks** under each tool with 3800-char truncation. We don't have a verbosity knob — tool inputs/outputs always show in the truncated `↳ output` lines. The OpenACP "low/medium/high" knob is per-session config and would be a clean addition for us if we want it.

### 6. Forum-topic isolation ([`topic-manager.ts:47-158`](https://github.com/Open-ACP/OpenACP/blob/main/src/plugins/telegram/topic-manager.ts#L47-L158) + [`topics.ts`](https://github.com/Open-ACP/OpenACP/blob/main/src/plugins/telegram/topics.ts))

Each session lives in its own Telegram forum topic inside a group. Two system topics are reserved (Notifications + Assistant). Session topics include the session record's metadata: `topicId`, `sessionId`, `agentName`, `lastActiveAt`.

Operational features we don't have:

- **`/cleanup`-style bulk delete** for finished/error/cancelled sessions. Cancels active sessions first (to prevent orphaned processes), then deletes the topic via the platform adapter, then removes the session record.
- **Active-session deletion requires `confirmed: true`.** If a user tries to delete an active session topic, the call returns `needsConfirmation: true` and a confirmation prompt is sent. Two-step delete.
- **System topics guarded by ID match**. `isSystemTopic(record)` returns true if the topicId matches the notification or assistant topic IDs. They can't be deleted by any user-facing command. We don't need this because we don't have system topics — but the pattern of "reserved IDs that user commands can never touch" is generally useful.

For our Matrix bridge: Beeper groups support topics too (`org.matrix.msc3440` thread spec). We could give each replica its own thread inside a group room. That'd require Replicas-side support for parallel sessions per room, which we don't have today (per-room → single replica via the KV `room:${roomId}` mapping). Larger refactor than a tunable.

### 7. Permission flow ([`permissions.ts:26-125`](https://github.com/Open-ACP/OpenACP/blob/main/src/plugins/telegram/permissions.ts#L26-L125))

When the agent requests permission to run a sensitive tool, OpenACP surfaces it as an inline keyboard message in the session topic, AND fires a notification in the Notifications topic with a deep link back. Key bits:

- **Callback data shape**: `p:<callbackKey>:<optionId>` where `callbackKey` is `nanoid(8)`. Telegram caps callback_data at 64 bytes; long requestId/sessionId can't fit, so a short key maps to in-memory pending state.
- **Pending state is in-memory only.** `this.pending = new Map()`. NOT persistent — a worker restart loses the mapping and all pending permission requests become orphaned (`'❌ Expired'` response). For us this would be a CF Worker DO restart, which is rare but happens; OpenACP's Node process is similarly fragile here.
- **Two-channel surfacing.** The actual permission buttons go in the session topic; a separate notification with a deep link (`buildDeepLink(chatId, threadId, msg.message_id)`) goes to the Notifications topic. Lets the user see "I have permissions to approve" without scrolling through every session topic.
- **On response, the buttons are removed via `editMessageReplyMarkup({ reply_markup: undefined })`.** Locks out double-clicks; the message itself stays. Standard Telegram pattern.

We can't replicate this end-to-end because Replicas doesn't expose permission requests in `/history` — the agent runs autonomously and applies allow/deny based on the workspace policy. But the SHAPE of "request → buttons → callback → resolve → strip buttons" is the right pattern if Replicas ever surfaces it.

### 8. Concrete patterns worth lifting (prioritized)

The Update section listed three borrowable patterns. Now with the deeper look, here's an updated list with effort estimates:

| Pattern | Effort | Reason |
|---|---|---|
| **3-minute thinking auto-stop** ("Still working…" header transition at 60s, hard auto-stop at 180s) | ~10 lines, render-side | Cheap UX win; long-thinking turns currently look frozen |
| **`displayTruncated` flag for finalize correctness** | ~5 lines, poller-side | Defensive fix for an edge case (intermediate truncation forces full-resend) |
| **`previousToolStateMap` for out-of-order tool updates** | ~30 lines, poller-side | Marginal — Replicas /history is mostly in-order; only matters if we add live tool-streaming via SSE |
| **Tool-kind icon resolution per spec** | ~20 lines, render-side | Cosmetic; we already do this via `formatToolUseLine` switch |
| **HTML→plaintext fallback on edit failure** | ~15 lines, matrix.ts | Defense against malformed-HTML edge case; low probability |
| **Per-session forum topics** | Large refactor — needs Replicas-side multi-session-per-room | Not a tune |
| **Permission button flow** | Needs Replicas-side surface | Not actionable today |

The first two are clean ~30-line follow-up PRs if we want them. Everything else is either a rewrite or blocked on upstream.

---

## Update (2026-05-29, follow-up)

Jaden pointed me at **[Open-ACP/OpenACP](https://github.com/Open-ACP/OpenACP)** — a self-hosted bridge that connects Claude Code / Codex / Gemini / Cursor / 28+ AI coding agents to Telegram, Discord, and Slack via ACP. Direct fellow-traveler in our exact space, built in TypeScript, 8MB repo. Their Telegram status design is fundamentally different from ours and worth understanding.

**The big design split:**

| Concern | Our bridges | OpenACP |
|---|---|---|
| Status surface | **One message, edited in place** through phases | **Many separate messages** — ThinkingIndicator, then a ToolCard per tool, then final text |
| Tool calls | Pushed as lines into the single status frame's `lines[]` | Each tool gets its own Telegram message ("ToolCard") that updates as the tool progresses |
| "Thinking" preview | Italic line under the phase header in the status frame | Separate "💭 Thinking..." message; dismissed when first tool runs |
| Text streaming cadence | `EDIT_MIN_INTERVAL_MS = 2000` (Matrix) / inheriting from Matrix on TG | `FLUSH_INTERVAL = 5000ms` debounced; only the FINAL text buffer is sent |
| Thinking ticker | `TICKER_REFRESH_MS = 4000` | `THINKING_REFRESH_MS = 15000` with a `THINKING_MAX_MS = 3 * 60 * 1000` auto-stop |
| Markdown | `markdownToTelegramHtml` only on the final reply; inline `<code>` for tool args | Always HTML; the comment in their `renderer.ts:12-14` explicitly says HTML handles diffs + code fences "more reliably" than plain text |
| Cancellation / sealing | Phase flip to DONE/FAILED; rolling log preserved | `sealToolCardIfNeeded()` "preserves tool results as historical record" when text starts streaming, then opens a fresh card |
| 429 handling | Per-room `rateLimitedUntil`, terminal renders retry inline up to 4× | Not visible in `streaming.ts` — they delegate to a `sendQueue` abstraction that "presumably manages rate-limiting transparently" |
| Topic isolation | None — DM or single room per replica | **Each session gets its own Telegram forum topic** (in groups with topics enabled) |

**Concrete numbers worth borrowing:**

- **5s debounce on text streaming** (vs. our ~2s edit floor). They're MUCH more conservative than us, which makes sense because they're sending separate cards not edits.
- **15s thinking-ticker** (vs. our 4s). For an agent that thinks for 30s+, refreshing every 4s is probably 4x too aggressive.
- **3-minute thinking-indicator hard cap** — auto-dismiss to avoid stale "thinking..." messages. We don't have this; our long-running turns just keep showing the same phase header. Worth adding a "Still working..." re-render at a longer cadence.

**Concrete patterns worth adopting:**

1. **The `sealToolCard` concept.** When text streaming starts after a tool, OpenACP "seals" the tool card — finalizes it, then opens a fresh state for whatever comes next. For us this maps to "don't keep mutating the tool line in `lines[]` once we've moved on; lock its rendered output." Subtle but real for any tool whose `tool_result` arrives late.
2. **Hard-cap on thinking duration.** Our agent can sit in `PLANNING · step 0 · 1:23` forever if the model is genuinely thinking; UX-wise this looks frozen. OpenACP auto-dismisses after 3 minutes. Ours could re-render the header to add `Still planning…` or similar at the 1-min mark.
3. **HTML-only by default** — they don't even try plain text. We agree on this; our `formatToolUseLine` already wraps everything in `<code>` HTML tags.
4. **Forum topics per session** — Telegram-specific. Each session = its own thread inside the group. We don't do this. Worth considering for the Telegram bridge if users want multiple concurrent agents in one group.

**Where we beat them:**

- **Phase emoji on the header** (🤔/📋/✏️/🔧/🧪/🚢/🎉/❌) — they don't have this; their phases are implicit in the message-type split.
- **Reaction emojis on the user prompt** (👀 → 🎉/😭). Not visible in their code. Direct ack-on-receipt + ack-on-completion is a UX win they're missing.
- **`!model` per-room command.** Their model switching looks coarser (session-level config, not per-room).

**Where they beat us:**

- **Tool cards as scrollable history.** When a turn has 10 tools, our rolling log truncates the older ones to a `<blockquote expandable>`. They keep each as a permanent Telegram message — the user can scroll back to see "what exactly did Read on file X return?" days later. Lossless history.
- **Permission buttons inline.** They surface `🔐 permission` requests with allow/deny buttons; the agent blocks until the user clicks. We can't do this because Replicas doesn't expose permission requests in `/history`.
- **Topics-per-session isolation.**

**The 40-line PR I proposed in the prior section is still right** — bumping group cadence, adding a char-delta gate, adding self-tuning backoff are still valid wins regardless of whether we adopt OpenACP's many-messages model. The structural split (one edited message vs. many separate cards) is a deeper architectural choice that's mostly a matter of taste + which UX you optimize for.

**Quick links:**
- Repo: [Open-ACP/OpenACP](https://github.com/Open-ACP/OpenACP)
- Telegram plugin: [`src/plugins/telegram/`](https://github.com/Open-ACP/OpenACP/tree/main/src/plugins/telegram)
- The three files that matter: `streaming.ts` (5s debounce + finalize), `renderer.ts` (HTML composition per message type), `activity.ts` (ThinkingIndicator + ToolCard + ActivityTracker — 545 lines, the core of their UX)

---

## TL;DR

- **ACP (Agent Client Protocol)** — Zed's open standard for editor↔agent streaming — uses a typed `SessionUpdate` discriminated union pushed via `session/update` notifications. Five status-relevant variants: `content`, `tool_call`, `plan`, `available_commands`, `current_mode`. Tool calls carry a four-state status (`pending|in_progress|completed|failed`). Plans replace-not-delta. Permission requests are blocking RPCs. Cancellation must still drain pending updates.
- **Telegram's per-chat rate cap is ~1 msg/sec** (community-derived; Telegram doesn't publish official numbers). **Per-group cap is 20/min.** Global ~30/sec. 429s come back with a `parameters.retry_after` field (seconds). The standard production reaction is to halt all sends for `retry_after + 0.1s`.
- **OSS streaming bots** (n3d1117/chatgpt-telegram-bot, AIORateLimiter in python-telegram-bot) use a **delta-or-completion edit trigger**: edit when character delta crosses a cutoff OR stream completes. They add **5-second exponential backoff per RetryAfter** and fall back to buffering on persistent errors. Markdown is only enabled on the FINAL edit — partial-markdown breakage on intermediate edits is a known foot-gun.
- **Our bridges are already aligned with the field** in shape; the gaps are: we don't yet expose a typed `tool_call.status` lifecycle, and our group cadence (`EDIT_MIN_INTERVAL_MS = 2000`) may still be aggressive vs. the 20-edit/min group cap (which is ~3s/edit, not 2s).

---

## 1. ACP — Agent Client Protocol (Zed)

[https://agentclientprotocol.com](https://agentclientprotocol.com) · [zed.dev/acp](https://zed.dev/acp)

Open spec for streaming agent state from agents → clients (editors / chat surfaces). Drives Zed's Agent Panel.

### Streaming protocol

- Client sends `session/prompt` request
- Agent streams **zero or more `SessionNotification` envelopes** via `session/update`
- Each envelope carries one `SessionUpdate` discriminated-union variant
- Agent can issue **blocking** `session/request_permission` calls in the middle
- Agent ends with a `PromptResponse` carrying a `stopReason` (`completed`, `cancelled`, etc.)
- **Cancellation isn't immediate** — clients MUST keep accepting `tool_call` updates after `session/cancel` because the agent may flush pending state before responding with the cancelled stop reason

### The SessionUpdate variants

| Variant | Purpose | Notes |
|---|---|---|
| `content` | Streamed text/image/audio chunk | Delivered **incrementally**; client accumulates |
| `tool_call` | Tool invocation lifecycle | Status: `pending → in_progress → completed/failed`. Carries `toolCallId`, `toolName`, `toolInput` |
| `plan` | Multi-task execution plan | **Replace, not delta** — agent sends the entire entry list every update; client replaces. Entries: `content`, `status (pending/in_progress/completed)`, `priority` |
| `available_commands` | What the agent can run | Used to show/hide slash commands |
| `current_mode` / `config_option` | Session config / mode flip | E.g. switching from "ask" to "edit" mode |

### Key UX guarantees

- **Stateful, not deltaed** for plans and tool calls — the latest envelope is the truth
- **Incremental** for content chunks — accumulate
- **Permission-gated for risky ops** — agent blocks until client approves
- **Non-blocking notifications** — agent doesn't wait for client ack on updates

### What our bridges already mirror

- We project a `lines[]` rolling log analogous to a stream of `content` + `tool_call` updates
- We have a `plan` PlanState parsed from agent text and rendered with `►/✓/◦` markers — same "replace, not delta" semantics
- We have phase transitions (`STARTING → PLANNING → ... → DONE`) that map to the lifecycle ACP encodes per-tool

### What we DON'T do that ACP does

- **No typed tool_call status lifecycle.** We render every `tool_use` as a final-looking line; we don't show "pending" vs "in_progress" vs "completed" per call. Replicas' history doesn't give us this granularity either — by the time we see a `tool_use` in `/history`, the tool has effectively executed.
- **No permission-request surfacing.** Agents that need approval just emit a result line; no blocking UI moment.
- **No `current_mode` exposure.** We have `!model` but not `!mode`.

**Verdict:** ACP's model is richer than ours by ~one notch on tool-call state. To match it we'd need Replicas to emit tool-call lifecycle events (start/end), which it doesn't currently. Not actionable until upstream changes.

---

## 2. Telegram Bot API — Rate Limits + 429 Handling

[core.telegram.org/bots/faq](https://core.telegram.org/bots/faq) · [gramio.dev/rate-limits](https://gramio.dev/rate-limits)

Telegram **does not officially publish exact numbers.** Community-derived caps:

| Scope | Cap | Source |
|---|---|---|
| Same chat (private) | ~1 msg/sec | community / GramIO |
| Same group | **20 msg/min** | Telegram FAQ — explicit |
| Broadcasting / global | ~30 msg/sec | Telegram FAQ — explicit |
| Paid broadcast (allow_paid_broadcast) | up to 1000/sec, 0.1 Stars each | Bot API 7.1+ |

### 429 response shape

```json
{
  "error_code": 429,
  "description": "Too Many Requests: retry after 35",
  "parameters": { "retry_after": 35 }
}
```

**Standard production response:** halt ALL sends for `retry_after + 0.1s` (per `python-telegram-bot`'s AIORateLimiter). Some libs (gramio's `withRetries`) auto-retry transparently.

### Bot lib patterns we should know

**python-telegram-bot's AIORateLimiter** — two-tier limiter:
- `group_limiter(group_id)` (20/min by default) wraps
- `overall_limiter` (30/sec by default)
- On `RetryAfter` it halts **everything**, not just the offending chat, for `retry_after + 0.1s`
- `max_retries` defaults to 0 — devs opt in

**Our Matrix bridge already does the equivalent** — `rateLimitedUntil` in DO storage, non-terminal renders bail until it passes. We do NOT halt globally though; the rate-limited flag is per-replica. For matrix.org's per-room cap that's the right granularity.

### Important nuance for our TG bridge

Telegram caps groups at **20 edits/min = one edit every 3 seconds**. Our current TG bridge constants (mirrored from Matrix) are `EDIT_MIN_INTERVAL_MS = 2000ms` and `TICKER_REFRESH_MS = 4000ms`. Edit cadence under load: 1 every 2s, ticker forces 1 every 4s. That's **30/min** during active phases — over the 20/min group cap.

**Recommended:** for Telegram bridge in groups, bump `EDIT_MIN_INTERVAL_MS` to ~3500ms when room > 2 members. We don't currently differentiate, and we probably should.

---

## 3. OSS Streaming Telegram AI Bots — Patterns

### `n3d1117/chatgpt-telegram-bot` (3.4k stars, the canonical Python ChatGPT-on-Telegram clone)

[GitHub](https://github.com/n3d1117/chatgpt-telegram-bot) — `bot/telegram_bot.py` streaming loop:

```python
backoff = 0
async for content, tokens in stream_response:
    # Throttle: edit only on big-enough delta OR stream done
    cutoff = get_stream_cutoff_values(update, content) + backoff
    if abs(len(content) - len(prev)) > cutoff or tokens != 'not_finished':
        try:
            use_markdown = tokens != 'not_finished'  # only on FINAL edit
            await edit_message_with_retry(..., use_markdown)
            prev = content
        except RetryAfter as e:
            backoff += 5
            await asyncio.sleep(e.retry_after)
            continue
        except TimedOut:
            backoff += 5
            await asyncio.sleep(0.5)
            continue
    await asyncio.sleep(0.01)  # ~10ms base loop pacing
```

**Key takeaways:**

1. **Delta-based, not time-based** edit trigger — `cutoff` is a character-count threshold per chat type. They don't edit every N ms; they edit every N chars.
2. **Dynamic backoff: +5s per error.** Each 429 / TimedOut bumps the cutoff so edits get rarer the more pressured the channel is. Self-tuning.
3. **Markdown only on the final edit.** Partial-markdown during streaming breaks Telegram parser (mid-`**bold` etc.). They send plaintext during the stream, switch to Markdown V2 only at completion.
4. **No global halt on 429** — only the affected chat backs off. (Different from python-telegram-bot's AIORateLimiter.)

### Markdown safety during stream

[community.latenode.com discussion](https://community.latenode.com/t/how-to-handle-streaming-responses-from-google-ai-in-telegram-bot-without-markdown-parsing-errors/21646) — building with aiogram + Gemini. The community consensus: never send `parse_mode=MarkdownV2` while streaming. Either:
- Strip markdown on intermediate edits, render on final, OR
- Use Telegram's safer `HTML` parse mode but balance tags carefully on each edit

**Our Telegram bridge** uses `parse_mode=HTML` with `markdownToTelegramHtml` ([`replicas-telegram-bridge/src/markdown.ts`](/replicas-telegram-bridge/src/markdown.ts)) and renders only the final reply. The status frame itself uses bot-controlled HTML (the phase header etc.), which is balanced by construction. **We're already on the safer path.**

---

## 4. Zed Agent Panel — UI design takeaways

[zed.dev/docs/ai/agent-panel](https://zed.dev/docs/ai/agent-panel)

What Zed's panel shows during a live agent turn:

- **Tool indicators** alongside the streaming message — "which tools the model is using"
- **An accordion bar above the editor** with "which files, how many, and how many lines have been edited" (expand for the file list). This is the closest analogue to our focus-window-that-got-reverted, but Zed implements it as a *summary widget above* the message, not as a collapsing of the rolling log itself
- **Confirmation menus** appear inline when the agent needs permission — "allow once / always / deny"
- **Linear chronological thread** for older content — no "compress old steps into a count" UX
- **Restore Checkpoint** buttons after file-edit batches — lets the user roll back the agent's changes

What Zed **doesn't** do that I once thought it did:
- No checklist/spine-of-the-plan UI rendered as the message body
- No "current step highlighted" focus window inside the conversation

This actually matches the lesson learned on our side: **the tool-call stream IS the body. Don't replace it with a summary**. The summary belongs in a sidebar widget *next to* the stream, not *instead of* it.

---

## 5. Synthesis — what's worth changing in our bridges

### Already aligned with the field ✓

- Edit-in-place single status message (vs. spamming new messages)
- Phase header + emoji + elapsed time
- Plan checklist with current-item highlight (`►` matches ACP's `in_progress`)
- Rate-limit-aware backoff with `retry_after` honored
- Markdown rendered only on the final reply, not during stream
- Reaction emoji on the user's prompt as an at-a-glance ack signal (👀 → 🎉/😭)

### Worth tuning

1. **TG group cadence is over the 20/min cap.** Bump `EDIT_MIN_INTERVAL_MS` to ~3500ms when room is a group. Low risk, ~10 line change.
2. **Adopt the n3d1117 delta-trigger pattern** as an additional edit gate. Right now we edit on every diff (every ~180ms alarm tick that has new events). If the diff is just a single character of a thinking preview, that wastes an edit. Edit only when the rendered string changes by >N chars, OR phase advances, OR turn ends. Saves edits → fewer 429s.
3. **`+5s per 429` self-tuning backoff** — when we hit a 429 we currently respect `retry_after_ms` but don't make subsequent edits slower. n3d1117's pattern of progressively raising the cutoff means a bot in a noisy group naturally settles into a sustainable rate. Worth borrowing.

### Out of scope / not actionable

1. **Typed tool_call status lifecycle** — requires Replicas to emit start/end events per tool_use, which it doesn't.
2. **Permission-request blocking UX** — would need the Replicas agent to surface "I'd like to run X, OK?" prompts. Not in `/history` today.
3. **`current_mode` / `available_commands`** notifications — Replicas-side feature, not bridge.

### Recommended single PR

Wrap the three "worth tuning" items into one PR for the Telegram bridge specifically:

- `EDIT_MIN_INTERVAL_MS_GROUP = 3500` constant; use it instead of the 2000 when chat is a group
- Add a `lastRenderedLen` storage key; skip edit when `|new_len − last_len| < CHAR_DELTA_CUTOFF` (default 60 chars) AND no phase change AND not terminal
- On 429, `backoff += 1500ms` (added to the next edit's gate) until the alarm chain idles for >30s

Estimated: ~40-line change, all in `replicas-telegram-bridge/src/poller.ts`. Tests: extend `index.test.ts` with 429 backoff + group-cadence cases.

## Sources

- [Agent Client Protocol — Introduction](https://agentclientprotocol.com/get-started/introduction)
- [Agent Client Protocol — Schema](https://agentclientprotocol.com/protocol/schema)
- [Zed ACP page](https://zed.dev/acp)
- [Zed Agent Panel docs](https://zed.dev/docs/ai/agent-panel)
- [Telegram Bots FAQ](https://core.telegram.org/bots/faq)
- [Telegram Bot API reference](https://core.telegram.org/bots/api)
- [GramIO rate-limit guide](https://gramio.dev/rate-limits)
- [python-telegram-bot AIORateLimiter](https://docs.python-telegram-bot.org/en/v22.0/telegram.ext.aioratelimiter.html)
- [n3d1117/chatgpt-telegram-bot](https://github.com/n3d1117/chatgpt-telegram-bot)
- [community.latenode.com — streaming + markdown errors](https://community.latenode.com/t/how-to-handle-streaming-responses-from-google-ai-in-telegram-bot-without-markdown-parsing-errors/21646)
