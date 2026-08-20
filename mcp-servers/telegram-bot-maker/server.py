"""telegram-bot-maker — create Telegram bots via BotFather and save tokens to 1Password.

Dockerized service (deployed on Coolify / mcpui.garzalabs.com). Faithful port of the
Garz Tool `telegram_bot_maker` v8: Telethon session -> BotFather flow -> getMe verify
-> save to 1Password via the `op` CLI.

Endpoints:
  GET  /health          -> {"ok": true}
  POST /create          -> {bot_name, bot_username, delete_bot_username?}
  POST /delete          -> {bot_username}
"""

import asyncio
import os
import re
import subprocess
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel

API_ID = os.getenv("TELEGRAM_API_ID", "").strip()
API_HASH = os.getenv("TELEGRAM_API_HASH", "").strip()
SESSION_STR = os.getenv("TELEGRAM_SESSION_STRING", "").strip()
GATE_TOKEN = os.getenv("BOT_MAKER_GATE_TOKEN", "").strip()  # optional: require Bearer on mutating routes
OP_VAULT = os.getenv("OP_VAULT", "Main")

TOKEN_RE = re.compile(r"([0-9]+:[A-Za-z0-9_-]{35,})")


def require_auth(authorization: str | None) -> None:
    if GATE_TOKEN:
        expected = f"Bearer {GATE_TOKEN}"
        if authorization != expected:
            raise HTTPException(status_code=401, detail="Unauthorized")


async def run_botfather_flow(bot_name: str, bot_username: str, delete_username: str = "") -> dict:
    """Run the full BotFather conversation over Telethon and return bot info + token."""
    from telethon import TelegramClient
    from telethon.errors import RPCError
    from telethon.sessions import StringSession

    client = TelegramClient(
        StringSession(SESSION_STR), int(API_ID), API_HASH,
        device_model="Garza Tool", system_version="1.0", app_version="1.0",
    )
    await client.connect()
    try:
        if not await client.is_user_authorized():
            return {"ok": False, "error": "Session not authorized"}

        botfather = await client.get_entity("@BotFather")

        if delete_username:
            target = delete_username.lstrip("@")
            await client.send_message(botfather, "/mybots")
            await asyncio.sleep(1.5)
            await client.send_message(botfather, "/deletebot")
            await asyncio.sleep(1.0)
            await client.send_message(botfather, "@" + target)
            await asyncio.sleep(1.5)
            msgs = await client.get_messages(botfather, limit=1)
            if msgs and msgs[0].buttons:
                for row in msgs[0].buttons:
                    for btn in row:
                        if "Yes" in (btn.text or ""):
                            await btn.click()
                            await asyncio.sleep(1.5)
                            break

        await client.send_message(botfather, "/newbot")
        await asyncio.sleep(1.5)
        msgs = await client.get_messages(botfather, limit=1)
        resp = msgs[0].text if msgs else ""
        if resp and "40" in resp and ("limit" in resp.lower() or "maximum" in resp.lower()):
            return {"ok": False, "error": "40-bot limit. Use delete_bot_username."}
        if resp and "Sorry" in resp:
            return {"ok": False, "error": resp[:500]}

        await client.send_message(botfather, bot_name)
        await asyncio.sleep(1.5)
        msgs = await client.get_messages(botfather, limit=1)
        resp = msgs[0].text if msgs else ""
        if resp and "Sorry" in resp:
            return {"ok": False, "error": resp[:500]}

        await client.send_message(botfather, "@" + bot_username.lstrip("@"))
        await asyncio.sleep(2.0)
        msgs = await client.get_messages(botfather, limit=1)
        resp = msgs[0].text if msgs else ""
        if resp and "Sorry" in resp:
            return {"ok": False, "error": resp[:500]}

        m = TOKEN_RE.search(resp or "")
        if not m:
            return {"ok": False, "error": "Token not found", "raw": (resp or "")[:500]}

        token = m.group(1)
        bot_id = token.split(":")[0]

        import aiohttp
        async with aiohttp.ClientSession() as sess:
            async with sess.get(f"https://api.telegram.org/bot{token}/getMe") as r:
                data = await r.json()
        me = data.get("result", {}) if data.get("ok") else {}
        if not me.get("id"):
            return {"ok": False, "error": "getMe failed", "data": data}

        return {
            "ok": True,
            "step": "created",
            "bot_id": me.get("id"),
            "bot_username": me.get("username"),
            "bot_name": me.get("first_name"),
            "token": token,
        }
    except RPCError as e:
        return {"ok": False, "error": "RPC: " + str(e)}
    except Exception as e:
        return {"ok": False, "error": str(e)}
    finally:
        await client.disconnect()


def save_to_onepassword(bot: dict) -> dict:
    """Save the bot token to 1Password via the op CLI (service account token)."""
    title = f"Telegram Bot - {bot['bot_username']}"
    cmd = [
        "op", "item", "create",
        "--vault", OP_VAULT,
        "--title", title,
        "--category", "API Credential",
        f"token={bot['token']}",
        f"username=@{bot['bot_username']}",
        f"bot_id={bot['bot_id']}",
        f"bot_name={bot['bot_name']}",
        "--format", "json",
    ]
    env = os.environ.copy()
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60, env=env)
    if proc.returncode != 0:
        return {"ok": False, "error": (proc.stderr or proc.stdout)[:500]}
    return {"ok": True, "output": proc.stdout.strip()[:500]}


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not API_ID or not API_HASH or not SESSION_STR:
        raise RuntimeError("TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION_STRING envs required")
    yield


app = FastAPI(title="telegram-bot-maker", version="1.0.0", lifespan=lifespan)


class CreateBody(BaseModel):
    bot_name: str
    bot_username: str
    delete_bot_username: str | None = None


class DeleteBody(BaseModel):
    bot_username: str


@app.get("/health")
async def health():
    return {"ok": True, "service": "telegram-bot-maker", "version": "1.0.0"}


@app.post("/create")
async def create(body: CreateBody, authorization: str | None = Header(default=None)):
    require_auth(authorization)
    bot_name = body.bot_name.strip()
    bot_username = body.bot_username.strip()
    if not bot_name:
        raise HTTPException(status_code=400, detail="bot_name is required")
    if not bot_username:
        raise HTTPException(status_code=400, detail="bot_username is required")
    if not bot_username.endswith("bot"):
        raise HTTPException(status_code=400, detail='bot_username must end with "bot"')

    result = await run_botfather_flow(bot_name, bot_username, (body.delete_bot_username or "").strip())
    if not result.get("ok"):
        raise HTTPException(status_code=422, detail=result)

    op_result = save_to_onepassword(result)
    return {
        "ok": True,
        "bot": {k: v for k, v in result.items() if k != "step"},
        "onePassword": op_result,
        "tip": "Use https://api.telegram.org/bot<token>/METHOD to control the bot.",
    }


@app.post("/delete")
async def delete(body: DeleteBody, authorization: str | None = Header(default=None)):
    require_auth(authorization)
    username = body.bot_username.strip().lstrip("@")
    if not username:
        raise HTTPException(status_code=400, detail="bot_username is required")

    result = await run_botfather_flow("", username, delete_username=username)
    if not result.get("ok"):
        raise HTTPException(status_code=422, detail=result)
    return {"ok": True, "deleted": username}
