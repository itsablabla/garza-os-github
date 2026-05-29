// Matrix Client-Server API helpers — the equivalents of Telegram's
// sendMessage / editMessageText / setMessageReaction / sendChatAction /
// pinChatMessage. Pure functions over fetch + an MatrixEnv with token.
//
// Spec references:
//   https://spec.matrix.org/v1.11/client-server-api/
//   m.replace edit relation: https://spec.matrix.org/v1.11/client-server-api/#event-replacements
//   m.annotation reaction:   https://spec.matrix.org/v1.11/client-server-api/#mreaction
//   typing:                  /rooms/{roomId}/typing/{userId}
//   pin via state event:     m.room.pinned_events
//
// All calls return the parsed JSON. Failures throw with the status code and
// response body so the caller (DO) can log + back off.

export interface MatrixEnv {
	MATRIX_HOMESERVER: string;
	MATRIX_ACCESS_TOKEN: string;
	MATRIX_USER_ID: string;
}

type Json = Record<string, unknown>;

function randomTxn(): string {
	return `tx-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

async function call(
	env: MatrixEnv,
	method: "GET" | "POST" | "PUT",
	path: string,
	body?: Json,
): Promise<Json> {
	const url = `${env.MATRIX_HOMESERVER.replace(/\/$/, "")}${path}`;
	const r = await fetch(url, {
		method,
		headers: {
			Authorization: `Bearer ${env.MATRIX_ACCESS_TOKEN}`,
			"Content-Type": "application/json",
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	const text = await r.text();
	if (!r.ok) {
		// Extract retry_after_ms from M_LIMIT_EXCEEDED bodies so callers can
		// honor the homeserver's backoff hint instead of dumb-retrying into a
		// rate limit storm.
		let retryAfterMs: number | undefined;
		if (r.status === 429) {
			try {
				const parsed = JSON.parse(text) as { retry_after_ms?: number };
				if (typeof parsed.retry_after_ms === "number") retryAfterMs = parsed.retry_after_ms;
			} catch {}
		}
		throw new MatrixError(r.status, text.slice(0, 400), path, retryAfterMs);
	}
	if (!text) return {};
	try {
		return JSON.parse(text) as Json;
	} catch {
		return {};
	}
}

export class MatrixError extends Error {
	status: number;
	bodyPrefix: string;
	path: string;
	retryAfterMs?: number;
	constructor(status: number, bodyPrefix: string, path: string, retryAfterMs?: number) {
		super(`matrix ${path} ${status}: ${bodyPrefix}`);
		this.status = status;
		this.bodyPrefix = bodyPrefix;
		this.path = path;
		this.retryAfterMs = retryAfterMs;
	}
}

export async function whoami(env: MatrixEnv): Promise<{ user_id: string }> {
	const out = (await call(env, "GET", "/_matrix/client/v3/account/whoami")) as {
		user_id?: string;
	};
	return { user_id: out.user_id ?? "" };
}

/**
 * Send a new room message. Returns the event_id.
 *
 * `replyTo` makes it a Matrix native reply (m.in_reply_to). Used so the
 * status message anchors to the user's prompt the same way our Telegram
 * status reply-anchors with reply_parameters.
 */
export async function sendMessage(
	env: MatrixEnv,
	roomId: string,
	html: string,
	options: { replyTo?: string; plainFallback?: string; txnId?: string } = {},
): Promise<string> {
	// Caller can pin a stable txn id for idempotent retries — Matrix dedupes
	// per (access_token, txn_id) and returns the same event_id, so a fetch
	// blip after a successful send won't create a duplicate message.
	const txn = options.txnId ?? randomTxn();
	const body: Json = {
		msgtype: "m.text",
		body: options.plainFallback ?? stripHtml(html),
		format: "org.matrix.custom.html",
		formatted_body: html,
	};
	if (options.replyTo) {
		body["m.relates_to"] = { "m.in_reply_to": { event_id: options.replyTo } };
	}
	const out = (await call(
		env,
		"PUT",
		`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txn)}`,
		body,
	)) as { event_id?: string };
	if (!out.event_id) throw new Error(`sendMessage: missing event_id`);
	return out.event_id;
}

/**
 * Edit a previously sent message in place via the m.replace relation.
 * The new content lives in m.new_content; the outer body is shown by
 * clients that don't understand replacements.
 */
export async function editMessage(
	env: MatrixEnv,
	roomId: string,
	originalEventId: string,
	html: string,
	plainFallback?: string,
): Promise<void> {
	const txn = randomTxn();
	const fallback = plainFallback ?? stripHtml(html);
	const body: Json = {
		msgtype: "m.text",
		body: `* ${fallback}`,
		format: "org.matrix.custom.html",
		formatted_body: `* ${html}`,
		"m.new_content": {
			msgtype: "m.text",
			body: fallback,
			format: "org.matrix.custom.html",
			formatted_body: html,
		},
		"m.relates_to": {
			rel_type: "m.replace",
			event_id: originalEventId,
		},
	};
	await call(
		env,
		"PUT",
		`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txn)}`,
		body,
	);
}

/**
 * Attach an emoji reaction to an event via m.annotation. Matrix allows
 * multiple reactions from the same user — we don't dedupe here; the DO
 * tracks the previous reaction event_id and redacts it on phase change.
 */
export async function react(
	env: MatrixEnv,
	roomId: string,
	targetEventId: string,
	emoji: string,
): Promise<string> {
	const txn = randomTxn();
	const body: Json = {
		"m.relates_to": {
			rel_type: "m.annotation",
			event_id: targetEventId,
			key: emoji,
		},
	};
	const out = (await call(
		env,
		"PUT",
		`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.reaction/${encodeURIComponent(txn)}`,
		body,
	)) as { event_id?: string };
	return out.event_id ?? "";
}

/** Redact (remove) a previously-sent event — used to clear an old reaction. */
export async function redact(env: MatrixEnv, roomId: string, eventId: string, reason?: string): Promise<void> {
	const txn = randomTxn();
	await call(
		env,
		"PUT",
		`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(eventId)}/${encodeURIComponent(txn)}`,
		reason ? { reason } : {},
	);
}

/** Typing indicator. Matrix accepts a timeout up to 30s; we re-call every ~25s. */
export async function typing(env: MatrixEnv, roomId: string, isTyping: boolean, timeoutMs = 25_000): Promise<void> {
	await call(
		env,
		"PUT",
		`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(env.MATRIX_USER_ID)}`,
		{ typing: isTyping, timeout: isTyping ? timeoutMs : 0 },
	);
}

/**
 * Pin the given event in the room. Matrix requires reading the current
 * pinned list, prepending, and PUTing the new state. Need power level
 * sufficient to set room state — usually granted in DMs.
 */
export async function pin(env: MatrixEnv, roomId: string, eventId: string): Promise<void> {
	const url = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.pinned_events`;
	let pinned: string[] = [];
	try {
		const cur = (await call(env, "GET", url)) as { pinned?: string[] };
		if (Array.isArray(cur.pinned)) pinned = cur.pinned;
	} catch (e) {
		if (!(e instanceof MatrixError && e.status === 404)) throw e;
	}
	if (!pinned.includes(eventId)) pinned.unshift(eventId);
	await call(env, "PUT", url, { pinned });
}

export async function unpin(env: MatrixEnv, roomId: string, eventId: string): Promise<void> {
	const url = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.pinned_events`;
	let pinned: string[] = [];
	try {
		const cur = (await call(env, "GET", url)) as { pinned?: string[] };
		if (Array.isArray(cur.pinned)) pinned = cur.pinned;
	} catch (e) {
		if (e instanceof MatrixError && e.status === 404) return;
		throw e;
	}
	const next = pinned.filter((id) => id !== eventId);
	if (next.length === pinned.length) return;
	await call(env, "PUT", url, { pinned: next });
}

export async function joinRoom(env: MatrixEnv, roomId: string): Promise<void> {
	await call(env, "POST", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/join`);
}

/**
 * `/sync` long-poll — returns the next batch of events. Caller passes the
 * `since` token from the previous response, plus `timeout` ms (~28s leaves
 * margin under CF Workers' 30s fetch limit).
 *
 * We aggressively filter `room` events server-side via `filter` so the
 * response stays small even in busy accounts.
 */
export interface SyncResponse {
	next_batch?: string;
	rooms?: {
		invite?: Record<string, unknown>;
		join?: Record<string, JoinedRoomSync>;
	};
	to_device?: { events?: ToDeviceEvent[] };
	device_one_time_keys_count?: Record<string, number>;
}

export interface ToDeviceEvent {
	type?: string;
	sender?: string;
	content?: {
		algorithm?: string;
		sender_key?: string;
		ciphertext?: Record<string, { type?: 0 | 1; body?: string }>;
		[k: string]: unknown;
	};
}

export interface JoinedRoomSync {
	timeline?: {
		events?: MatrixEvent[];
	};
}

export interface MatrixEvent {
	type?: string;
	event_id?: string;
	sender?: string;
	room_id?: string;
	content?: Record<string, unknown>;
	origin_server_ts?: number;
	// Matrix echoes the txn back on /sync only to the access token that sent
	// the event. We use this (not `sender`) to skip the bot's own sends so
	// self-bot mode works — same Matrix user typing in Element while the
	// worker also holds a token for that user.
	unsigned?: { transaction_id?: string };
}

export async function sync(
	env: MatrixEnv,
	since: string | undefined,
	timeoutMs: number,
): Promise<SyncResponse> {
	// URLSearchParams handles the encoding — passing the raw JSON
	// avoids the double-encoding that produced "Invalid filter ID".
	const filter = JSON.stringify({
		room: {
			timeline: { limit: 20, lazy_load_members: true },
			state: { lazy_load_members: true },
			ephemeral: { types: [] },
			account_data: { types: [] },
		},
		presence: { types: [] },
		account_data: { types: [] },
		// We want every Olm-encrypted to-device event so we can decrypt
		// m.room_key shares and keep up with Megolm rotation live.
		to_device: { types: ["m.room.encrypted"] },
	});
	const params = new URLSearchParams();
	params.set("timeout", String(timeoutMs));
	params.set("filter", filter);
	if (since) params.set("since", since);
	return (await call(env, "GET", `/_matrix/client/v3/sync?${params.toString()}`)) as SyncResponse;
}

/** Crude HTML→plain text stripper for the `body` fallback. */
export function stripHtml(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/p>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
