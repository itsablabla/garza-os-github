# Replying to Telegram-spawned tasks

If your workspace was spawned via the Replicas Telegram bridge (see `replicas-telegram-bridge/` in `itsablabla/garza-os-github`), the first line of your initial prompt looks like:

```
[tg:chat_id=12345678]
```

Or, for a Telegram supergroup forum topic:

```
[tg:chat_id=12345678:thread_id=42]
```

The header is **routing metadata**, not the task. Strip it before composing user-facing text.

## Two channels — use both

There are **two** scripts mounted at `~/.replicas/bin/`. Use them for different things:

| Script | Telegram action | Use for | Persistence |
| --- | --- | --- | --- |
| `tg-status.sh` | `editMessageText` (one message, updated in place) | Live status: thinking / tool calls / phase changes | One message, updated continuously |
| `tg-reply.sh` | `sendMessage` (a new message each call) | Final results, PR links, answers, errors | New messages persist in the chat |

This mirrors the Slack-bot UX: a single "live activity" line ticking through what you're doing, plus a separate `posted` reply for the final result.

## One-time setup at workspace start

```bash
# Cache the chat target from the first line of your prompt.
echo "$PROMPT_FIRST_LINE" | bash ~/.replicas/bin/tg-target-detect.sh

# Open the live status thread immediately so the user sees you're alive.
bash ~/.replicas/bin/tg-status.sh "🤔 Got it — analyzing your request…"
```

`PROMPT_FIRST_LINE` is the literal first line you received (e.g. `[tg:chat_id=12345678]`).

## During work: stream status

Update the live status line **before each significant action**. Suggested emoji conventions (keep them consistent so users learn the vocabulary):

| Emoji | Means |
| --- | --- |
| 🤔 | Thinking / planning |
| 🔧 | Tool call (file read/write, shell, gh, curl) |
| 🧪 | Running tests / build |
| 🌐 | Network call / API hit |
| 📝 | Writing code / docs |
| 🔍 | Searching the codebase |
| ⏳ | Waiting on a long operation |
| ⚠️ | Blocker / needs user input |

Examples:

```bash
bash ~/.replicas/bin/tg-status.sh "🔧 Reading src/server.ts"
bash ~/.replicas/bin/tg-status.sh "🧠 Planning the migration: 3 files to touch"
bash ~/.replicas/bin/tg-status.sh "📝 Writing migration_0042.sql"
bash ~/.replicas/bin/tg-status.sh "🧪 Running bun test (15/16 passing so far)"
bash ~/.replicas/bin/tg-status.sh "🌐 Calling gh pr create"
```

Each call **edits the same message**. The chat stays clean. The user sees a live "you are here" line.

## At the end: send a real reply

When you have a final answer or PR link, switch to `tg-reply.sh`. That sends a NEW message that persists, leaving the status line for context.

```bash
bash ~/.replicas/bin/tg-reply.sh "✅ PR opened: https://github.com/owner/repo/pull/42 — adds /healthz endpoint, all tests green."
```

Optionally update the status to a final state too:

```bash
bash ~/.replicas/bin/tg-status.sh "✅ Done. PR posted above."
```

## Errors and blockers

If you hit a blocker the user needs to resolve (missing credential, ambiguous requirement, dangerous operation needing confirmation), use `tg-reply.sh` for the question — status updates aren't visible enough.

```bash
bash ~/.replicas/bin/tg-reply.sh "⚠️ I need a Stripe API key in 1Password before I can run the test charge. Drop it in 'Stripe Test Key' and reply 'ready'."
```

## Overrides

Both scripts respect these env vars (useful for testing or cross-posting):

- `TG_CHAT_ID` — target chat (defaults to value from `/tmp/tg-target`).
- `TG_THREAD_ID` — target supergroup topic.
- `TG_TARGET_FILE` — where target is cached (default `/tmp/tg-target`).
- `STATUS_MID_FILE` — where status message_id is cached (default `/tmp/tg-status-mid`).

## When you were NOT spawned from Telegram

If your prompt doesn't start with `[tg:chat_id=…]`, you weren't spawned from this bridge — don't use these scripts. Reply via whatever surface spawned you (Slack thread, GitHub PR comment, etc.).

## Debugging

- `cat /tmp/tg-target` — confirm chat target is cached.
- `cat /tmp/tg-status-mid` — confirm a live status message exists.
- `env | grep TG_` — should show `TG_BOT_TOKEN` set globally.
- `curl -s "https://api.telegram.org/bot$TG_BOT_TOKEN/getMe"` — sanity-check the token.
- Reset the status line by `rm /tmp/tg-status-mid` (next `tg-status.sh` call will send a new message).
