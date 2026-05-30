// OlmVault — single global Durable Object holding the bot device's Olm
// Account (long-term curve25519 + ed25519 identity, one-time keys) and
// the captured Megolm inbound session keys received via /sendToDevice.
//
// We use this from the listener's /sync path: every encrypted
// to-device event lands here, gets decrypted via Olm 1:1, the inner
// m.room_key event is parsed, and the new Megolm session_key is
// appended to a per-room map. The poller/listener consult that map
// alongside the static MATRIX_MEGOLM_KEYS_JSON import — so future
// Megolm rotations decrypt automatically without manual re-export.

import type { Env } from "./index";
import { getOlm } from "./olm-init";
import { decodeRecoveryKey, decryptSecret, verifyRecoveryKey } from "./ssss";

// Storage keys
const K_ACCOUNT_PICKLE = "olm:account";
const K_SESSIONS = "olm:sessions"; // map: curve25519 → array of pickled sessions
const K_DEVICE_UPLOADED = "olm:device_uploaded"; // boolean once /keys/upload succeeded
const K_KEYSTORE = "olm:keystore"; // map: roomId → array of {session_id, session_key, sender_key}

// Pickle passphrase: derived from the access token + device id so it's stable
// across restarts but tied to this specific bot device. Not user-visible.
function pickleKey(env: Env): string {
	return `${env.MATRIX_USER_ID}::${env.MATRIX_ACCESS_TOKEN.slice(-12)}`;
}

interface DeviceKeyUpload {
	user_id: string;
	device_id: string;
	algorithms: string[];
	keys: Record<string, string>;
	signatures: Record<string, Record<string, string>>;
}

interface MegolmKeyEntry {
	session_id: string;
	session_key: string;
	sender_key: string;
	source: "import" | "live" | "forwarded";
}

export class OlmVault {
	private state: DurableObjectState;
	private env: Env;

	constructor(state: DurableObjectState, env: Env) {
		this.state = state;
		this.env = env;
	}

	async fetch(req: Request): Promise<Response> {
		const url = new URL(req.url);
		try {
			if (req.method === "POST" && url.pathname === "/reset") {
				await this.state.storage.deleteAll();
				return Response.json({ ok: true });
			}
			if (req.method === "POST" && url.pathname === "/cross-sign") return await this.crossSign();
			if (req.method === "POST" && url.pathname === "/bootstrap") return await this.bootstrap();
			if (req.method === "GET" && url.pathname === "/identity") return await this.identity();
			if (req.method === "POST" && url.pathname === "/upload-device") return await this.uploadDevice();
			if (req.method === "POST" && url.pathname === "/upload-otks") {
				const body = (await req.json()) as { count?: number };
				return await this.uploadOtks(body.count ?? 50);
			}
			if (req.method === "POST" && url.pathname === "/decrypt-todevice") {
				const body = (await req.json()) as { senderCurve25519: string; ciphertext: { type: 0 | 1; body: string } };
				return await this.decryptToDevice(body.senderCurve25519, body.ciphertext);
			}
			if (req.method === "GET" && url.pathname === "/keystore") {
				const ks = (await this.state.storage.get<Record<string, MegolmKeyEntry[]>>(K_KEYSTORE)) ?? {};
				const counts: Record<string, number> = {};
				for (const room of Object.keys(ks)) counts[room] = ks[room]!.length;
				return Response.json({ rooms: counts });
			}
			if (req.method === "GET" && url.pathname === "/lookup") {
				const roomId = url.searchParams.get("room") ?? "";
				const sessionId = url.searchParams.get("session") ?? "";
				const ks = (await this.state.storage.get<Record<string, MegolmKeyEntry[]>>(K_KEYSTORE)) ?? {};
				const list = ks[roomId] ?? [];
				const hit = list.find((e) => e.session_id === sessionId);
				return Response.json({ found: !!hit, session_key: hit?.session_key ?? null });
			}
			if (req.method === "POST" && url.pathname === "/usage-bump") {
				// Audit follow-up: per-org usage log was being read-modify-
				// written from the poller via KV, which loses concurrent
				// appends across rooms (last write wins). Routing through
				// this singleton DO with blockConcurrencyWhile makes the
				// append atomic. Storage shape kept identical so the
				// renderer's bucketing logic stays unchanged.
				const body = (await req.json()) as { ts: number; cost: number; tok: number };
				const CUTOFF_MS = 8 * 24 * 60 * 60 * 1000;
				let log: { ts: number; cost: number; tok: number }[] = [];
				await this.state.blockConcurrencyWhile(async () => {
					const prior = (await this.state.storage.get<typeof log>("usage:org")) ?? [];
					const cutoff = Date.now() - CUTOFF_MS;
					log = prior.filter((e) => e.ts >= cutoff);
					log.push({ ts: body.ts, cost: body.cost, tok: body.tok });
					await this.state.storage.put("usage:org", log);
				});
				return Response.json({ ok: true, entries: log.length });
			}
			if (req.method === "GET" && url.pathname === "/usage-read") {
				const log = (await this.state.storage.get<{ ts: number; cost: number; tok: number }[]>("usage:org")) ?? [];
				return Response.json({ log });
			}
			if (req.method === "POST" && url.pathname === "/keystore-delete") {
				// Used by the listener to evict a forwarded Megolm key that
				// failed the "did we actually request this?" check. Without
				// this, an Olm-paired sender could plant arbitrary Megolm
				// keys for any room. With it, forwarded keys are restricted
				// to (room, session) pairs we previously asked about.
				const body = (await req.json()) as { roomId: string; sessionId: string; reason?: string };
				const ks = (await this.state.storage.get<Record<string, MegolmKeyEntry[]>>(K_KEYSTORE)) ?? {};
				const list = ks[body.roomId] ?? [];
				const next = list.filter((e) => e.session_id !== body.sessionId);
				if (next.length === list.length) return Response.json({ ok: true, evicted: 0 });
				if (next.length === 0) delete ks[body.roomId];
				else ks[body.roomId] = next;
				await this.state.storage.put(K_KEYSTORE, ks);
				console.log(
					`[olm-vault] evicted unsolicited forwarded key room=${body.roomId} session=${body.sessionId.slice(0, 16)}… reason=${body.reason ?? "unspecified"}`,
				);
				return Response.json({ ok: true, evicted: list.length - next.length });
			}
			return new Response("not found", { status: 404 });
		} catch (e) {
			console.log(`[olm-vault] ${url.pathname} threw: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
			return Response.json(
				{ error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) },
				{ status: 500 },
			);
		}
	}

	// Load or create the Olm Account and return identity keys. First call
	// generates a fresh account and pickles it. Returned as `any` because
	// the @matrix-org/olm types target browsers (namespace export) and
	// fight TS in a UMD-flavoured Workers bundle.
	private async loadAccount(): Promise<{ olm: any; account: any }> {
		const Olm = (await getOlm()) as any;
		const account = new Olm.Account();
		const pickled = await this.state.storage.get<string>(K_ACCOUNT_PICKLE);
		if (pickled) {
			account.unpickle(pickleKey(this.env), pickled);
		} else {
			account.create();
			await this.state.storage.put(K_ACCOUNT_PICKLE, account.pickle(pickleKey(this.env)));
		}
		return { olm: Olm, account };
	}

	private async savePickle(account: any): Promise<void> {
		await this.state.storage.put(K_ACCOUNT_PICKLE, account.pickle(pickleKey(this.env)));
	}

	private async identity(): Promise<Response> {
		const { account } = await this.loadAccount();
		try {
			const ids = JSON.parse(account.identity_keys()) as { curve25519: string; ed25519: string };
			return Response.json({
				user_id: this.env.MATRIX_USER_ID,
				device_id: this.deviceId(),
				identity_keys: ids,
				uploaded: (await this.state.storage.get<boolean>(K_DEVICE_UPLOADED)) ?? false,
			});
		} finally {
			account.free();
		}
	}

	// Convenience full-bootstrap: ensure account, upload device keys + OTKs.
	private async bootstrap(): Promise<Response> {
		const idResp = await this.identity();
		const idJson = (await idResp.clone().json()) as { uploaded?: boolean };
		const steps: string[] = [];
		if (!idJson.uploaded) {
			const r = await this.uploadDevice();
			steps.push(`device_upload:${r.status}`);
		} else {
			steps.push("device_upload:already-done");
		}
		const r2 = await this.uploadOtks(50);
		steps.push(`otk_upload:${r2.status}`);
		return Response.json({ ok: true, steps });
	}

	private deviceId(): string {
		// We use the device the bot is logged into matrix.org as. Beeper-style
		// `syt_…` access tokens are bound to a specific `device_id`; we recover
		// it once via /whoami at runtime (cached in storage on first call).
		// For now we accept it as MATRIX_DEVICE_ID env var (set during bootstrap)
		// to avoid an extra HTTP round trip per Olm op.
		return this.env.MATRIX_DEVICE_ID ?? "BOTDEV";
	}

	private async uploadDevice(): Promise<Response> {
		const { account } = await this.loadAccount();
		try {
			const ids = JSON.parse(account.identity_keys()) as { curve25519: string; ed25519: string };
			const userId = this.env.MATRIX_USER_ID;
			const deviceId = this.deviceId();
			const unsigned: Omit<DeviceKeyUpload, "signatures"> = {
				user_id: userId,
				device_id: deviceId,
				algorithms: ["m.olm.v1.curve25519-aes-sha2", "m.megolm.v1.aes-sha2"],
				keys: {
					[`curve25519:${deviceId}`]: ids.curve25519,
					[`ed25519:${deviceId}`]: ids.ed25519,
				},
			};
			const sig = account.sign(canonicalJson(unsigned));
			const deviceKeys: DeviceKeyUpload = {
				...unsigned,
				signatures: { [userId]: { [`ed25519:${deviceId}`]: sig } },
			};
			const r = await fetch(`${this.env.MATRIX_HOMESERVER}/_matrix/client/v3/keys/upload`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.env.MATRIX_ACCESS_TOKEN}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ device_keys: deviceKeys }),
			});
			const body = await r.text();
			if (r.ok) await this.state.storage.put(K_DEVICE_UPLOADED, true);
			return new Response(body, { status: r.status, headers: { "Content-Type": "application/json" } });
		} finally {
			account.free();
		}
	}

	private async uploadOtks(count: number): Promise<Response> {
		const { account } = await this.loadAccount();
		try {
			const max = account.max_number_of_one_time_keys();
			const target = Math.min(count, Math.floor(max / 2));
			account.generate_one_time_keys(target);
			const all = JSON.parse(account.one_time_keys()) as { curve25519: Record<string, string> };
			const userId = this.env.MATRIX_USER_ID;
			const deviceId = this.deviceId();
			const oneTimeKeys: Record<string, { key: string; signatures: Record<string, Record<string, string>> }> = {};
			for (const [keyId, pub] of Object.entries(all.curve25519)) {
				const unsigned = { key: pub };
				const sig = account.sign(canonicalJson(unsigned));
				oneTimeKeys[`signed_curve25519:${keyId}`] = {
					key: pub,
					signatures: { [userId]: { [`ed25519:${deviceId}`]: sig } },
				};
			}
			const r = await fetch(`${this.env.MATRIX_HOMESERVER}/_matrix/client/v3/keys/upload`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.env.MATRIX_ACCESS_TOKEN}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ one_time_keys: oneTimeKeys }),
			});
			const body = await r.text();
			if (r.ok) {
				account.mark_keys_as_published();
				await this.savePickle(account);
			}
			return new Response(body, { status: r.status, headers: { "Content-Type": "application/json" } });
		} finally {
			account.free();
		}
	}

	// Decrypt SSSS-stored self-signing private key with MATRIX_RECOVERY_KEY,
	// then use it to sign our device's ed25519 key — making the device
	// cross-signed and trusted by every other client of the user (Element,
	// Beeper, etc). After this, mautrix bridges proactively share Megolm
	// keys with the bot device on every session rotation.
	private async crossSign(): Promise<Response> {
		const userId = this.env.MATRIX_USER_ID;
		const deviceId = this.deviceId();
		const recovery = this.env.MATRIX_RECOVERY_KEY;
		if (!recovery) return Response.json({ ok: false, error: "MATRIX_RECOVERY_KEY not set" }, { status: 400 });

		const homeserver = this.env.MATRIX_HOMESERVER.replace(/\/$/, "");
		const token = this.env.MATRIX_ACCESS_TOKEN;
		const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
		const ud = encodeURIComponent(userId);

		// 1. Default SSSS key id.
		const defR = await fetch(`${homeserver}/_matrix/client/v3/user/${ud}/account_data/m.secret_storage.default_key`, { headers: authHeaders });
		if (!defR.ok) return Response.json({ ok: false, stage: "default_key", status: defR.status, body: await defR.text() }, { status: 502 });
		const def = (await defR.json()) as { key?: string };
		if (!def.key) return Response.json({ ok: false, error: "no default_key in account_data" }, { status: 500 });

		// 2. SSSS key config.
		const cfgR = await fetch(`${homeserver}/_matrix/client/v3/user/${ud}/account_data/m.secret_storage.key.${encodeURIComponent(def.key)}`, { headers: authHeaders });
		if (!cfgR.ok) return Response.json({ ok: false, stage: "key_config", status: cfgR.status }, { status: 502 });
		const cfg = (await cfgR.json()) as { algorithm?: string; iv?: string; mac?: string };
		if (cfg.algorithm !== "m.secret_storage.v1.aes-hmac-sha2" || !cfg.iv || !cfg.mac) {
			return Response.json({ ok: false, error: "unsupported SSSS algorithm or missing iv/mac" }, { status: 500 });
		}

		// 3. Decode recovery key, verify it matches the SSSS config.
		let seed: Uint8Array;
		try { seed = decodeRecoveryKey(recovery); }
		catch (e) { return Response.json({ ok: false, error: `bad recovery key: ${e instanceof Error ? e.message : e}` }, { status: 400 }); }
		const matches = await verifyRecoveryKey(seed, { iv: cfg.iv, mac: cfg.mac });
		if (!matches) return Response.json({ ok: false, error: "recovery key does not match SSSS config MAC" }, { status: 401 });

		// 4. Fetch + decrypt the self-signing secret.
		const ssR = await fetch(`${homeserver}/_matrix/client/v3/user/${ud}/account_data/m.cross_signing.self_signing`, { headers: authHeaders });
		if (!ssR.ok) return Response.json({ ok: false, stage: "ss_secret", status: ssR.status }, { status: 502 });
		const ssData = (await ssR.json()) as { encrypted?: Record<string, { iv: string; ciphertext: string; mac: string }> };
		const encEntry = ssData.encrypted?.[def.key];
		if (!encEntry) return Response.json({ ok: false, error: "self-signing secret not encrypted with this SSSS key" }, { status: 500 });
		const ssPlain = await decryptSecret(seed, "m.cross_signing.self_signing", encEntry);
		const ssSeedB64 = new TextDecoder().decode(ssPlain); // 43-char unpadded base64 of 32-byte seed

		// 5. Build the device key doc + canonical JSON to sign. We use our
		//    existing Olm account's identity_keys plus the algorithms +
		//    keys + signatures (with ours) — same shape as /keys/upload sent.
		const { account } = await this.loadAccount();
		try {
			const ids = JSON.parse(account.identity_keys()) as { curve25519: string; ed25519: string };
			const unsignedDoc = {
				user_id: userId,
				device_id: deviceId,
				algorithms: ["m.olm.v1.curve25519-aes-sha2", "m.megolm.v1.aes-sha2"],
				keys: {
					[`curve25519:${deviceId}`]: ids.curve25519,
					[`ed25519:${deviceId}`]: ids.ed25519,
				},
			};
			const ownSig = account.sign(canonicalJson(unsignedDoc));

			// 6. Sign with the self-signing private key via Olm PkSigning.
			// `init_with_seed` expects a raw Uint8Array (32 bytes), not the
			// base64 string the SSSS plaintext is — decode first.
			const seedBytes = b64decodeUnpadded(ssSeedB64);
			const Olm = (await getOlm()) as any;
			const pk = new Olm.PkSigning();
			let ssPub: string;
			let ssSig: string;
			try {
				ssPub = pk.init_with_seed(seedBytes);
				ssSig = pk.sign(canonicalJson(unsignedDoc));
			} finally {
				pk.free();
			}

			// 7. Assemble signed key doc with both signatures.
			const signedDoc = {
				...unsignedDoc,
				signatures: {
					[userId]: {
						[`ed25519:${deviceId}`]: ownSig,
						[`ed25519:${ssPub}`]: ssSig,
					},
				},
			};

			// 8. Upload via /keys/signatures/upload (no UIA needed — the SSK
			//    signature itself proves we hold the user's self-signing key).
			const uploadR = await fetch(`${homeserver}/_matrix/client/v3/keys/signatures/upload`, {
				method: "POST",
				headers: authHeaders,
				body: JSON.stringify({ [userId]: { [deviceId]: signedDoc } }),
			});
			const upBody = await uploadR.text();
			return Response.json(
				{ ok: uploadR.ok, status: uploadR.status, self_signing_pub: ssPub, response: tryParseJson(upBody) },
				{ status: uploadR.ok ? 200 : 502 },
			);
		} finally {
			account.free();
		}
	}

	// Decrypt one m.olm.v1.curve25519-aes-sha2 ciphertext entry and return the
	// inner plaintext (typically a stringified m.room_key event). If the inner
	// event is an m.room_key, the new Megolm session is appended to the
	// keystore so the listener can decrypt that room going forward.
	private async decryptToDevice(senderCurve25519: string, ciphertext: { type: 0 | 1; body: string }): Promise<Response> {
		const Olm = await getOlm();
		const { account } = await this.loadAccount();
		try {
			const sessionsMap = (await this.state.storage.get<Record<string, string[]>>(K_SESSIONS)) ?? {};
			const pickles = sessionsMap[senderCurve25519] ?? [];

			let plaintext: string | null = null;
			let usedSessionPickle: string | null = null;

			// First try existing sessions — any that matches the inbound message body wins.
			for (const pickled of pickles) {
				const sess = new (Olm as any).Session();
				sess.unpickle(pickleKey(this.env), pickled);
				try {
					if (ciphertext.type === 1 || sess.matches_inbound_from(senderCurve25519, ciphertext.body)) {
						plaintext = sess.decrypt(ciphertext.type, ciphertext.body);
						usedSessionPickle = sess.pickle(pickleKey(this.env));
						break;
					}
				} catch {
					/* not this session */
				} finally {
					sess.free();
				}
			}

			// If no existing session matched and this is a pre-key message (type 0), create one.
			if (plaintext === null && ciphertext.type === 0) {
				const sess = new (Olm as any).Session();
				sess.create_inbound_from(account, senderCurve25519, ciphertext.body);
				account.remove_one_time_keys(sess);
				plaintext = sess.decrypt(0, ciphertext.body);
				usedSessionPickle = sess.pickle(pickleKey(this.env));
				sess.free();
				await this.savePickle(account);
			}

			if (plaintext === null) {
				return Response.json({ ok: false, reason: "no matching session" }, { status: 422 });
			}

			// Persist the session (new or advanced) for future ratchet steps.
			if (usedSessionPickle) {
				const next = pickles.filter((p) => p !== usedSessionPickle);
				next.push(usedSessionPickle);
				// Cap=32 (was 8). Verified + multi-device senders can rotate
				// Olm sessions fast enough that 8 was occasionally dropping
				// legitimate sessions whose ratchet was still alive (silent
				// decryption failure on subsequent to-device events that
				// referenced the evicted session). mautrix-go keeps ~64;
				// 32 is a comfortable mid-point. Log evictions so the
				// operator can spot pathological churn.
				const CAP = 32;
				if (next.length > CAP) {
					const evicted = next.length - CAP;
					console.log(
						`[olm-vault] session cap evicted ${evicted} oldest session(s) sender=${senderCurve25519.slice(0, 12)}…`,
					);
				}
				sessionsMap[senderCurve25519] = next.slice(-CAP);
				await this.state.storage.put(K_SESSIONS, sessionsMap);
			}

			// Inspect the inner event and capture Megolm session keys.
			// Two shapes match:
			//   - m.room_key (initial share when a sender starts a new session)
			//   - m.forwarded_room_key (response to our m.room_key_request,
			//     used for E2EE auto-recovery when a session rotates without
			//     us getting the initial share)
			let captured = false;
			let capturedRoomId: string | undefined;
			let capturedSessionId: string | undefined;
			let capturedSource: "live" | "forwarded" | undefined;
			try {
				const inner = JSON.parse(plaintext) as {
					type?: string;
					content?: {
						algorithm?: string;
						room_id?: string;
						session_id?: string;
						session_key?: string;
						// Forwarded keys carry the original sender's curve25519 in a
						// dedicated field; the immediate to-device sender_key only
						// tells us who forwarded, not who originally encrypted.
						sender_key?: string;
					};
				};
				const isShare =
					(inner.type === "m.room_key" || inner.type === "m.forwarded_room_key") &&
					inner.content?.algorithm === "m.megolm.v1.aes-sha2" &&
					inner.content.room_id &&
					inner.content.session_id &&
					inner.content.session_key;
				if (isShare && inner.content) {
					const c = inner.content;
					const ks = (await this.state.storage.get<Record<string, MegolmKeyEntry[]>>(K_KEYSTORE)) ?? {};
					const list = ks[c.room_id!] ?? [];
					if (!list.find((e) => e.session_id === c.session_id)) {
						list.push({
							session_id: c.session_id!,
							session_key: c.session_key!,
							// Prefer the original sender_key from the inner content
							// when present (forwarded_room_key) — falls back to the
							// to-device sender's curve25519 otherwise.
							sender_key: c.sender_key ?? senderCurve25519,
							source: inner.type === "m.forwarded_room_key" ? "forwarded" : "live",
						});
						ks[c.room_id!] = list;
						await this.state.storage.put(K_KEYSTORE, ks);
						captured = true;
						capturedRoomId = c.room_id;
						capturedSessionId = c.session_id;
						capturedSource = inner.type === "m.forwarded_room_key" ? "forwarded" : "live";
						console.log(
							`[olm-vault] captured Megolm via ${inner.type} room=${c.room_id} session=${c.session_id!.slice(0, 16)}…`,
						);
					}
				}
			} catch {
				/* not JSON — return raw */
			}

			return Response.json({ ok: true, captured, plaintext, capturedRoomId, capturedSessionId, capturedSource });
		} finally {
			account.free();
			void Olm;
		}
	}
}

function tryParseJson(s: string): unknown {
	try { return JSON.parse(s); } catch { return s; }
}

function b64decodeUnpadded(s: string): Uint8Array {
	let std = s.replace(/-/g, "+").replace(/_/g, "/");
	while (std.length % 4 !== 0) std += "=";
	const bin = atob(std);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

// Matrix canonical JSON: keys sorted, no whitespace, no \u escapes for
// non-control chars. Per https://spec.matrix.org/v1.11/appendices/#canonical-json
function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
		return JSON.stringify(value);
	}
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}
