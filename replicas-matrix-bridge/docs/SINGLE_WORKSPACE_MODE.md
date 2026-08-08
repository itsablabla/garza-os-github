# Single-Workspace Mode for replicas-matrix-bridge

The bridge's default behavior is **one Replicas workspace per Matrix room**: on
first message in a previously-unseen room, `dispatch.ts` calls
`POST /v1/replica` to spawn a workspace named `mx-<roomidprefix>-<ts>` and
writes the binding to KV (`room:<roomId> → <replica_id>`).

This document describes how to opt into **single-workspace mode**: every
KV-miss room shares one configured replica. Useful when you have a single
long-lived workspace and want every new project room to drop into it
without paying for/managing a separate sandbox per chat.

## What the fix changes

PR #25 adds an optional `DEFAULT_REPLICA_ID` binding to `Env`.

- If unset → behavior is unchanged. Per-room spawn continues.
- If set → in `dispatch.ts`, the `else` branch of the existing/KV-miss
  check now forwards to `DEFAULT_REPLICA_ID` instead of `createReplica`,
  pins the KV mapping on success (so future messages route via the normal
  `existing` branch), and falls through to legacy `createReplica` only if
  the default replica's `sendFollowUp` fails. The bot never goes silent.

Touched files: `src/index.ts`, `src/dispatch.ts`, `wrangler.toml`.

## How to enable

After this PR is merged and the worker is redeployed:

```sh
cd replicas-matrix-bridge
echo "<your-replica-uuid>" | wrangler secret put DEFAULT_REPLICA_ID
# or set under [vars] in wrangler.toml for non-secret value
```

Find a replica id with:

```sh
curl -s -H "Authorization: Bearer $REPLICAS_API_KEY" \
  -H "Replicas-Org-Id: 778b1aa3-4327-45a4-9874-c8a3a72df610" \
  "https://api.replicas.dev/v1/replica?limit=100" \
  | jq '.replicas[] | {id,name,status}'
```

## Alternative: pre-pin KV without a deploy

If you don't want to (or can't) redeploy the worker, you can achieve the
same effect by **pre-populating the KV mapping for a room before any
message arrives** in it. The bridge's `dispatch.ts` only spawns when
`env.MAP.get("room:" + roomId)` returns null, so pre-writing the key
suppresses the spawn.

The Garza OS workspace ships two helpers for this:

- **`~/.replicas/bin/garza-project-provision`** — creates a Matrix room
  with `m.room.name`, topic, invitees, power levels, and a
  `dev.garza.agent.config` state event marking it as Garza-managed. It
  honours `GARZA_ROUTER_REPLICA_ID` (falling back to `WORKSPACE_ID`) and
  writes `room:<id> → <router_id>` into the bridge's KV namespace
  (`036b2f9231de4d21bf0cdf120b5b4869`) immediately after `createRoom`.
  Result: new rooms never spawn.

- **`~/.replicas/bin/garza-rebind-rooms`** — bulk-rewrites all (or a
  filtered subset of) existing `room:*` KV entries to point at one
  replica id. Useful for consolidating historical sprawl. Use
  `--status` for read-only inspection and `--dry-run` to preview a
  rebind without writing. The orphaned per-room workspaces remain
  alive until you `DELETE /v1/replica/{id}` them, so cleanup is a
  separate explicit step.

## KV schema (for reference)

Namespace: `036b2f9231de4d21bf0cdf120b5b4869` (`MAP` binding).

| Key | Value | Purpose |
|---|---|---|
| `room:<roomId>` | replica UUID | Per-room binding read by dispatch |
| `members:<roomId>` | JSON member list | Cached member set for size gating |
| `session:<roomId>` | Olm session metadata | Encryption state |
| `model:<roomId>` | model id string | Per-room `!model` override |

Direct KV write via the Cloudflare API:

```sh
curl -X PUT \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: text/plain" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces/036b2f9231de4d21bf0cdf120b5b4869/values/room:!ROOM:matrix.org" \
  --data-binary "<replica-uuid>"
```

## Verification

After enabling either mechanism, create a new test room and post a message.
Expected: no new `mx-*` workspace appears in `GET /v1/replica`. The
existing workspace receives the message via the normal `existing` path.

