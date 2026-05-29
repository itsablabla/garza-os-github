import type { Env } from "./index";
import { react } from "./matrix";

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
	if (seen) return;
	await env.MAP.put(seenKey, "1", { expirationTtl: 600 });

	const ackP = react(matrixEnvShape(env), roomId, eventId, "👀").catch(() => "");

	const existing = await env.MAP.get(key);
	let replicaId: string | null = null;
	let spawnedFresh = false;

	if (existing) {
		const [followUp] = await Promise.all([
			sendFollowUp(existing, text, env, roomId, eventId),
			startWatcher(env, existing, roomId, eventId, text),
		]);
		if (followUp.ok) {
			replicaId = existing;
		} else if (followUp.gone) {
			await env.MAP.delete(key);
			replicaId = await createReplica(env, roomId, eventId, text);
			spawnedFresh = true;
		}
	} else {
		replicaId = await createReplica(env, roomId, eventId, text);
		spawnedFresh = true;
	}

	await ackP;

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
	const body = {
		name: `mx-${roomId.replace(/[^a-z0-9]/gi, "").slice(0, 16)}-${Date.now()}`,
		message: prefixWithRoutingHeader(roomId, eventId, text),
		environment_id: env.REPLICAS_ENV_ID,
		source: "matrix",
		coding_agent: env.REPLICAS_AGENT_OVERRIDE || "claude",
		model: env.REPLICAS_MODEL_OVERRIDE || "claude-sonnet-4-6",
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
	if (replicaId) {
		await startWatcher(env, replicaId, roomId, eventId, text);
	}
	return replicaId;
}

async function startWatcher(
	env: Env,
	replicaId: string,
	roomId: string,
	eventId: string,
	text: string,
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
			}),
		})
		.catch(() => {});
}

export function prefixWithRoutingHeader(roomId: string, eventId: string, text: string): string {
	const header = `[matrix:room=${roomId}:event=${eventId}]`;
	const hint =
		"# Spawned from Matrix. Your tool calls and final reply are auto-surfaced via an external poller. Emit Markdown freely; it'll be rendered to Matrix HTML.";
	return `${header}\n${hint}\n\n${text}`;
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
