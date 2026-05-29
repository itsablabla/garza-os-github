# Replying to Telegram-spawned tasks

If your workspace was spawned via the Replicas Telegram bridge (see `replicas-telegram-bridge/` in `itsablabla/garza-os-github`), the first line of your initial prompt looks like:

```
[tg:chat_id=12345678]
…the user's actual request follows on subsequent lines…
```

Or, when the message came from a Telegram supergroup forum topic:

```
[tg:chat_id=12345678:thread_id=42]
…request body…
```

The header is *not* part of the task — it's routing metadata so you can reply.

## How to reply

`TG_BOT_TOKEN` is pre-set on every workspace in this env. Two helper scripts are mounted at `~/.replicas/bin/`:

1. **Once per workspace** (best to do this during your initial planning step):
   ```bash
   echo "<paste your initial prompt's first line>" | ~/.replicas/bin/tg-target-detect.sh
   ```
   This caches `chat_id` / `thread_id` in `/tmp/tg-target` so you don't need to pass them again. If the header was on stdin (e.g. you pipe the whole prompt) the script only reads the first line.

2. **Every time you want to post back to Telegram:**
   ```bash
   ~/.replicas/bin/tg-reply.sh "Started working on this — opening a PR shortly."
   ```
   - Reads cached target.
   - Handles Telegram's 4096-char message cap by chunking.
   - Quietly succeeds on `"ok":true`, errors otherwise.

3. **Override target at call time** if you need to message a different chat:
   ```bash
   TG_CHAT_ID=987654 ~/.replicas/bin/tg-reply.sh "Cross-posting result."
   ```

## When to reply

- **Acknowledge** within the first 30s with one short line so the user knows you're alive.
- **Post a status update** if you're going to take more than ~60s on a step.
- **Final result**: post the PR link (or the answer for non-PR tasks). Single message — don't spam.
- **Errors / blockers**: post the concrete blocker so the user can unblock you.

The Worker has already 👀-reacted to the user's message — you don't need to ack with another emoji, send text.

## When to *not* reply

- If your prompt does not start with `[tg:chat_id=…]`, you were not spawned from Telegram — reply via whatever surface spawned you (Slack thread, GitHub PR comment, etc.).
- Don't echo the routing header back; strip it from any message you compose to the user.

## Debugging

- `cat /tmp/tg-target` to confirm the cache exists.
- `env | grep TG_` — should show `TG_BOT_TOKEN` set globally.
- If `~/.replicas/bin/tg-reply.sh` returns exit code `3`, the chat target isn't resolved — re-run `tg-target-detect.sh`.
- Test the bot token directly: `curl -s "https://api.telegram.org/bot$TG_BOT_TOKEN/getMe"` should return `{"ok":true,…}`.
