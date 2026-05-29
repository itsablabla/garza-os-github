# Research: ACP + Telegram Bot Status Surface Patterns

**Date:** 2026-05-29
**Why:** Jaden asked for a deep-research pass on how *open ACP / AI Telegram bots* surface live status. The bridges already work; this is to find any pattern we should borrow vs. confirm we're aligned with the field.

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
