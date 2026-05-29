# AGENTS.md — replicas-telegram-bridge

Read **[`../docs/agent-handoff.md`](../docs/agent-handoff.md)** before touching
code in this directory. It covers both bridges (Matrix + Telegram) end-to-end.

Then follow the universal principles in the root [`../AGENTS.md`](../AGENTS.md).

Quick orientation:

- Worker name: `replicas-telegram-bridge`
- Latest deploy at the time of handoff: telegram version `e050ce54` (commit `8728c39`)
- Hot file: `src/poller.ts` (the ReplicaPoller DO state machine)

**Known open work for this bridge** (do this before anything else):

- `src/render.ts` still ships the focus-window code from commit `8728c39`. Matrix
  was reverted in `dd74c60` but Telegram wasn't because Jaden was actively testing
  Matrix only. Mirror the Matrix `render.ts` and `render.test.ts` onto this side
  to revert. **Keep TG's `MAX_RENDER_CHARS = 3800`** (TG's `editMessageText` caps at
  4096 chars). **Do not adopt the Matrix-only `resultHtml` embed** — TG keeps the
  separate-message flow because of the same cap.

Telegram bridge has no encryption surface (no OlmVault, no Megolm). Simpler than Matrix.
