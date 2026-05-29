export interface Env {
	MAP: KVNamespace;
	TG_TOKEN: string;
	TG_WEBHOOK_SECRET: string;
	REPLICAS_API_KEY: string;
	REPLICAS_ORG_ID: string;
	REPLICAS_ENV_ID: string;
	REPLICAS_API_BASE: string;
	TG_API_BASE: string;
	REPLICA_TTL_SECONDS: string;
}

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

	const replicaId = existing
		? await sendFollowUp(existing, text, env, msg).then(() => existing).catch(() => null)
		: await createReplica(msg, text, env);

	if (!replicaId) {
		await sendTelegram(env, "sendMessage", {
			chat_id: msg.chat.id,
			message_thread_id: msg.message_thread_id,
			text: "Sorry — couldn't reach Replicas. Try again in a minute.",
			reply_to_message_id: msg.message_id,
		});
		return;
	}

	if (!existing) {
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
	return json.replica?.id ?? json.id ?? null;
}

async function sendFollowUp(replicaId: string, text: string, env: Env, msg: TgMessage): Promise<void> {
	const r = await fetch(`${env.REPLICAS_API_BASE}/replica/${replicaId}/messages`, {
		method: "POST",
		headers: replicasHeaders(env),
		body: JSON.stringify({ message: prefixWithRoutingHeader(msg, text) }),
	});
	if (!r.ok) throw new Error(`follow-up failed: ${r.status}`);
}

export function prefixWithRoutingHeader(msg: TgMessage, text: string): string {
	const parts = [`chat_id=${msg.chat.id}`];
	if (msg.message_thread_id !== undefined) parts.push(`thread_id=${msg.message_thread_id}`);
	const header = `[tg:${parts.join(":")}]`;
	const hint =
		"# Spawned from Telegram. Post status + your final result back with `~/.replicas/bin/tg-reply.sh \"<text>\"`. Run `~/.replicas/bin/tg-target-detect.sh` once with this prompt'\u0027s first line on stdin to cache the target. See `~/.replicas/TELEGRAM_REPLY.md`.";
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
