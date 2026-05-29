import { handleMatrixMessage } from "./dispatch";
import type { Env } from "./index";
import { joinRoom, sync, type SyncResponse } from "./matrix";
import { decryptMegolm, findSessionKey } from "./megolm";
import { parseKeyExport, type MegolmSessionKey } from "./megolm-keys";

/**
 * MatrixListener — single global Durable Object that holds the bot's
 * /sync long-poll. Re-runs on a ~1s alarm so we keep catching up
 * regardless of bot inactivity.
 *
 * For every new m.room.message event in a joined room from a non-self
 * sender, it triggers the Worker's incoming-message route to spawn or
 * follow-up the appropriate Replicas workspace.
 *
 * For every m.room.member invite, auto-accepts so users can add the
 * bot just by inviting it.
 */

const ALARM_INTERVAL_MS = 1000;
const SYNC_TIMEOUT_MS = 28_000; // under CF Workers' 30s fetch limit

export class MatrixListener {
	private state: DurableObjectState;
	private env: Env;

	constructor(state: DurableObjectState, env: Env) {
		this.state = state;
		this.env = env;
	}

	async fetch(req: Request): Promise<Response> {
		const url = new URL(req.url);
		if (req.method === "POST" && url.pathname === "/start") {
			await this.state.storage.setAlarm(Date.now() + 100);
			return new Response("ok");
		}
		if (req.method === "POST" && url.pathname === "/reset") {
			// Drop the since token so the next /sync starts cleanly. Used when
			// the access token / device changes — the to_device queue on the
			// new device starts fresh.
			await this.state.storage.delete("since");
			await this.state.storage.setAlarm(Date.now() + 100);
			return new Response("ok");
		}
		if (req.method === "POST" && url.pathname === "/stop") {
			await this.state.storage.deleteAlarm();
			return new Response("ok");
		}
		if (req.method === "GET" && url.pathname === "/debug") {
			const since = await this.state.storage.get<string>("since");
			const alarmAt = await this.state.storage.getAlarm();
			return new Response(
				JSON.stringify({ since: since ?? null, alarmAt }, null, 2),
				{ headers: { "Content-Type": "application/json" } },
			);
		}
		return new Response("not found", { status: 404 });
	}

	async alarm(): Promise<void> {
		try {
			await this.alarmInner();
		} catch (e) {
			console.error("[listener] alarm threw", e instanceof Error ? e.message : String(e));
		}
		await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
	}

	private async alarmInner(): Promise<void> {
		const since = await this.state.storage.get<string>("since");
		let resp: SyncResponse;
		try {
			resp = await sync(matrixEnv(this.env), since, SYNC_TIMEOUT_MS);
		} catch (e) {
			console.log(`[listener] /sync failed: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}

		if (resp.next_batch) await this.state.storage.put("since", resp.next_batch);

		// On the very first sync (no prior token), skip historical events to
		// avoid re-processing everything ever sent in joined rooms.
		if (!since) return;

		// Drain to_device events before timeline so any m.room_key shares
		// land in the live keystore before we try to decrypt this batch's
		// encrypted room messages.
		const toDevice = resp.to_device?.events ?? [];
		for (const ev of toDevice) {
			if (ev.type !== "m.room.encrypted") continue;
			if (ev.content?.algorithm !== "m.olm.v1.curve25519-aes-sha2") continue;
			const senderKey = (ev.content as { sender_key?: string }).sender_key;
			if (!senderKey) continue;
			const ourId = await this.ourCurve25519();
			const entry = ev.content.ciphertext?.[ourId];
			if (!entry?.body || entry.type === undefined) continue;
			try {
				const stub = this.env.OLM_VAULT.get(this.env.OLM_VAULT.idFromName("global"));
				const r = await stub.fetch("https://vault/decrypt-todevice", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ senderCurve25519: senderKey, ciphertext: { type: entry.type, body: entry.body } }),
				});
				const j = (await r.json()) as { ok?: boolean; captured?: boolean };
				console.log(
					`[listener] to_device sender=${senderKey.slice(0, 12)}… type=${entry.type} ok=${j.ok} captured=${j.captured}`,
				);
			} catch (e) {
				console.log(`[listener] to_device decrypt failed: ${e instanceof Error ? e.message : e}`);
			}
		}

		const invited = resp.rooms?.invite ?? {};
		for (const roomId of Object.keys(invited)) {
			console.log(`[listener] auto-join invite ${roomId}`);
			try {
				await joinRoom(matrixEnv(this.env), roomId);
			} catch (e) {
				console.log(`[listener] join failed for ${roomId}: ${e instanceof Error ? e.message : e}`);
			}
		}

		const joined = resp.rooms?.join ?? {};
		for (const [roomId, room] of Object.entries(joined)) {
			const events = room.timeline?.events ?? [];
			const megolmKeys = this.megolmKeys();
			for (const ev of events) {
				if (!ev.event_id || !ev.sender) continue;
				// Skip our own sends. We can't filter by `sender` because the
				// bot account may be the same Matrix user the human types
				// from (self-bot mode). Instead, /sync echoes back the
				// transaction_id only to the access token that PUT the event,
				// so its presence means "this came from us" regardless of who
				// the sender field says it is.
				if (ev.unsigned?.transaction_id) continue;

				let msgtype: string | undefined;
				let body: string | undefined;

				if (ev.type === "m.room.message") {
					const content = ev.content ?? {};
					msgtype = content.msgtype as string | undefined;
					body = content.body as string | undefined;
				} else if (ev.type === "m.room.encrypted") {
					// E2EE event — try to decrypt using imported Megolm keys.
					const decrypted = await this.tryDecrypt(roomId, ev, megolmKeys);
					if (!decrypted) continue;
					msgtype = decrypted.msgtype;
					body = decrypted.body;
				} else {
					continue;
				}
				if (msgtype !== "m.text" || !body) continue;

				// Reply-`!cancel` opcode — short-circuit before spawning.
				if (body.trim().startsWith("!cancel")) {
					await this.handleCancel(roomId);
					continue;
				}

				await this.dispatchMessage(roomId, ev.event_id, body);
			}
		}
	}

	private cachedKeys: MegolmSessionKey[] | undefined;
	private cachedCurve25519: string | undefined;

	private megolmKeys(): MegolmSessionKey[] {
		if (this.cachedKeys === undefined) {
			this.cachedKeys = parseKeyExport(this.env.MATRIX_MEGOLM_KEYS_JSON);
			console.log(`[listener] loaded ${this.cachedKeys.length} Megolm session keys`);
		}
		return this.cachedKeys;
	}

	private async ourCurve25519(): Promise<string> {
		if (this.cachedCurve25519) return this.cachedCurve25519;
		const stub = this.env.OLM_VAULT.get(this.env.OLM_VAULT.idFromName("global"));
		const r = await stub.fetch("https://vault/identity");
		const j = (await r.json()) as { identity_keys?: { curve25519?: string } };
		this.cachedCurve25519 = j.identity_keys?.curve25519 ?? "";
		return this.cachedCurve25519;
	}

	// Live keystore lookup: ask the OlmVault for a Megolm session_key captured
	// via /sendToDevice. Falls back to the static import.
	private async findKey(roomId: string, sessionId: string, keys: MegolmSessionKey[]): Promise<string | undefined> {
		const fromImport = findSessionKey(keys, roomId, sessionId);
		if (fromImport) return fromImport;
		try {
			const stub = this.env.OLM_VAULT.get(this.env.OLM_VAULT.idFromName("global"));
			const r = await stub.fetch(
				`https://vault/lookup?room=${encodeURIComponent(roomId)}&session=${encodeURIComponent(sessionId)}`,
			);
			const j = (await r.json()) as { found?: boolean; session_key?: string | null };
			return j.found && j.session_key ? j.session_key : undefined;
		} catch {
			return undefined;
		}
	}

	private async tryDecrypt(
		roomId: string,
		ev: { content?: Record<string, unknown>; event_id?: string },
		keys: MegolmSessionKey[],
	): Promise<{ msgtype: string; body: string } | undefined> {
		const content = ev.content ?? {};
		if (content.algorithm !== "m.megolm.v1.aes-sha2") return undefined;
		const sessionId = content.session_id as string | undefined;
		const ciphertext = content.ciphertext as string | undefined;
		if (!sessionId || !ciphertext) return undefined;
		const sessionKey = await this.findKey(roomId, sessionId, keys);
		if (!sessionKey) {
			console.log(`[listener] no key for room=${roomId} session=${sessionId.slice(0, 16)}…`);
			return undefined;
		}
		try {
			const { plaintext } = await decryptMegolm(sessionKey, ciphertext);
			const inner = JSON.parse(plaintext) as {
				type?: string;
				content?: { msgtype?: string; body?: string };
			};
			if (inner.type !== "m.room.message") return undefined;
			return {
				msgtype: inner.content?.msgtype ?? "",
				body: inner.content?.body ?? "",
			};
		} catch (e) {
			console.log(`[listener] decrypt fail ev=${ev.event_id}: ${e instanceof Error ? e.message : e}`);
			return undefined;
		}
	}

	private async dispatchMessage(roomId: string, eventId: string, body: string): Promise<void> {
		// In-process call so we don't pay an extra Worker round-trip.
		try {
			await handleMatrixMessage(this.env, roomId, eventId, body);
		} catch (e) {
			console.log(`[listener] dispatch failed: ${e instanceof Error ? e.message : e}`);
		}
	}

	private async handleCancel(roomId: string): Promise<void> {
		const key = `room:${roomId}`;
		const replicaId = await this.env.MAP.get(key);
		if (!replicaId) return;
		const stub = this.env.WATCHER.get(this.env.WATCHER.idFromName(replicaId));
		await stub.fetch("https://watcher/cancel", { method: "POST" }).catch(() => {});
	}
}

function matrixEnv(env: Env): {
	MATRIX_HOMESERVER: string;
	MATRIX_ACCESS_TOKEN: string;
	MATRIX_USER_ID: string;
} {
	return {
		MATRIX_HOMESERVER: env.MATRIX_HOMESERVER,
		MATRIX_ACCESS_TOKEN: env.MATRIX_ACCESS_TOKEN,
		MATRIX_USER_ID: env.MATRIX_USER_ID,
	};
}
