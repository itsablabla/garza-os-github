import { handleMatrixMessage } from "./dispatch";
import type { Env } from "./index";
import { fetchVoiceAudio, type EncryptedFile } from "./media-fetch";
import { joinRoom, sendMessage, sync, type SyncResponse } from "./matrix";
import { decryptMegolm, findSessionKey } from "./megolm";
import { parseKeyExport, type MegolmSessionKey } from "./megolm-keys";
import { escapeHtml } from "./render";
import { formatVoiceDuration, transcribeAudio } from "./transcribe";

// Aliases to make the chat command friendlier than typing the full id.
function resolveModelAlias(input: string): string {
	const n = input.trim().toLowerCase();
	if (n === "sonnet") return "claude-sonnet-4-6";
	if (n === "opus") return "claude-opus-4-7";
	if (n === "haiku") return "claude-haiku-4-5";
	return input.trim();
}

// Plain-text wake word for group rooms. Required because Beeper Desktop,
// mobile Matrix clients, and the API direct-send path frequently emit
// "Jada do X" without attaching `m.mentions.user_ids` or a matrix.to link
// in `formatted_body`, so the spec-compliant mention gate silently drops
// every such message. Empirically observed across "Schedule Manager",
// "Nomad promise program", and most multi-human Manager rooms.
//
// Match rules:
//   - anchored at the body start (optionally with leading whitespace)
//   - optional `@` prefix
//   - case-insensitive
//   - word boundary after the name so "jadaphone" does NOT match
//   - mid-body mentions ("I told Jada earlier") do NOT match — those
//     belong on the explicit mention gate, not the plain-text fallback
export function isPlainTextWakeWord(body: string, displayName: string): boolean {
	if (!body || !displayName) return false;
	const escaped = displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(`^\\s*@?${escaped}\\b`, "i");
	return pattern.test(body);
}

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
		if (req.method === "POST" && url.pathname === "/dedup-claim") {
			// Atomic put-if-absent for the dispatch dedupe path. KV's
			// eventual consistency lets two concurrent reads both see
			// "not present" and both write "1", letting the same Matrix
			// event spawn the agent twice. Routing through this DO uses
			// blockConcurrencyWhile so the check + write is genuinely
			// atomic — at most one caller per event_id gets {claimed:true}.
			const body = (await req.json()) as { key: string };
			let claimed = false;
			await this.state.blockConcurrencyWhile(async () => {
				const existing = await this.state.storage.get<number>(body.key);
				if (existing) return;
				await this.state.storage.put(body.key, Date.now());
				claimed = true;
			});
			return Response.json({ claimed });
		}
		if (req.method === "POST" && url.pathname === "/reload-keys") {
			// Clear the in-memory cachedKeys so the next megolmKeys() call
			// re-reads MATRIX_MEGOLM_KEYS_JSON from env. Lets the operator
			// rotate Megolm session keys without a full redeploy (set the
			// secret, then POST here to flush the cache). cachedCurve25519
			// is keyed on the OlmVault identity which can change after a
			// vault reset, so flush that too.
			this.cachedKeys = undefined;
			this.cachedCurve25519 = undefined;
			return Response.json({ ok: true, message: "in-memory key caches cleared" });
		}
		if (req.method === "POST" && url.pathname === "/stop") {
			await this.state.storage.deleteAlarm();
			return new Response("ok");
		}
		if (req.method === "POST" && url.pathname === "/recover-room") {
			// Out-of-band E2EE recovery: take a batch of encrypted events
			// (pulled by the /admin endpoint via /rooms/{id}/messages) and
			// run them through tryDecrypt. Events with unknown sessions
			// queue + trigger a key-request via the normal path; events
			// that decrypt are dispatched immediately if mention rules pass.
			const body = (await req.json()) as {
				roomId: string;
				events: {
					type?: string;
					event_id?: string;
					sender?: string;
					origin_server_ts?: number;
					content?: { algorithm?: string; ciphertext?: string; session_id?: string; sender_key?: string };
				}[];
			};
			const megolmKeys = this.megolmKeys();
			let queued = 0;
			let dispatched = 0;
			let skipped = 0;
			let triedDecrypt = 0;
			const sessionsRequested = new Set<string>();
			for (const ev of body.events ?? []) {
				if (ev.type !== "m.room.encrypted" || !ev.event_id || !ev.sender) {
					skipped += 1;
					continue;
				}
				const algorithm = ev.content?.algorithm;
				const sessionId = ev.content?.session_id;
				const ciphertext = ev.content?.ciphertext;
				const senderKey = ev.content?.sender_key;
				if (algorithm !== "m.megolm.v1.aes-sha2" || !sessionId || !ciphertext) {
					skipped += 1;
					continue;
				}
				if (!senderKey) {
					// Audit follow-up: missing outer sender_key means our
					// m.room_key_request can only route to `<user>:*` and
					// the originating device may not pick it up. Surface so
					// the operator can spot bridges that strip sender_key.
					console.log(
						`[recover-room] WARN missing sender_key ev=${ev.event_id} room=${body.roomId} session=${sessionId.slice(0, 16)}…`,
					);
				}
				triedDecrypt += 1;
				const sessionKey = await this.findKey(body.roomId, sessionId, megolmKeys);
				if (!sessionKey) {
					// Queue + emit room_key_request (one per session)
					await this.queuePendingDecrypt(body.roomId, sessionId, {
						event_id: ev.event_id,
						sender: ev.sender,
						content: { ciphertext, sender_key: senderKey ?? "" },
						origin_server_ts: ev.origin_server_ts ?? Date.now(),
					});
					if (!sessionsRequested.has(sessionId)) {
						sessionsRequested.add(sessionId);
						await this.maybeSendKeyRequest(body.roomId, sessionId, ev.sender, senderKey);
					}
					queued += 1;
					continue;
				}
				try {
					const { plaintext } = await decryptMegolm(sessionKey, ciphertext);
					const inner = JSON.parse(plaintext) as {
						type?: string;
						content?: Record<string, unknown>;
					};
					const innerMsgtype = inner.content?.msgtype as string | undefined;
					const innerBody = inner.content?.body as string | undefined;
					if (inner.type !== "m.room.message" || innerMsgtype !== "m.text" || !innerBody) {
						skipped += 1;
						continue;
					}
					// Audit finding #8: shouldHandleMessage reads m.mentions
					// + formatted_body from content. The OUTER ev.content is
					// the encrypted wrapper (algorithm/ciphertext/session_id),
					// so passing it here means mention detection never sees
					// the decrypted mention list. Pass the DECRYPTED inner
					// content so multi-user encrypted rooms apply mention
					// gates correctly.
					const synthetic = { content: inner.content ?? {} };
					const shouldDispatch = await this.shouldHandleMessage(body.roomId, synthetic, ev.sender);
					if (!shouldDispatch) {
						skipped += 1;
						continue;
					}
					await this.dispatchMessage(body.roomId, ev.event_id, innerBody);
					dispatched += 1;
				} catch (e) {
					console.log(`[recover-room] decrypt fail: ${e instanceof Error ? e.message : e}`);
					skipped += 1;
				}
			}
			return Response.json({
				ok: true,
				queued,
				dispatched,
				skipped,
				triedDecrypt,
				sessionsRequested: sessionsRequested.size,
			});
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
		// Schedule the safety-net alarm BEFORE doing the work. If
		// alarmInner hangs, throws past the catch, or the DO instance is
		// killed mid-execution by CF Workers, the next alarm is already
		// armed and the chain self-heals on its own — without depending
		// on the cron-driven `/start` fallback (which can also fail). The
		// safety-net fires at SYNC_TIMEOUT_MS + ALARM_INTERVAL_MS out;
		// the post-body setAlarm below replaces it with the normal
		// fast-tick when alarmInner returns successfully.
		await this.state.storage.setAlarm(Date.now() + SYNC_TIMEOUT_MS + ALARM_INTERVAL_MS);
		try {
			await this.alarmInner();
		} catch (e) {
			console.error("[listener] alarm threw", e instanceof Error ? e.message : String(e));
		}
		// Audit follow-up: periodic prune of pending-decrypt:* queues.
		// Run at most every PRUNE_INTERVAL_MS so we don't burn DO storage
		// budget on every 1s alarm tick. Drops queue entries whose
		// origin_server_ts is more than PENDING_TTL_MS old AND deletes
		// the whole queue if it ends up empty after pruning. Bounds
		// long-term storage growth from sessions that were never sent
		// (sender device went offline before forwarding the key).
		try {
			await this.maybePruneStaleDecryptQueues();
		} catch (e) {
			console.error("[listener] prune threw", e instanceof Error ? e.message : String(e));
		}
		await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
	}

	private async maybePruneStaleDecryptQueues(): Promise<void> {
		const PRUNE_INTERVAL_MS = 30 * 60 * 1000; // every 30 min
		const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
		// seen:* keys only need to survive Matrix's re-delivery window,
		// which is bounded by /sync's since-token behavior. 1h is generous.
		const SEEN_TTL_MS = 60 * 60 * 1000;
		const lastRun = (await this.state.storage.get<number>("last-prune-at")) ?? 0;
		const now = Date.now();
		if (now - lastRun < PRUNE_INTERVAL_MS) return;
		await this.state.storage.put("last-prune-at", now);
		const cutoff = now - PENDING_TTL_MS;
		const all = await this.state.storage.list({ prefix: "pending-decrypt:" });
		let pruned = 0;
		let emptied = 0;
		for (const [key, value] of all) {
			const list = value as Array<{ origin_server_ts?: number }> | undefined;
			if (!Array.isArray(list)) continue;
			const kept = list.filter((e) => (e.origin_server_ts ?? 0) >= cutoff);
			if (kept.length === 0) {
				await this.state.storage.delete(key);
				emptied += 1;
				pruned += list.length;
			} else if (kept.length < list.length) {
				await this.state.storage.put(key, kept);
				pruned += list.length - kept.length;
			}
		}
		if (pruned > 0) {
			console.log(`[listener] prune: dropped ${pruned} stale pending-decrypt entries (${emptied} queues emptied)`);
		}
		// Prune seen:* dedup markers older than SEEN_TTL_MS.
		const seenList = await this.state.storage.list({ prefix: "seen:" });
		const seenCutoff = now - SEEN_TTL_MS;
		let seenPruned = 0;
		for (const [key, value] of seenList) {
			const ts = typeof value === "number" ? value : 0;
			if (ts < seenCutoff) {
				await this.state.storage.delete(key);
				seenPruned += 1;
			}
		}
		if (seenPruned > 0) {
			console.log(`[listener] prune: dropped ${seenPruned} stale seen:* entries`);
		}
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
				const j = (await r.json()) as {
					ok?: boolean;
					captured?: boolean;
					capturedRoomId?: string;
					capturedSessionId?: string;
					capturedSource?: "live" | "forwarded";
				};
				console.log(
					`[listener] to_device sender=${senderKey.slice(0, 12)}… type=${entry.type} ok=${j.ok} captured=${j.captured} src=${j.capturedSource ?? "n/a"}`,
				);
				// Audit follow-up: m.forwarded_room_key validation. We only
				// accept forwarded Megolm keys for (room, session) pairs we
				// previously asked about via our own m.room_key_request.
				// Without this, any Olm-paired sender could plant arbitrary
				// Megolm keys for arbitrary rooms by emitting an unsolicited
				// m.forwarded_room_key — and the vault would store it
				// without checking. m.room_key (the initial share) is
				// passed through unchanged because that's how legitimate
				// senders bootstrap a new outbound session.
				if (j.captured && j.capturedRoomId && j.capturedSessionId) {
					if (j.capturedSource === "forwarded") {
						const wasRequested = await this.wasKeyRequested(
							j.capturedRoomId,
							j.capturedSessionId,
						);
						if (!wasRequested) {
							console.log(
								`[listener] UNSOLICITED forwarded_room_key — evicting room=${j.capturedRoomId} session=${j.capturedSessionId.slice(0, 16)}…`,
							);
							const evict = this.env.OLM_VAULT.get(
								this.env.OLM_VAULT.idFromName("global"),
							);
							await evict
								.fetch("https://vault/keystore-delete", {
									method: "POST",
									headers: { "Content-Type": "application/json" },
									body: JSON.stringify({
										roomId: j.capturedRoomId,
										sessionId: j.capturedSessionId,
										reason: "no outstanding m.room_key_request",
									}),
								})
								.catch(() => {});
							continue;
						}
					}
					// E2EE auto-recovery: when the vault captures a Megolm
					// session key (either initial m.room_key or our requested
					// m.forwarded_room_key response), walk the pending-decrypt
					// queue for that (room, session) and dispatch any
					// previously-stuck user messages.
					await this.drainPendingForSession(j.capturedRoomId, j.capturedSessionId);
				}
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
		const dispatches: Promise<void>[] = [];
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
				// Phase 1 voice: capture the audio content block so the m.audio
				// branch below can fetch + decrypt + transcribe. Same shape
				// for plain and decrypted-megolm events.
				let audioContent: Record<string, unknown> | undefined;
				// Content that drives the mention gate / wake-word check.
				// For plain m.room.message: ev.content (has body + m.mentions).
				// For E2EE: the DECRYPTED inner content (outer wrapper has
				// only the megolm ciphertext). For voice: synthetic with the
				// transcript as body. Centralizing here so the dispatch gate
				// downstream doesn't have to branch on encryption / voice.
				let mentionContent: Record<string, unknown> = ev.content ?? {};

				if (ev.type === "m.room.message") {
					const content = ev.content ?? {};
					// Skip m.replace edits. When a user edits a prior message
					// the homeserver emits a fresh m.room.message whose body
					// is the fallback `* <new content>` string and whose
					// m.relates_to.rel_type === "m.replace". Treating this
					// like a new prompt would spawn a turn whose body starts
					// with `* ` and waste credits. The user's intent was to
					// amend, not re-ask. Future enhancement: cancel the
					// in-flight turn + relaunch with the edited content.
					const rel = (content as { "m.relates_to"?: { rel_type?: string } })["m.relates_to"];
					if (rel?.rel_type === "m.replace") continue;
					msgtype = content.msgtype as string | undefined;
					body = content.body as string | undefined;
					if (msgtype === "m.audio") audioContent = content;
					mentionContent = content;
				} else if (ev.type === "m.room.encrypted") {
					// E2EE event — try to decrypt using imported Megolm keys.
					const decrypted = await this.tryDecrypt(roomId, ev, megolmKeys);
					if (!decrypted) continue;
					msgtype = decrypted.msgtype;
					body = decrypted.body;
					if (decrypted.msgtype === "m.audio") audioContent = decrypted.content;
					// Mention / wake-word gate must see the DECRYPTED content —
					// the outer ev.content carries only megolm ciphertext.
					mentionContent = decrypted.content;
				} else {
					continue;
				}

				// Voice-message branch — Phase 1 inbound. Detect MSC3245
				// voice marker, download + decrypt the audio, transcribe
				// via Whisper, swap body in place so the rest of the
				// dispatch flow proceeds with the transcript as if the
				// user had typed it.
				let cameFromVoice = false;
				if (msgtype === "m.audio" && audioContent && this.isVoiceMessage(audioContent)) {
					const transcribed = await this.transcribeVoiceContent(roomId, audioContent);
					if (!transcribed) {
						console.log(`[listener] voice transcribe skipped/failed for room=${roomId} ev=${ev.event_id}`);
						continue;
					}
					body = transcribed;
					msgtype = "m.text";
					cameFromVoice = true;
					// Mention/wake-word gate runs against the TRANSCRIPT so a
					// voice "Jada do X" in a group hits the wake-word path
					// just like a typed "Jada do X". Without this, voice
					// messages in groups were always being dropped because
					// the encrypted audio content has no body/m.mentions.
					mentionContent = { msgtype: "m.text", body };
				}

				if (msgtype !== "m.text" || !body) continue;

				// Commands always run regardless of room size or mention.
				const trimmed = body.trim();
				if (trimmed.startsWith("!cancel")) {
					await this.handleCancel(roomId);
					continue;
				}
				if (trimmed.startsWith("!model")) {
					await this.handleModelCommand(roomId, ev.event_id, trimmed);
					continue;
				}

				// Gate auto-dispatch on room size + mention. In a 2-person
				// room (you + me), every message is for me. In a larger room
				// the bot should stay quiet unless it's been mentioned.
				const shouldDispatch = await this.shouldHandleMessage(roomId, { content: mentionContent }, ev.sender);
				if (!shouldDispatch) continue;

				// Mirror mode: if the user's prompt was a voice message, the
				// bot's reply ships as voice too. Phase 2 outbound TTS.
				dispatches.push(
					this.dispatchMessage(roomId, ev.event_id, body, { replyAsVoice: cameFromVoice }),
				);
			}
		}
		if (dispatches.length > 0) {
			await Promise.allSettled(dispatches);
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
		ev: { content?: Record<string, unknown>; event_id?: string; sender?: string; origin_server_ts?: number },
		keys: MegolmSessionKey[],
	): Promise<{ msgtype: string; body: string; content: Record<string, unknown> } | undefined> {
		const content = ev.content ?? {};
		if (content.algorithm !== "m.megolm.v1.aes-sha2") return undefined;
		const sessionId = content.session_id as string | undefined;
		const ciphertext = content.ciphertext as string | undefined;
		const senderKey = content.sender_key as string | undefined;
		if (!sessionId || !ciphertext) return undefined;
		const sessionKey = await this.findKey(roomId, sessionId, keys);
		if (!sessionKey) {
			console.log(`[listener] no key for room=${roomId} session=${sessionId.slice(0, 16)}…`);
			// E2EE auto-recovery: queue this event for later retry, then
			// emit an m.room_key_request to the sender's other devices so
			// they forward us the missing Megolm session key. Best-effort —
			// failures don't block other event processing.
			if (ev.event_id && ev.sender) {
				await this.queuePendingDecrypt(roomId, sessionId, {
					event_id: ev.event_id,
					sender: ev.sender,
					content: { ciphertext, sender_key: senderKey ?? "" },
					origin_server_ts: ev.origin_server_ts ?? Date.now(),
				});
				await this.maybeSendKeyRequest(roomId, sessionId, ev.sender, senderKey);
			}
			return undefined;
		}
		try {
			const { plaintext } = await decryptMegolm(sessionKey, ciphertext);
			const inner = JSON.parse(plaintext) as {
				type?: string;
				content?: Record<string, unknown>;
			};
			if (inner.type !== "m.room.message") return undefined;
			const innerContent = (inner.content ?? {}) as Record<string, unknown>;
			// Skip m.replace edits in the encrypted path too — see the
			// matching check in the unencrypted branch above.
			const innerRel = innerContent["m.relates_to"] as { rel_type?: string } | undefined;
			if (innerRel?.rel_type === "m.replace") return undefined;
			return {
				msgtype: (innerContent.msgtype as string | undefined) ?? "",
				body: (innerContent.body as string | undefined) ?? "",
				content: innerContent,
			};
		} catch (e) {
			console.log(`[listener] decrypt fail ev=${ev.event_id}: ${e instanceof Error ? e.message : e}`);
			return undefined;
		}
	}

	/**
	 * Queue an undecryptable encrypted event so we can retry once the
	 * matching Megolm session key arrives. Stored in DO storage as
	 * `pending-decrypt:{room}:{session}` → array. Cleaned up on retry or
	 * by stale-entry pruning.
	 */
	private async queuePendingDecrypt(
		roomId: string,
		sessionId: string,
		entry: {
			event_id: string;
			sender: string;
			content: { ciphertext: string; sender_key: string };
			origin_server_ts: number;
		},
	): Promise<void> {
		const key = `pending-decrypt:${roomId}:${sessionId}`;
		const list = (await this.state.storage.get<typeof entry[]>(key)) ?? [];
		if (list.find((e) => e.event_id === entry.event_id)) return;
		// Bound the queue per session — pathological case (1000 messages
		// before key arrives) would otherwise eat DO storage.
		if (list.length >= 50) list.shift();
		list.push(entry);
		await this.state.storage.put(key, list);
	}

	/**
	 * Send an `m.room_key_request` to-device event addressed to the
	 * sender's other devices (`<user_id>:*`), asking them to forward us
	 * the Megolm session key for the given room/session. Dedup'd by
	 * `(room, session)` within a 5-minute window to avoid spamming.
	 *
	 * The sender's clients will see this as a key share request from a
	 * known-but-unverified device — if they recognize the device id /
	 * curve25519 they forward; otherwise they may prompt or silently
	 * ignore. Either way the bridge stops being a black hole when keys
	 * rotate past our share window.
	 */
	private async maybeSendKeyRequest(
		roomId: string,
		sessionId: string,
		sender: string,
		senderKey: string | undefined,
	): Promise<void> {
		// Audit finding #2: dedup window is 5 minutes, but the prior
		// implementation stored `key-request:{room}:{session}` → ts which
		// accumulated unbounded over time as Megolm sessions rotate (the
		// dedupKey was never deleted). Bucket the key by 5-minute window
		// so a stale bucket is naturally abandoned and a piggy-back
		// cleanup keeps storage bounded.
		const now = Date.now();
		const BUCKET_MS = 5 * 60 * 1000;
		const bucket = Math.floor(now / BUCKET_MS);
		const dedupKey = `key-request:${roomId}:${sessionId}:${bucket}`;
		const seen = await this.state.storage.get<number>(dedupKey);
		if (seen) return; // already requested in the current 5-min bucket
		await this.state.storage.put(dedupKey, now);
		// Piggy-back cleanup: walk key-request:* prefix and delete any
		// entry whose bucket is more than 2 buckets old. Bounded work
		// because the prefix is small per DO.
		try {
			const prior = await this.state.storage.list({ prefix: "key-request:" });
			for (const k of prior.keys()) {
				const parts = k.split(":");
				const b = parseInt(parts[parts.length - 1] ?? "0", 10);
				if (b > 0 && bucket - b > 2) await this.state.storage.delete(k);
			}
		} catch { /* best-effort */ }

		const requestId = `kr-${now}-${Math.random().toString(36).slice(2, 10)}`;
		const ourDeviceId = this.env.MATRIX_DEVICE_ID ?? "Ww3fWv0z7s";
		const body = {
			messages: {
				[sender]: {
					"*": {
						action: "request",
						body: {
							algorithm: "m.megolm.v1.aes-sha2",
							room_id: roomId,
							sender_key: senderKey ?? "",
							session_id: sessionId,
						},
						request_id: requestId,
						requesting_device_id: ourDeviceId,
					},
				},
			},
		};
		const txnId = `kreq-${now}-${Math.random().toString(36).slice(2, 8)}`;
		const url = `${this.env.MATRIX_HOMESERVER}/_matrix/client/v3/sendToDevice/m.room_key_request/${encodeURIComponent(txnId)}`;
		try {
			const r = await fetch(url, {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${this.env.MATRIX_ACCESS_TOKEN}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			});
			console.log(
				`[listener] room_key_request room=${roomId} session=${sessionId.slice(0, 16)}… sender=${sender} status=${r.status}`,
			);
		} catch (e) {
			console.log(`[listener] room_key_request failed: ${e instanceof Error ? e.message : e}`);
		}
	}

	/**
	 * Audit follow-up: check whether we previously emitted an
	 * m.room_key_request for this (room, session). Used to gate the
	 * acceptance of m.forwarded_room_key — if we never asked, the
	 * forwarded key is unsolicited and may be an attacker trying to
	 * plant a Megolm key. The key-request:* prefix is owned by
	 * maybeSendKeyRequest and is bucketed by 5-min windows, so we just
	 * check if any bucket exists for the (room, session) pair.
	 */
	private async wasKeyRequested(roomId: string, sessionId: string): Promise<boolean> {
		const prefix = `key-request:${roomId}:${sessionId}:`;
		const list = await this.state.storage.list({ prefix, limit: 1 });
		return list.size > 0;
	}

	/**
	 * Called when the olm-vault decrypts a to-device event and captures
	 * a Megolm session key. Walks the pending-decrypt queue for that
	 * (room, session) and dispatches each previously-stuck user message.
	 * The actual decryption happens on the next /sync tick when the
	 * timeline-event loop re-reads `pending-decrypt` and processes them.
	 *
	 * For now: just dispatch any queued messages by re-running tryDecrypt
	 * on each, which will now succeed because the key is in the vault.
	 */
	private async drainPendingForSession(
		roomId: string,
		sessionId: string,
	): Promise<void> {
		const key = `pending-decrypt:${roomId}:${sessionId}`;
		const list = await this.state.storage.get<{
			event_id: string;
			sender: string;
			content: { ciphertext: string; sender_key: string };
			origin_server_ts: number;
		}[]>(key);
		if (!list || list.length === 0) return;
		console.log(`[listener] draining ${list.length} pending decrypts for ${roomId} session=${sessionId.slice(0, 16)}…`);
		const megolmKeys = this.megolmKeys();
		for (const queued of list) {
			const synthetic = {
				event_id: queued.event_id,
				sender: queued.sender,
				origin_server_ts: queued.origin_server_ts,
				content: {
					algorithm: "m.megolm.v1.aes-sha2",
					session_id: sessionId,
					ciphertext: queued.content.ciphertext,
					sender_key: queued.content.sender_key,
				},
			};
			const decrypted = await this.tryDecrypt(roomId, synthetic, megolmKeys);
			if (!decrypted) {
				console.log(`[listener] drain: still can't decrypt ev=${queued.event_id} — leaving in queue`);
				continue;
			}
			if (decrypted.msgtype !== "m.text" || !decrypted.body) continue;
			const shouldDispatch = await this.shouldHandleMessage(roomId, { content: decrypted.content }, queued.sender);
			if (!shouldDispatch) continue;
			await this.dispatchMessage(roomId, queued.event_id, decrypted.body);
		}
		await this.state.storage.delete(key);
	}

	// Returns true if the bot should respond. In a 2-person room every
	// message is for the bot. In a larger room we require an explicit
	// mention via `m.mentions.user_ids` (preferred per Matrix spec) or
	// a matrix.to link in the formatted_body. This prevents the bot from
	// chiming in on every random message once you add it to group chats.
	private async shouldHandleMessage(
		roomId: string,
		ev: { content?: Record<string, unknown> },
		sender?: string,
	): Promise<boolean> {
		const memberCount = await this.cachedRoomMemberCount(roomId);
		if (memberCount <= 2) return true;
		const content = ev.content ?? {};
		const mentions = (content["m.mentions"] as { user_ids?: string[] } | undefined)?.user_ids;
		if (Array.isArray(mentions) && mentions.includes(this.env.MATRIX_USER_ID)) return true;
		const fmt = content.formatted_body as string | undefined;
		if (fmt && (fmt.includes(this.env.MATRIX_USER_ID) || fmt.includes(`/${this.env.MATRIX_USER_ID}`))) return true;
		// Plain-text wake-word fallback for clients that don't attach
		// m.mentions metadata (Beeper Desktop, most mobile clients): if
		// the body begins with the bot's display name, treat it as an
		// explicit address. See isPlainTextWakeWord for match rules.
		const body = (content.body as string | undefined) ?? "";
		const displayName = this.env.MATRIX_DISPLAY_NAME ?? "Jada";
		if (isPlainTextWakeWord(body, displayName)) return true;
		if (sender && await this.isAllowedBotRoomSender(roomId, sender, memberCount)) return true;
		return false;
	}

	private async isAllowedBotRoomSender(
		roomId: string,
		sender: string,
		memberCount: number,
	): Promise<boolean> {
		const allowed = await this.cachedAllowedSenders(roomId);
		if (allowed.includes(sender)) return true;
		if (memberCount > 4 || !this.isOwnerSender(sender)) return false;
		const roomName = await this.cachedRoomName(roomId);
		return /\b(manager|bot|jada|langbot|bridge|replicas)\b/i.test(roomName);
	}

	private isOwnerSender(sender: string): boolean {
		return sender === "@jadengarza:beeper.com" || sender === "@jadengarza:matrix.org";
	}

	private async cachedAllowedSenders(roomId: string): Promise<string[]> {
		const cacheKey = `allowed-senders:${roomId}`;
		const cached = await this.env.MAP.get(cacheKey);
		if (cached) {
			try {
				const parsed = JSON.parse(cached);
				if (Array.isArray(parsed)) return parsed.filter((v) => typeof v === "string");
			} catch {}
		}
		try {
			const url = `${this.env.MATRIX_HOMESERVER}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/dev.garza.agent.config/`;
			const r = await fetch(url, {
				headers: { Authorization: `Bearer ${this.env.MATRIX_ACCESS_TOKEN}` },
			});
			if (!r.ok) {
				await this.env.MAP.put(cacheKey, "[]", { expirationTtl: 3600 });
				return [];
			}
			const j = (await r.json()) as { allowed_senders?: unknown[] };
			const allowed = (j.allowed_senders ?? []).filter((v): v is string => typeof v === "string");
			await this.env.MAP.put(cacheKey, JSON.stringify(allowed), { expirationTtl: 3600 });
			return allowed;
		} catch {
			return [];
		}
	}

	private async cachedRoomName(roomId: string): Promise<string> {
		const cacheKey = `room-name:${roomId}`;
		const cached = await this.env.MAP.get(cacheKey);
		if (cached) return cached;
		try {
			const url = `${this.env.MATRIX_HOMESERVER}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.name/`;
			const r = await fetch(url, {
				headers: { Authorization: `Bearer ${this.env.MATRIX_ACCESS_TOKEN}` },
			});
			if (!r.ok) return "";
			const j = (await r.json()) as { name?: string };
			const name = typeof j.name === "string" ? j.name : "";
			if (name) await this.env.MAP.put(cacheKey, name, { expirationTtl: 3600 });
			return name;
		} catch {
			return "";
		}
	}

	private async cachedRoomMemberCount(roomId: string): Promise<number> {
		const cacheKey = `members:${roomId}`;
		const cached = await this.env.MAP.get(cacheKey);
		if (cached) {
			const n = parseInt(cached, 10);
			if (Number.isFinite(n)) return n;
		}
		try {
			const url = `${this.env.MATRIX_HOMESERVER}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/joined_members`;
			const r = await fetch(url, {
				headers: { Authorization: `Bearer ${this.env.MATRIX_ACCESS_TOKEN}` },
			});
			if (!r.ok) {
				// Fail CLOSED on cold-cache lookup failure. Prior fail-open
				// (return 2) treated unknown rooms as DMs, so a transient 401
				// or rate-limit during the first message in a 50-person
				// channel caused the bot to dispatch on every message until
				// the next successful lookup — empirically observed as
				// "bot exploded into a group chat" complaints. Returning a
				// large sentinel keeps it quiet until mention rules pass or
				// the count is genuinely known.
				console.log(`[listener] joined_members ${r.status} for ${roomId} — fail-closed`);
				return 100;
			}
			const j = (await r.json()) as { joined?: Record<string, unknown> };
			const n = Object.keys(j.joined ?? {}).length;
			await this.env.MAP.put(cacheKey, String(n), { expirationTtl: 3600 });
			return n;
		} catch (e) {
			console.log(`[listener] joined_members threw for ${roomId}: ${e instanceof Error ? e.message : e} — fail-closed`);
			return 100;
		}
	}

	// `!model` chat command. `!model` alone prints current + options;
	// `!model <name>` sets a per-room override stored in KV. Dispatch reads
	// this on spawn, so the next turn uses the new model.
	private async handleModelCommand(roomId: string, eventId: string, body: string): Promise<void> {
		const rest = body.slice("!model".length).trim();
		const cacheKey = `model:${roomId}`;
		if (!rest) {
			const current = (await this.env.MAP.get(cacheKey)) ?? this.env.REPLICAS_MODEL_OVERRIDE ?? "claude-sonnet-4-6";
			const html = [
				`<b>Current model:</b> <code>${escapeHtml(current)}</code>`,
				`<i>Set with <code>!model sonnet</code>, <code>!model opus</code>, <code>!model haiku</code>, or a full id like <code>!model claude-opus-4-7</code>.</i>`,
			].join("<br><br>");
			await sendMessage(matrixEnv(this.env), roomId, html, { replyTo: eventId });
			return;
		}
		const resolved = resolveModelAlias(rest);
		await this.env.MAP.put(cacheKey, resolved, { expirationTtl: 60 * 60 * 24 * 365 });
		const html = `<b>Model for this room set to</b> <code>${escapeHtml(resolved)}</code><br><i>Next turn will use it.</i>`;
		await sendMessage(matrixEnv(this.env), roomId, html, { replyTo: eventId });
	}

	// Phase 1 voice — MSC3245 voice marker detection. A regular shared
	// audio file (song / non-voice attachment) lacks `org.matrix.msc3245.voice`
	// and is intentionally skipped here so the bot doesn't transcribe every
	// random m.audio someone shares.
	private isVoiceMessage(content: Record<string, unknown>): boolean {
		return content["org.matrix.msc3245.voice"] !== undefined;
	}

	// Phase 1 voice — download + decrypt + transcribe a voice attachment,
	// returning the dispatch-ready text (`🎤 (voice 4s) <transcript>`).
	// Returns undefined to signal "skip dispatch for this event" — when
	// audio fetch fails, Whisper key is missing, or transcript is empty.
	private async transcribeVoiceContent(
		roomId: string,
		content: Record<string, unknown>,
	): Promise<string | undefined> {
		if (!this.env.OPENAI_API_KEY) {
			console.log(`[listener] voice msg in room=${roomId} but OPENAI_API_KEY not set — skipping`);
			return undefined;
		}
		const info = content.info as { duration?: number; mimetype?: string; size?: number } | undefined;
		const durationMs = info?.duration ?? 0;
		const declaredMime = info?.mimetype ?? "audio/ogg";

		// Cost guardrail: rate-limit Whisper transcribes to avoid an
		// adversarial / runaway sender burning OpenAI credits. We track
		// a rolling window of transcription seconds per room across the
		// last 60 minutes; if total > VOICE_MINUTES_PER_HOUR_CAP, skip
		// new voice messages and log. Caller falls through to "voice
		// skipped" UX (same as no-API-key path).
		const VOICE_MINUTES_PER_HOUR_CAP = 30;
		const WINDOW_MS = 60 * 60 * 1000;
		const ledgerKey = `voice-budget:${roomId}`;
		const now = Date.now();
		const ledger =
			(await this.state.storage.get<{ ts: number; sec: number }[]>(ledgerKey)) ?? [];
		const fresh = ledger.filter((e) => now - e.ts < WINDOW_MS);
		const totalSec = fresh.reduce((acc, e) => acc + e.sec, 0);
		const proposedSec = Math.max(0, Math.round(durationMs / 1000));
		if (totalSec + proposedSec > VOICE_MINUTES_PER_HOUR_CAP * 60) {
			console.log(
				`[listener] voice budget exhausted room=${roomId} usedSec=${totalSec} thisSec=${proposedSec} cap=${VOICE_MINUTES_PER_HOUR_CAP * 60} — skipping`,
			);
			return undefined;
		}

		const audio = await fetchVoiceAudio(matrixEnv(this.env), {
			url: content.url as string | undefined,
			file: content.file as EncryptedFile | undefined,
		});
		if (!audio) {
			console.log(`[listener] voice fetch failed room=${roomId}`);
			return undefined;
		}

		// Whisper supports OGG/Opus, MP3, WAV, M4A, WebM, FLAC. Beeper voice
		// is OGG/Opus; pass the declared mimetype through (decrypted path
		// uses the outer content.info.mimetype since the EncryptedFile
		// block doesn't carry one).
		const filename = `voice-${Date.now()}.ogg`;
		const mimetype = audio.mimetype && audio.mimetype !== "application/octet-stream"
			? audio.mimetype
			: declaredMime;

		const result = await transcribeAudio(
			{ OPENAI_API_KEY: this.env.OPENAI_API_KEY },
			audio.body,
			filename,
			mimetype,
		);
		if (!result.ok) {
			console.log(`[listener] whisper failed room=${roomId}: ${result.error}`);
			return undefined;
		}

		const durLabel = formatVoiceDuration(durationMs);
		const transcript = result.text.trim();
		console.log(
			`[listener] voice transcribed room=${roomId} duration=${durLabel} text=${JSON.stringify(transcript.slice(0, 80))}`,
		);
		// Persist the consumed seconds in the budget ledger so subsequent
		// voice messages in this room debit against the same window.
		fresh.push({ ts: now, sec: proposedSec });
		await this.state.storage.put(ledgerKey, fresh);
		return `🎤 (voice ${durLabel}) ${transcript}`;
	}

	private async dispatchMessage(
		roomId: string,
		eventId: string,
		body: string,
		opts: { replyAsVoice?: boolean } = {},
	): Promise<void> {
		// In-process call so we don't pay an extra Worker round-trip.
		try {
			await handleMatrixMessage(this.env, roomId, eventId, body, opts);
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
