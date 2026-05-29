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

export async function handleMatrixMessage(
	env: Env,
	roomId: string,
	eventId: string,
	text: string,
): Promise<void> {
	const key = `room:${roomId}`;
	const seenKey = `seen:${roomId}:${eventId}`;
	const seen = await env.MAP.get(seenKey);
	if (seen) {
		console.log(`[dispatch] DEDUPE skip room=${roomId} ev=${eventId}`);
		return;
	}
	await env.MAP.put(seenKey, "1", { expirationTtl: 600 });

	// Capture the 👀 ack reaction id so the watcher can redact it later when
	// it swaps in the terminal emoji — otherwise both stack on the prompt.
	// Goes through reactWithRetry so a 429 on a busy room doesn't silently
	// eat the user's first acknowledgment signal.
	const ackP = reactWithRetry(matrixEnvShape(env), roomId, eventId, "👀");

	const existing = await env.MAP.get(key);
	console.log(`[dispatch] proceed room=${roomId} ev=${eventId} existing=${existing ?? "none"} text=${JSON.stringify(text.slice(0, 50))}`);
	let replicaId: string | null = null;
	let spawnedFresh = false;

	// Optimistic path: kick off the initial "Starting · 0s" status frame and
	// the Replicas spawn/follow-up in parallel — and for follow-ups, start
	// the watcher in parallel with sendFollowUp. The user sees activity in
	// ~150ms instead of waiting on the 1.5s POST /replica roundtrip.
	const initialFrameP = sendMessage(
		matrixEnvShape(env),
		roomId,
		`🤔 <b>Starting</b> · 0s`,
		{ replyTo: eventId },
	).catch(() => "");

	if (existing) {
		// Watcher fires in parallel with sendFollowUp. If the follow-up turns
		// out to be `gone` (replica expired), we'll cancel and respawn.
		const followUpP = sendFollowUp(existing, text, env, roomId, eventId);
		const watcherP = startWatcher(env, existing, roomId, eventId, text, undefined, undefined);
		const followUp = await followUpP;
		await watcherP;
		if (followUp.ok) {
			replicaId = existing;
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

	const initialFrameId = await initialFrameP;

	if (replicaId) {
		const settledReplicaId = replicaId;
		// For fresh spawns the watcher hasn't started yet. For follow-ups we
		// already started it above and just need to forward the initial frame
		// + ack ids — same /ack endpoint already handles that.
		if (spawnedFresh) {
			await startWatcher(env, settledReplicaId, roomId, eventId, text, undefined, initialFrameId || undefined);
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
		const ttl = Math.max(60, parseInt(env.REPLICA_TTL_SECONDS, 10) || 604800);
		await env.MAP.put(key, replicaId, { expirationTtl: ttl });
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
		lifecycle_policy: "delete_after_inactivity",
		auto_stop_minutes: 60,
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
	};
}

function matrixEnvShape(env: Env) {
	return {
		MATRIX_HOMESERVER: env.MATRIX_HOMESERVER,
		MATRIX_ACCESS_TOKEN: env.MATRIX_ACCESS_TOKEN,
		MATRIX_USER_ID: env.MATRIX_USER_ID,
	};
}
