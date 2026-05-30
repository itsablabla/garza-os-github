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

interface TgCallbackQuery {
	id: string;
	from?: { id: number };
	data?: string;
}

interface TgUpdate {
	update_id: number;
	message?: TgMessage;
	edited_message?: TgMessage;
	callback_query?: TgCallbackQuery;
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

		// Debug endpoint: GET /debug/watcher/<replicaId> returns the DO state.
		if (req.method === "GET" && url.pathname.startsWith("/debug/watcher/")) {
			const id = url.pathname.slice("/debug/watcher/".length);
			if (env.WATCHER && id) {
				const doId = env.WATCHER.idFromName(id);
				const stub = env.WATCHER.get(doId);
				return stub.fetch("https://watcher/debug", { method: "GET" });
			}
			return new Response("missing replica id", { status: 400 });
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

		if (update.callback_query) {
			ctx.waitUntil(handleCallback(update.callback_query, env));
			return new Response("ok");
		}

		const msg = update.message ?? update.edited_message;
		if (!msg) return new Response("ok");

		const text = (msg.text ?? msg.caption ?? "").trim();
		if (!text) return new Response("ok");

		ctx.waitUntil(handleMessage(msg, text, env));
		return new Response("ok");
	},
};

async function handleCallback(
	cb: { id: string; data?: string; from?: { id: number } },
	env: Env,
): Promise<void> {
	const data = cb.data ?? "";
	if (data.startsWith("c:")) {
		const replicaId = data.slice(2);
		try {
			const stub = env.WATCHER.get(env.WATCHER.idFromName(replicaId));
			await stub.fetch("https://watcher/cancel", { method: "POST" });
		} catch {}
		await ackCallback(env, cb.id, "Cancelling…");
		return;
	}
	await ackCallback(env, cb.id);
}

async function ackCallback(env: Env, id: string, text?: string): Promise<void> {
	const params = new URLSearchParams();
	params.set("callback_query_id", id);
	if (text) params.set("text", text);
	await fetch(`${env.TG_API_BASE}/bot${env.TG_TOKEN}/answerCallbackQuery`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: params.toString(),
	}).catch(() => {});
}

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

	// Fire-and-forget the 👀 reaction + the initial "Starting · 0s" frame
	// in parallel so the user sees activity before any Replicas call lands.
	const ackReaction = sendInstantAck(env, msg);
	const initialFrameP = sendTelegram(env, "sendMessage", {
		chat_id: msg.chat.id,
		message_thread_id: msg.message_thread_id,
		text: "🤔 <b>Starting</b> · 0s",
		parse_mode: "HTML",
		reply_to_message_id: msg.message_id,
		allow_sending_without_reply: true,
	})
		.then(async (r) => {
			if (!r.ok) return undefined;
			const j = (await r.json().catch(() => ({}))) as { result?: { message_id?: number } };
			return j.result?.message_id;
		})
		.catch(() => undefined);

	if (existing) {
		// For a follow-up, send the message AND re-arm the watcher in parallel.
		// initialStatusMessageId arrives via /ack once the frame send resolves.
		const [followUp] = await Promise.all([
			sendFollowUp(existing, text, env, msg),
			startWatcher(env, existing, msg, undefined),
		]);
		if (followUp.ok) {
			replicaId = existing;
		} else if (followUp.gone) {
			await env.MAP.delete(key);
			replicaId = await createReplica(msg, text, env);
			spawnedFresh = true;
		}
	} else {
		replicaId = await createReplica(msg, text, env);
		spawnedFresh = true;
	}

	const initialStatusMessageId = await initialFrameP;
	if (replicaId && initialStatusMessageId !== undefined) {
		const settledReplicaId = replicaId;
		if (spawnedFresh) {
			await startWatcher(env, settledReplicaId, msg, initialStatusMessageId);
		} else {
			env.WATCHER.get(env.WATCHER.idFromName(settledReplicaId))
				.fetch("https://watcher/ack", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ initialStatusMessageId }),
				})
				.catch(() => {});
		}
	} else if (replicaId && spawnedFresh) {
		// initialFrame send failed (rare). Fall back to the slow path: watcher
		// starts without a pre-sent frame and renders fresh on its first tick.
		await startWatcher(env, replicaId, msg, undefined);
	}

	// Don't block the response on the ack reaction — it's already in flight.
	await ackReaction.catch(() => {});

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
		// REPLICA_TTL_SECONDS = "0" → no TTL (permanent until we delete it
		// ourselves on respawn or unrecoverable error). Anything > 0 is
		// honored as a cap. Matches the matrix bridge change: KV mapping
		// survives as long as the replica does.
		const ttlEnv = parseInt(env.REPLICA_TTL_SECONDS, 10);
		const opts: KVNamespacePutOptions = ttlEnv > 0
			? { expirationTtl: Math.max(60, ttlEnv) }
			: {};
		await env.MAP.put(key, replicaId, opts);
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
		coding_agent: env.REPLICAS_AGENT_OVERRIDE || "claude",
		model: env.REPLICAS_MODEL_OVERRIDE || "claude-sonnet-4-6",
		thinking_level: env.REPLICAS_THINKING_OVERRIDE || "low",
		// Ported from matrix bridge directive: replicas should NEVER auto-
		// delete on inactivity. A new replica is only created when the
		// existing one is broken (a 404/410 from the messages endpoint
		// triggers the fresh-spawn fallback path above). Healthy idle
		// replicas survive indefinitely so the user can resume any
		// conversation without losing context.
		lifecycle_policy: "manual",
		auto_stop_minutes: 0,
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
	// Caller owns the single startWatcher invocation (carries the
	// initialStatusMessageId once the pre-sent frame resolves).
	return replicaId;
}

async function sendInstantAck(env: Env, msg: TgMessage): Promise<void> {
	const params = new URLSearchParams();
	params.set("chat_id", String(msg.chat.id));
	params.set("message_id", String(msg.message_id));
	params.set("reaction", JSON.stringify([{ type: "emoji", emoji: "👀" }]));
	await fetch(`${env.TG_API_BASE}/bot${env.TG_TOKEN}/setMessageReaction`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: params.toString(),
	}).catch(() => {});
}

async function startWatcher(
	env: Env,
	replicaId: string,
	msg: TgMessage,
	initialStatusMessageId?: number,
): Promise<void> {
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
				initialStatusMessageId,
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
	// Minimal hint — the poller does the work; the agent just produces Markdown.
	const hint = "# Spawned from Telegram. Your tool calls and final reply are auto-surfaced via an external poller. Emit Markdown freely; it'll be rendered to Telegram HTML.";
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
