# AGENTS.md — replicas-matrix-bridge

Read **[`../docs/agent-handoff.md`](../docs/agent-handoff.md)** before touching
code in this directory. It covers:

- Architecture + end-to-end flow (listener → dispatch → poller)
- File-by-file index with line ranges for the hot path
- The full Durable Object storage-key model
- Recent commits with reasoning (why each fix exists)
- Production endpoints, deploy commands, log-tail filters
- Known open issues
- **Things Jaden likes vs. has explicitly disliked** — do not rebuild
  the focus-window UI; do not break the prompt-reaction emojis

Then follow the universal principles in the root [`../AGENTS.md`](../AGENTS.md).

Quick orientation:

- Worker name: `replicas-matrix-bridge`
- Latest deploy at the time of handoff: matrix version `941d8c95` (commit `e5f0ae3`)
- Hot file: `src/poller.ts` (the ReplicaPoller DO state machine)
- Render: `src/render.ts` (simple line-stream rolling log — do not collapse tool calls)
