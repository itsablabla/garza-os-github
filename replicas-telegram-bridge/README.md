# replicas-telegram-bridge

Cloudflare Worker that translates Telegram bot messages into Replicas workspace spawns. Drop-in alternative to the native Replicas Slack bot, but driven by Telegram — which is bridged transparently by Beeper's `mautrix-telegram`, so the day-to-day UX is "DM the bot from Beeper, get a PR link back in the same chat."

## Routing

| Telegram | Replicas API call |
| --- | --- |
| First message in `(chat_id, message_thread_id)` | `POST /v1/replica` |
| Subsequent messages with same key | `POST /v1/replica/{id}/messages` |
| Acknowledgement | Telegram `setMessageReaction` with 👀 |
| Mapping store | Workers KV (`MAP`), 7-day TTL by default |

Replicas hot-path semantics mirror the Slack automation: one thread → one workspace; the workspace inherits the configured env (`REPLICAS_ENV_ID`) and posts back via the agent.

## Deploy

```bash
cd replicas-telegram-bridge
npm install

# 1. Create the KV namespace and paste the id into wrangler.toml
wrangler kv:namespace create MAP

# 2. Set secrets
wrangler secret put TG_TOKEN              # from @BotFather
wrangler secret put TG_WEBHOOK_SECRET     # random string, used to verify Telegram POSTs
wrangler secret put REPLICAS_API_KEY      # Replicas API key

# 3. Deploy
wrangler deploy

# 4. Point Telegram at the Worker
curl "https://api.telegram.org/bot$TG_TOKEN/setWebhook?url=https://<your-worker-url>/tg&secret_token=$TG_WEBHOOK_SECRET"
```

## Test

```bash
npm test
```

Tests run inside the `@cloudflare/vitest-pool-workers` Workers runtime and cover the webhook handler, KV-backed routing, idempotency, and error paths.

## Bot setup (Telegram side)

1. DM `@BotFather` → `/newbot` → pick a display name and username.
2. Save the token BotFather returns.
3. `/setprivacy` → **Disable** if you want the bot to read all group messages (not just `@mentions`).
4. Add the bot to chats where it should listen.

## Replying from inside the workspace

When `POST /v1/replica` succeeds, the spawned workspace gets these env vars (set in `metadata` on the create call and surfaced as `TELEGRAM_*` env vars by the workspace start hook — wire this in your env's start script):

- `TELEGRAM_BOT_TOKEN` — same value as the Worker's `TG_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_THREAD_ID` (empty for DMs and untopiced groups)

The agent posts back with:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  -d "chat_id=$TELEGRAM_CHAT_ID" \
  -d "message_thread_id=$TELEGRAM_THREAD_ID" \
  -d "text=PR opened: $PR_URL"
```

## Caveats

- Telegram message size limit is **4096 chars per `sendMessage`** — chunk long agent output.
- `setMessageReaction` requires Bot API 7.0+. Older Telegram clients still see the message but no reaction emoji.
- Webhooks retry on non-2xx, so the Worker always returns `200` and pushes the heavy work into `ctx.waitUntil`. The handler also dedupes by `(chat_id, message_id)` for 10 min as a belt-and-suspenders.
- Privacy: bot updates flow through Telegram's servers. For confidential code review traffic, prefer a native Matrix bot on `matrix.beeper.com` instead.
