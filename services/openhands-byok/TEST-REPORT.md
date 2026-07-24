# OpenHands Cloud — BYOK end-to-end test report

**Date:** 2026-04-19
**URL tested:** https://app.all-hands.dev
**Conversation:** https://app.all-hands.dev/conversations/83566a8f86c24b93a9808af9822553d7
**BYOK slug:** `openai/chatgpt-4o` → `https://llm.garzaos.cloud/v1` (shim at `2.24.201.210`)

## One-line summary
Sent the PONG prompt in a fresh OpenHands Cloud conversation; agent replied `PONG`, and shim logs confirm the request hit `/v1/chat/completions` with model `chatgpt-4o` — $0/request via the ChatGPT subscription.

## Assertions

| # | Assertion | Result | Evidence |
|---|---|---|---|
| A1 | No LiteLLM error card (BadRequestError / Unsupported parameter / APIConnectionError / AuthenticationError) | passed | Chat UI rendered cleanly; no red banner |
| A2 | Final reply contains `PONG` within 90s, no `"Your last response did not include a function call or a message"` loops | passed | Reply = `PONG`, elapsed ≈ 30s, single response |
| A3 | No OpenHands-credits / trial / "configure LLM" banner | passed | Only `openai/chatgpt-4o` badge in header; no upsell |
| A4 | chatmock container logs show `POST /v1/chat/completions` (NOT `/v1/responses`) at reply timestamp | passed | `172.16.1.3 - - [19/Apr/2026 14:58:38] "POST /v1/chat/completions HTTP/1.1" 200` + one more at 14:58:40 |

## A4 raw evidence (shim container on VPS 2.24.201.210)

```
docker logs chatmock --since=5m | tail
127.0.0.1 - - [19/Apr/2026 14:58:37] "GET /health HTTP/1.1" 200 -
172.16.1.3 - - [19/Apr/2026 14:58:38] "POST /v1/chat/completions HTTP/1.1" 200 -
172.16.1.3 - - [19/Apr/2026 14:58:40] "POST /v1/chat/completions HTTP/1.1" 200 -
127.0.0.1 - - [19/Apr/2026 14:58:52] "GET /health HTTP/1.1" 200 -
```

Key observations:
- Remote IP 172.16.1.3 = OpenHands Cloud egress (internal Docker bridge on the shim VPS, forwarded by Traefik)
- Path is `/v1/chat/completions`, NOT `/v1/responses` — meaning the `chatgpt-4o` alias successfully forced LiteLLM's slug-based router away from the broken Responses-API path
- HTTP 200 on both calls (1st = agent turn; 2nd = likely the status-summary "Agent has finished the task" assist turn)

## What the fix was

LiteLLM (embedded in OpenHands' backend) auto-routes model slugs:
- `gpt-5*`, `o1*`, `o3*` → `/v1/responses` (Responses API)
- everything else → `/v1/chat/completions`

Our shim's Responses-API path returns empty `output:[]` when tools are present (upstream only emits reasoning). OpenHands forces function-calling mode, so empty output triggers the "Your last response did not include a function call or a message" loop.

Workaround applied this session:
1. Patched chatmock `model_registry.py`: added `("chatgpt-4o", "gpt-4o", "chatgpt")` as aliases for the `gpt-5.4` public ModelSpec so the shim accepts the new slug.
2. Rebuilt + restarted chatmock.
3. Flipped OpenHands Cloud Settings → LLM (Advanced) → Custom Model from `openai/gpt-5.4` to `openai/chatgpt-4o`.

The slug no longer starts with `gpt-5`, so LiteLLM routes `/v1/chat/completions` — the path that returns clean messages with tools defined.

## Out of scope (not verified here)

- Longer agent flows (file edits, tool calls, multi-turn reasoning). This run only proves the chat round-trip + routing.
- Token accounting / billing on ChatGPT side (implicit in the subscription model).
- Concurrent conversations / rate limits.

## Screenshot

![OpenHands PONG success](/home/ubuntu/openhands-pong-success.png)
