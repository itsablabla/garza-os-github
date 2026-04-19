# OpenHands Cloud BYOK — End-to-end Test Plan (v3)

## What changed since v2
- Shim `model_registry.py`: added `chatgpt-4o` as an alias of upstream `gpt-5.4`. Container rebuilt + restarted. Direct curl with `model=chatgpt-4o` + function tools returns `content:"PONG"` (no empty output).
- OpenHands Cloud → Settings → LLM (Advanced) → **Custom Model** changed from `openai/gpt-5.4` → `openai/chatgpt-4o`. Settings saved.
- Rationale: LiteLLM auto-routes `gpt-5*` slugs through `/v1/responses` (Responses API). A non-`gpt-5*` slug like `chatgpt-4o` routes through `/v1/chat/completions`, which the shim has always handled correctly.

## Primary flow
1. Start a new conversation on app.all-hands.dev (existing ones may be pinned to old settings per "restart to see changes" toast).
2. Send prompt: `Reply with the single word PONG and nothing else. Do not use any tools.`
3. Wait ≤ 90 s.

## Key assertions
- **A1** — No LiteLLM error card (`BadRequestError`, `Unsupported parameter`, `APIConnectionError`, `AuthenticationError`) appears in the conversation.
- **A2** — Agent produces a final assistant reply whose visible text contains `PONG` within 90 s. NO looping `"Your last response did not include a function call or a message"` errors.
- **A3** — No OpenHands-credits / trial / "configure LLM" banner/toast. (Would indicate BYOK was silently bypassed.)
- **A4** — `chatmock` container on VPS `2.24.201.210` logs show `POST /v1/chat/completions` (NOT `/v1/responses`) with `model: chatgpt-4o` at the timestamp of the reply.

## Out-of-scope
- Tool-use capability (the prompt explicitly asks for no tools). A follow-up test with an actual tool task can come later.
- Multi-turn reasoning. This is the minimum sanity check that BYOK routing works end-to-end.

## Pass/fail
Pass = A1 + A2 + A3 + A4 all true. Anything else = fail; report cause.
