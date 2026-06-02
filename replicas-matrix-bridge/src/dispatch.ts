import type { Env } from "./index";
import { MatrixError, react, sendMessage } from "./matrix";

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// The 👀 ack is the FIRST signal the user gets that the bot heard them
// (lands before the "Starting" frame even sends). It must survive 429s
// from matrix.org — that's exactly the moment a busy room hits the
// limit. Retry up to 3x honoring retry_after_ms.
async function reactWithRetry(
	env: { MATRIX_HOMESERVER: string; MATRIX_ACCESS_TOKEN: string; MATRIX_USER_ID: string },
	roomId: string,
	eventId: string,
	emoji: string,
): Promise<string> {
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			return await react(env, roomId, eventId, emoji);
		} catch (e) {
			if (e instanceof MatrixError && e.status === 429) {
				const waitMs = Math.min(8_000, Math.max(500, e.retryAfterMs ?? 1_500));
				await sleep(waitMs);
				continue;
			}
			return "";
		}
	}
	return "";
}

interface ReplicaCreateResponse {
	replica?: { id: string };
	id?: string;
}

async function snapshotReplicaEventCount(env: Env, replicaId: string): Promise<number> {
	try {
		const r = await fetch(
			`${env.REPLICAS_API_BASE}/replica/${replicaId}/history?limit=1`,
			{ headers: replicasHeaders(env) },
		);
		if (!r.ok) return 0;
		const body = (await r.json()) as { total?: number; events?: unknown[] };
		if (typeof body.total === "number") return body.total;
		return body.events?.length ?? 0;
	} catch {
		return 0;
	}
}

export async function handleMatrixMessage(
	env: Env,
	roomId: string,
	eventId: string,
	text: string,
	opts: { replyAsVoice?: boolean; dedupClaimed?: boolean } = {},
): Promise<void> {
	const key = `room:${roomId}`;
	const seenKey = `seen:${roomId}:${eventId}`;
	// Audit follow-up: dedupe via MatrixListener DO instead of KV. KV's
	// eventual consistency let two concurrent dispatches both read
	// "absent" and both proceed; routing through the singleton listener
	// DO uses blockConcurrencyWhile for genuine put-if-absent semantics.
	// The narrow race only fired when two paths hit the same event_id at
	// once (listener /sync + /admin/recover-room replay, or /dispatch
	// admin call racing the listener), but the cost of fixing it
	// properly is one cross-DO RPC per dispatch and a periodic prune of
	// the seen:* prefix (handled by the listener's existing prune cron).
	if (!opts.dedupClaimed) try {
		const listenerStub = env.LISTENER.get(env.LISTENER.idFromName("global"));
		const claim = await listenerStub.fetch("https://listener/dedup-claim", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ key: seenKey }),
		});
		const j = (await claim.json()) as { claimed?: boolean };
		if (!j.claimed) {
			console.log(`[dispatch] DEDUPE skip room=${roomId} ev=${eventId}`);
			return;
		}
	} catch (e) {
		// Failsafe to legacy KV path if the DO is unreachable — better to
		// risk a (very rare) double-dispatch than to drop the message.
		console.log(`[dispatch] dedup DO failed, falling back to KV: ${e instanceof Error ? e.message : e}`);
		const seen = await env.MAP.get(seenKey);
		if (seen) {
			console.log(`[dispatch] DEDUPE (kv fallback) skip room=${roomId} ev=${eventId}`);
			return;
		}
		await env.MAP.put(seenKey, "1", { expirationTtl: 600 });
	}

	// Start the visible status frame immediately after dedupe, before KV
	// room mapping and reverse-map checks. Those reads are correctness
	// work for routing, but the user should already see that the bot heard
	// the message while they happen.
	const initialFrameP = sendMessage(
		matrixEnvShape(env),
		roomId,
		`🤔 <b>Starting</b> · 0s`,
		{ replyTo: eventId },
	).catch(() => "");
	let initialFrameId: string | null = null;

	// Capture the 👀 ack reaction id so the watcher can redact it later when
	// it swaps in the terminal emoji — otherwise both stack on the prompt.
	// Goes through reactWithRetry so a 429 on a busy room doesn't silently
	// eat the user's first acknowledgment signal.
	const ackP = reactWithRetry(matrixEnvShape(env), roomId, eventId, "👀");

	let existing = await env.MAP.get(key);
	// Defensive guard: cross-room contamination check. If the reverse
	// mapping `replica:${existing}` -> ownerRoomId says this replica is
	// owned by a different room, we treat existing as unset and spawn
	// fresh — otherwise messages from room X would dispatch to room Y's
	// replica (observed in production today: 3 group rooms all pointing
	// at one replica id). Empty/absent reverse mapping is OK for
	// backwards compatibility with pre-guard replicas that never wrote
	// one.
	if (existing) {
		const ownerRoomId = await env.MAP.get(`replica:${existing}`);
		if (ownerRoomId && ownerRoomId !== roomId) {
			console.log(`[dispatch] CROSS-ROOM MISMATCH detected: room=${roomId} mapped to replicaId=${existing} but replica is owned by ${ownerRoomId} — flushing + spawning fresh`);
			await env.MAP.delete(key);
			existing = null;
		}
	}
	console.log(`[dispatch] proceed room=${roomId} ev=${eventId} existing=${existing ?? "none"} text=${JSON.stringify(text.slice(0, 50))}`);
	let replicaId: string | null = null;
	let spawnedFresh = false;

	if (existing) {
		// Capture the current history cursor BEFORE sending the follow-up,
		// then start the watcher with that explicit cursor while the
		// /messages request is in flight. This keeps same-session context
		// and avoids the stale-tail race that happens when the watcher
		// snapshots an old cleaned-up session by itself, but it no longer
		// makes Matrix status/tool polling wait for the Replicas POST to
		// return.
		const initialLastSeenCount = await snapshotReplicaEventCount(env, existing);
		const followUpP = sendFollowUp(existing, text, env, roomId, eventId);
		replicaId = existing;
		// Hand the watcher the pre-sent Starting frame so it edits that fast
		// visible bubble in place. Starting the watcher before awaiting
		// followUpP lets tool/thinking events surface as soon as Replicas
		// emits them, even if the POST itself is slow to return.
		initialFrameId = await initialFrameP;
		await startWatcher(env, existing, roomId, eventId, text, undefined, initialFrameId || undefined, opts.replyAsVoice, initialLastSeenCount);
		const followUp = await followUpP;
		if (followUp.ok) {
			// Opportunistic backfill of the reverse mapping for pre-PR-29
			// replicas that don't have one yet. The cross-room guard only
			// fires when the reverse exists; writing it on the first
			// successful follow-up after upgrade closes the protection
			// gap for the 47 mappings that existed when the guard
			// shipped. Race-safe: a colliding peer will see mismatch on
			// its NEXT follow-up and respawn.
			try {
				const reverseSet = await env.MAP.get(`replica:${existing}`);
				if (!reverseSet) {
					const ttlEnv = parseInt(env.REPLICA_TTL_SECONDS, 10);
					const opts: KVNamespacePutOptions = ttlEnv > 0
						? { expirationTtl: Math.max(60, ttlEnv) }
						: {};
					await env.MAP.put(`replica:${existing}`, roomId, opts);
				}
			} catch (e) {
				console.log(`[dispatch] reverse-map backfill failed: ${e instanceof Error ? e.message : e}`);
			}
		} else {
			// Any non-ok response (including the explicit `gone` 404/410 and
			// every other failure mode — 429, 5xx, network blip, etc.) falls
			// through to fresh-spawn. Prior behavior dropped non-gone failures
			// silently: 👀 was already on the prompt, but no replica was
			// reachable and replicaId stayed null, so the user got a 👀 ack
			// with no answer ever — the bot looked like it was thinking
			// forever. Safer to lose the existing chat state than the user's
			// message.
			console.log(
				`[dispatch] sendFollowUp failed for existing=${existing} gone=${followUp.gone} — respawning`,
			);
			env.WATCHER.get(env.WATCHER.idFromName(existing))
				.fetch("https://watcher/cancel", { method: "POST" })
				.catch(() => {});
			await env.MAP.delete(key);
			replicaId = await createReplica(env, roomId, eventId, text);
			spawnedFresh = true;
		}
	} else {
		replicaId = await createReplica(env, roomId, eventId, text);
		spawnedFresh = true;
	}

	if (initialFrameId === null) {
		initialFrameId = await initialFrameP;
	}

	if (replicaId) {
		const settledReplicaId = replicaId;
		// For fresh spawns the watcher hasn't started yet. For follow-ups we
		// already started it above and just need to forward the initial frame
		// + ack ids — same /ack endpoint already handles that.
		if (spawnedFresh) {
			await startWatcher(env, settledReplicaId, roomId, eventId, text, undefined, initialFrameId || undefined, opts.replyAsVoice);
		} else if (initialFrameId) {
			env.WATCHER.get(env.WATCHER.idFromName(settledReplicaId))
				.fetch("https://watcher/ack", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ initialStatusEventId: initialFrameId }),
				})
				.catch(() => {});
		}
		// Background: forward the ack reaction id once the react call lands.
		ackP
			.then((id) => {
				if (!id) return;
				const stub = env.WATCHER.get(env.WATCHER.idFromName(settledReplicaId));
				return stub.fetch("https://watcher/ack", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ ackReactionId: id }),
				});
			})
			.catch(() => {});
	}

	if (!replicaId) {
		console.log(`[dispatch] no replica for room=${roomId} ev=${eventId}`);
		return;
	}

	if (spawnedFresh) {
		// REPLICA_TTL_SECONDS = "0" → no TTL (permanent until we delete it
		// ourselves on respawn or auto-cut). Anything > 0 is honored as a
		// cap. Matches the directive: KV mapping survives as long as the
		// replica does; only explicit cleanup flushes it.
		const ttlEnv = parseInt(env.REPLICA_TTL_SECONDS, 10);
		const opts: KVNamespacePutOptions = ttlEnv > 0
			? { expirationTtl: Math.max(60, ttlEnv) }
			: {};
		await env.MAP.put(key, replicaId, opts);
		// Reverse mapping for cross-room contamination guard. Lets a
		// future dispatch detect that this replicaId is owned by this
		// specific room and refuse to attach to it from any other room.
		await env.MAP.put(`replica:${replicaId}`, roomId, opts);
	}
}

async function sendFollowUp(
	replicaId: string,
	text: string,
	env: Env,
	roomId: string,
	eventId: string,
): Promise<{ ok: boolean; gone: boolean }> {
	const r = await fetch(`${env.REPLICAS_API_BASE}/replica/${replicaId}/messages`, {
		method: "POST",
		headers: replicasHeaders(env),
		body: JSON.stringify({ message: prefixWithRoutingHeader(roomId, eventId, text) }),
	});
	return { ok: r.ok, gone: r.status === 404 || r.status === 410 };
}

async function createReplica(
	env: Env,
	roomId: string,
	eventId: string,
	text: string,
): Promise<string | null> {
	// Per-room model override set via `!model <name>` chat command; falls
	// back to the worker-wide default if not set for this room.
	const roomModel = await env.MAP.get(`model:${roomId}`);
	const body = {
		name: `mx-${roomId.replace(/[^a-z0-9]/gi, "").slice(0, 16)}-${Date.now()}`,
		message: prefixWithRoutingHeader(roomId, eventId, text),
		environment_id: env.REPLICAS_ENV_ID,
		source: "matrix",
		coding_agent: env.REPLICAS_AGENT_OVERRIDE || "claude",
		model: roomModel || env.REPLICAS_MODEL_OVERRIDE || "claude-sonnet-4-6",
		thinking_level: env.REPLICAS_THINKING_OVERRIDE || "medium",
		// Per directive: replicas should NEVER auto-delete on inactivity.
		// A new replica is only created when the existing one is broken
		// (the auto-cut path on unrecoverable claude-result errors, or
		// the 404/410 auto-respawn when Replicas already gave up on it).
		// Healthy idle replicas survive indefinitely so the user can
		// resume any conversation without losing context.
		lifecycle_policy: "manual",
		auto_stop_minutes: 0,
		metadata: { matrix_room_id: roomId, matrix_event_id: eventId },
	};
	const r = await fetch(`${env.REPLICAS_API_BASE}/replica`, {
		method: "POST",
		headers: replicasHeaders(env),
		body: JSON.stringify(body),
	});
	if (!r.ok) return null;
	const json = (await r.json()) as ReplicaCreateResponse;
	const replicaId = json.replica?.id ?? json.id ?? null;
	// Caller does the startWatcher with the awaited ack reaction id.
	return replicaId;
}

async function startWatcher(
	env: Env,
	replicaId: string,
	roomId: string,
	eventId: string,
	text: string,
	ackReactionId?: string,
	initialStatusEventId?: string,
	replyAsVoice?: boolean,
	initialLastSeenCount?: number,
): Promise<void> {
	const stub = env.WATCHER.get(env.WATCHER.idFromName(replicaId));
	await stub
		.fetch("https://watcher/watch", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				replicaId,
				roomId,
				startEventId: eventId,
				userText: text,
				ackReactionId: ackReactionId || undefined,
				initialStatusEventId: initialStatusEventId || undefined,
				replyAsVoice: replyAsVoice ? true : undefined,
				initialLastSeenCount,
			}),
		})
		.catch(() => {});
}

/**
 * Replace any lone UTF-16 surrogate code unit (a high surrogate without
 * a matching low surrogate, or vice versa) with U+FFFD REPLACEMENT
 * CHARACTER. This is defense-in-depth against Anthropic 400s of the
 * shape `invalid_request_error: The request body is not valid JSON: no
 * low surrogate in string at line 1 column N`. Most often the lone
 * surrogate comes from a tool result the agent later sends back, which
 * the bridge can't fix from out here — but we sanitize everything we
 * send TOWARDS Replicas so the bridge is never the introducer.
 */
export function sanitizeForJson(s: string): string {
	return s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
}

export function prefixWithRoutingHeader(roomId: string, eventId: string, text: string): string {
	const header = `[matrix:room=${roomId}:event=${eventId}]`;
	const hint =
		"# Spawned from Matrix. Your tool calls and final reply are auto-surfaced via an external poller. Emit Markdown freely; it'll be rendered to Matrix HTML.";
	return sanitizeForJson(`${header}\n${hint}\n\n${text}`);
}

function replicasHeaders(env: Env): HeadersInit {
	return {
		Authorization: `Bearer ${env.REPLICAS_API_KEY}`,
		"Replicas-Org-Id": env.REPLICAS_ORG_ID,
		"Content-Type": "application/json",
	};
}

function matrixEnvShape(env: Env) {
	return {
		MATRIX_HOMESERVER: env.MATRIX_HOMESERVER,
		MATRIX_ACCESS_TOKEN: env.MATRIX_ACCESS_TOKEN,
		MATRIX_USER_ID: env.MATRIX_USER_ID,
	};
}
