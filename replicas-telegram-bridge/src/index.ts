export interface Env {
	MAP: KVNamespace;
	WATCHER: DurableObjectNamespace;
	TG_TOKEN: string;
	TG_WEBHOOK_SECRET: string;
	REPLICAS_API_KEY: string;
	REPLICAS_ORG_ID: string;
	REPLICAS_ENV_ID: string;
	REPLICAS_API_BASE: string;
	TG_API_BASE: string;
	REPLICA_TTL_SECONDS: string;
	REPLICAS_AGENT_OVERRIDE?: string;
	REPLICAS_MODEL_OVERRIDE?: string;
	REPLICAS_THINKING_OVERRIDE?: string;
}

export { ReplicaPoller } from "./poller";

interface TgChat {
	id: number;
	type: "private" | "group" | "supergroup" | "channel";
	title?: string;
	username?: string;
}

interface TgUser {
	id: number;
	username?: string;
	first_name?: string;
}

interface TgMessage {
	message_id: number;
	from?: TgUser;
	chat: TgChat;
	date: number;
	text?: string;
	caption?: string;
	message_thread_id?: number;
}

interface TgUpdate {
	update_id: number;
	message?: TgMessage;
	edited_message?: TgMessage;
}

interface ReplicaCreateResponse {
	replica?: { id: string };
	id?: string;
}

const SECRET_HEADER = "x-telegram-bot-api-secret-token";

export default {
	async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(req.url);

		if (req.method === "GET" && url.pathname === "/health") {
			return new Response("ok", { status: 200 });
		}

		if (req.method !== "POST" || url.pathname !== "/tg") {
			return new Response("not found", { status: 404 });
		}

		if (env.TG_WEBHOOK_SECRET && req.headers.get(SECRET_HEADER) !== env.TG_WEBHOOK_SECRET) {
			return new Response("forbidden", { status: 403 });
		}

		let update: TgUpdate;
		try {
			update = await req.json();
		} catch {
			return new Response("bad json", { status: 400 });
		}

		const msg = update.message ?? update.edited_message;
		if (!msg) return new Response("ok"); // join/leave/reaction-only updates etc.

		const text = (msg.text ?? msg.caption ?? "").trim();
		if (!text) return new Response("ok");

		// Handle on a background task so Telegram doesn't retry on slow Replicas calls.
		ctx.waitUntil(handleMessage(msg, text, env));
		return new Response("ok");
	},
};

export async function handleMessage(msg: TgMessage, text: string, env: Env): Promise<void> {
	const key = routingKey(msg.chat.id, msg.message_thread_id);
	const idempotencyKey = `seen:${msg.chat.id}:${msg.message_id}`;

	// Idempotency: Telegram retries webhooks on non-2xx. We always return 200, but
	// double-deliveries can still happen — short TTL guard.
	const seen = await env.MAP.get(idempotencyKey);
	if (seen) return;
	await env.MAP.put(idempotencyKey, "1", { expirationTtl: 600 });

	const existing = await env.MAP.get(key);

	let replicaId: string | null = null;
	let spawnedFresh = false;

	if (existing) {
		const followUp = await sendFollowUp(existing, text, env, msg);
		if (followUp.ok) {
			replicaId = existing;
			// Re-arm the poller so follow-up tool calls also surface live.
			await startWatcher(env, existing, msg);
		} else if (followUp.gone) {
			// Replica was deleted or expired. Invalidate KV and spawn fresh
			// so the user doesn't get stuck routing to a dead workspace.
			await env.MAP.delete(key);
			replicaId = await createReplica(msg, text, env);
			spawnedFresh = true;
		}
	} else {
		replicaId = await createReplica(msg, text, env);
		spawnedFresh = true;
	}

	if (!replicaId) {
		await sendTelegram(env, "sendMessage", {
			chat_id: msg.chat.id,
			message_thread_id: msg.message_thread_id,
			text: "Sorry — couldn't reach Replicas. Try again in a minute.",
			reply_to_message_id: msg.message_id,
		});
		return;
	}

	if (spawnedFresh) {
		const ttl = Math.max(60, parseInt(env.REPLICA_TTL_SECONDS, 10) || 604800);
		await env.MAP.put(key, replicaId, { expirationTtl: ttl });
	}

	// Acknowledge with an eyes reaction (Bot API 7.0+).
	await sendTelegram(env, "setMessageReaction", {
		chat_id: msg.chat.id,
		message_id: msg.message_id,
		reaction: [{ type: "emoji", emoji: "\uD83D\uDC40" }],
	}).catch(() => {
		// Older clients / restricted chats may reject — not fatal.
	});
}

export function routingKey(chatId: number, threadId?: number): string {
	return `chat:${chatId}:thread:${threadId ?? "main"}`;
}

async function createReplica(msg: TgMessage, text: string, env: Env): Promise<string | null> {
	const body = {
		name: replicaName(msg),
		message: prefixWithRoutingHeader(msg, text),
		environment_id: env.REPLICAS_ENV_ID,
		source: "telegram",
		// Default Telegram-spawned replicas to a faster model + low thinking so
		// the chat UX stays snappy. Can be overridden by env vars at deploy
		// time without code change (see REPLICAS_*_OVERRIDE wrangler vars).
		coding_agent: env.REPLICAS_AGENT_OVERRIDE || "claude",
		model: env.REPLICAS_MODEL_OVERRIDE || "claude-sonnet-4-6",
		thinking_level: env.REPLICAS_THINKING_OVERRIDE || "low",
		metadata: {
			telegram_chat_id: msg.chat.id,
			telegram_chat_title: msg.chat.title ?? msg.chat.username ?? null,
			telegram_thread_id: msg.message_thread_id ?? null,
			telegram_from_username: msg.from?.username ?? null,
		},
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
		await startWatcher(env, replicaId, msg);
	}
	return replicaId;
}

async function startWatcher(env: Env, replicaId: string, msg: TgMessage): Promise<void> {
	if (!env.WATCHER) return;
	const id = env.WATCHER.idFromName(replicaId);
	const stub = env.WATCHER.get(id);
	await stub
		.fetch("https://watcher/watch", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				replicaId,
				chatId: msg.chat.id,
				threadId: msg.message_thread_id,
				startMessageId: msg.message_id,
				userText: msg.text ?? msg.caption ?? "",
			}),
		})
		.catch(() => {});
}

async function sendFollowUp(
	replicaId: string,
	text: string,
	env: Env,
	msg: TgMessage,
): Promise<{ ok: boolean; gone: boolean }> {
	const r = await fetch(`${env.REPLICAS_API_BASE}/replica/${replicaId}/messages`, {
		method: "POST",
		headers: replicasHeaders(env),
		body: JSON.stringify({ message: prefixWithRoutingHeader(msg, text) }),
	});
	return { ok: r.ok, gone: r.status === 404 || r.status === 410 };
}

export function prefixWithRoutingHeader(msg: TgMessage, text: string): string {
	const parts = [`chat_id=${msg.chat.id}`];
	if (msg.message_thread_id !== undefined) parts.push(`thread_id=${msg.message_thread_id}`);
	const header = `[tg:${parts.join(":")}]`;
	const hint =
		"# Spawned from Telegram. Your thinking, tool calls, and final reply are surfaced to the user automatically by an external poller (Durable Object) — just work the task normally and your final assistant message becomes the Telegram reply.";
	return `${header}\n${hint}\n\n${text}`;
}

function replicasHeaders(env: Env): HeadersInit {
	return {
		Authorization: `Bearer ${env.REPLICAS_API_KEY}`,
		"Replicas-Org-Id": env.REPLICAS_ORG_ID,
		"Content-Type": "application/json",
	};
}

export function replicaName(msg: TgMessage): string {
	const who = msg.from?.username ?? msg.from?.first_name ?? "tg";
	const slug =
		who.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 16) || "tg";
	return `tg-${slug}-${msg.chat.id}-${msg.message_id}`;
}

async function sendTelegram(env: Env, method: string, body: unknown): Promise<Response> {
	return fetch(`${env.TG_API_BASE}/bot${env.TG_TOKEN}/${method}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}
