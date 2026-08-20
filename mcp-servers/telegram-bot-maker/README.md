# telegram-bot-maker

Dockerized port of the Garz Tool `telegram_bot_maker` (v8). Creates Telegram bots via
BotFather using a stored Telethon session, verifies with `getMe`, and saves the token
to 1Password via the `op` CLI.

Deployed on Coolify: **https://telegram-bot-maker.garzalabs.com**

## Endpoints

| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/health` | — | Service health |
| POST | `/create` | `{bot_name, bot_username, delete_bot_username?}` | Create a bot via BotFather, save token to 1Password |
| POST | `/delete` | `{bot_username}` | Delete a bot (frees the 40-bot slot) |

Mutating routes require `Authorization: Bearer <BOT_MAKER_GATE_TOKEN>` when
`BOT_MAKER_GATE_TOKEN` is set.

## Env

- `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION_STRING` — Telegram account creds
- `OP_SERVICE_ACCOUNT_TOKEN` — 1Password service account token (garza-team)
- `OP_VAULT` — vault to save bot tokens into (default `Main`)
- `BOT_MAKER_GATE_TOKEN` — optional bearer gate for mutating routes
