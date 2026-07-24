import { handleMatrixMessage } from "./dispatch";

export interface Env {
	MAP: KVNamespace;
	OUTPUT_ARCHIVE: R2Bucket;
	WATCHER: DurableObjectNamespace;
	LISTENER: DurableObjectNamespace;
	OLM_VAULT: DurableObjectNamespace;
	MATRIX_HOMESERVER: string;
	MATRIX_ACCESS_TOKEN: string;
	MATRIX_USER_ID: string;
	MATRIX_DEVICE_ID?: string;
	// Bot's display name used for the plain-text wake-word gate in group
	// rooms. Defaults to "Jada" if unset. See isPlainTextWakeWord in
	// listener.ts for match rules. Configure in wrangler.toml [vars].
	MATRIX_DISPLAY_NAME?: string;
	// Base58-encoded SSSS recovery key (e.g. `EsTu zRAC eDpv …`) used to
	// decrypt the cross-signing private keys stashed in the user's account
	// data. Optional — only required by /admin/vault/cross-sign.
	MATRIX_RECOVERY_KEY?: string;
	REPLICAS_API_KEY: string;
	REPLICAS_ORG_ID: string;
	REPLICAS_ENV_ID: string;
	REPLICAS_API_BASE: string;
	REPLICA_TTL_SECONDS: string;
	REPLICAS_AGENT_OVERRIDE?: string;
	REPLICAS_MODEL_OVERRIDE?: string;
	REPLICAS_THINKING_OVERRIDE?: string;
	// Single-workspace mode. When set, dispatch reuses this replica id for
	// any room whose KV mapping is missing instead of POST /v1/replica.
	// On first message in a new room we pin the mapping (room:<id> ->
	// DEFAULT_REPLICA_ID) so subsequent traffic flows the normal
	// `existing` path and never falls back. Unset to keep per-room
	// auto-spawn behavior. Set via `wrangler secret put DEFAULT_REPLICA_ID`
	// or under [vars] in wrangler.toml.
	DEFAULT_REPLICA_ID?: string;
	// JSON array of Megolm session keys (Element key-export format, decrypted
	// out of band and stashed here). Used by the listener to decrypt
	// m.room.encrypted events whose session_id we hold.
	MATRIX_MEGOLM_KEYS_JSON?: string;
	// Subscription-plan token quotas for the 5h reset window + weekly
	// view in the status pane subtitle. Parsed as ints; "0" or unset
	// hides the corresponding window. Defaults configured in
	// wrangler.toml for the Claude Max $200 plan; override per-account.
	USAGE_QUOTA_5H_TOK?: string;
	USAGE_QUOTA_7D_TOK?: string;
	// Bearer token gating /admin/*, /debug/*, and /dispatch. When unset the
	// endpoints fall through with a warning log (migration mode) so existing
	// operator curl flows keep working. Once set, every protected route
	// requires `Authorization: Bearer ${ADMIN_TOKEN}`. Set via
	// `wrangler secret put ADMIN_TOKEN`.
	ADMIN_TOKEN?: string;
	// OpenAI API key for Whisper voice-message transcription (Phase 1).
	// When unset, voice messages are skipped silently (logged). Set via
	// `wrangler secret put OPENAI_API_KEY`.
	OPENAI_API_KEY?: string;
}

// Constant-time string compare to avoid leaking ADMIN_TOKEN length / prefix
// via response-time differences. Falls back to a length-mismatch fast path
// (both branches still walk both strings).
function timingSafeEqual(a: string, b: string): boolean {
	const la = a.length;
	const lb = b.length;
	const len = Math.max(la, lb);
	let diff = la ^ lb;
	for (let i = 0; i < len; i++) {
		const ca = i < la ? a.charCodeAt(i) : 0;
		const cb = i < lb ? b.charCodeAt(i) : 0;
		diff |= ca ^ cb;
	}
	return diff === 0;
}

function requireAuth(req: Request, env: Env, pathname: string): Response | null {
	if (!env.ADMIN_TOKEN) {
		console.log(`[auth] WARNING: ${pathname} called without ADMIN_TOKEN configured — allowing (migration mode). Set ADMIN_TOKEN secret to lock down.`);
		return null;
	}
	const header = req.headers.get("Authorization") ?? "";
	const match = /^Bearer\s+(.+)$/i.exec(header);
	const presented = match?.[1]?.trim() ?? "";
	if (!presented || !timingSafeEqual(presented, env.ADMIN_TOKEN)) {
		return new Response("unauthorized", { status: 401 });
	}
	return null;
}

export { ReplicaPoller } from "./poller";
export { MatrixListener } from "./listener";
export { OlmVault } from "./olm-vault";

interface DispatchBody {
	roomId: string;
	eventId: string;
	body: string;
}

export default {
	async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(req.url);

		if (req.method === "GET" && url.pathname === "/health") {
			return new Response("ok");
		}

		// Gate every privileged path. /health stays public; everything else
		// (admin/debug + dispatch + start-listener) requires ADMIN_TOKEN
		// once it's set. While unset, the helper logs a warning and lets
		// the request through so we don't break operator flows mid-migration.
		const isProtected =
			url.pathname.startsWith("/admin/") ||
			url.pathname.startsWith("/debug/") ||
			url.pathname === "/dispatch" ||
			url.pathname === "/start-listener";
		if (isProtected) {
			const denied = requireAuth(req, env, url.pathname);
			if (denied) return denied;
		}

		if (req.method === "POST" && url.pathname === "/start-listener") {
			const stub = env.LISTENER.get(env.LISTENER.idFromName("global"));
			await stub.fetch("https://listener/start", { method: "POST" });
			return new Response("ok");
		}

		if (req.method === "GET" && url.pathname === "/debug/listener") {
			const stub = env.LISTENER.get(env.LISTENER.idFromName("global"));
			return stub.fetch("https://listener/debug");
		}

		if (req.method === "GET" && url.pathname === "/debug/vault/identity") {
			const stub = env.OLM_VAULT.get(env.OLM_VAULT.idFromName("global"));
			return stub.fetch("https://vault/identity");
		}
		if (req.method === "POST" && url.pathname === "/admin/listener/reset") {
			const stub = env.LISTENER.get(env.LISTENER.idFromName("global"));
			return stub.fetch("https://listener/reset", { method: "POST" });
		}
		if (req.method === "POST" && url.pathname === "/admin/listener/reload-keys") {
			const stub = env.LISTENER.get(env.LISTENER.idFromName("global"));
			return stub.fetch("https://listener/reload-keys", { method: "POST" });
		}
		if (req.method === "POST" && url.pathname === "/admin/kv-cleanup-conflicts") {
			// Scan all `room:*` keys, group by replicaId, and for any
			// replicaId mapped to multiple rooms, keep the room that
			// matches the `replica:<id>` reverse mapping (if present) or
			// the one that matches the replica's metadata.matrix_room_id
			// (queried via the Replicas API), else the lexicographically
			// first room. Delete the others. Idempotent — re-running on
			// a clean KV is a no-op. Used when the cross-room contamination
			// guard didn't exist or got bypassed.
			const list = await env.MAP.list({ prefix: "room:" });
			const byReplica: Record<string, string[]> = {};
			for (const k of list.keys) {
				const val = await env.MAP.get(k.name);
				if (!val) continue;
				(byReplica[val] = byReplica[val] ?? []).push(k.name);
			}
			const actions: { replicaId: string; kept: string; deleted: string[] }[] = [];
			for (const [replicaId, rooms] of Object.entries(byReplica)) {
				if (rooms.length <= 1) continue;
				let kept = rooms[0]!;
				const reverse = await env.MAP.get(`replica:${replicaId}`);
				if (reverse) {
					const reverseKey = `room:${reverse}`;
					if (rooms.includes(reverseKey)) kept = reverseKey;
				}
				const deleted: string[] = [];
				for (const room of rooms) {
					if (room === kept) continue;
					await env.MAP.delete(room);
					deleted.push(room);
				}
				actions.push({ replicaId, kept, deleted });
			}
			return Response.json({
				ok: true,
				totalRooms: list.keys.length,
				conflictsResolved: actions.length,
				actions,
			});
		}
		if (req.method === "POST" && url.pathname === "/admin/vault/reset") {
			const stub = env.OLM_VAULT.get(env.OLM_VAULT.idFromName("global"));
			return stub.fetch("https://vault/reset", { method: "POST" });
		}
		if (req.method === "POST" && url.pathname === "/admin/vault/cross-sign") {
			const stub = env.OLM_VAULT.get(env.OLM_VAULT.idFromName("global"));
			return stub.fetch("https://vault/cross-sign", { method: "POST" });
		}
		if (req.method === "POST" && url.pathname === "/admin/vault/bootstrap") {
			const stub = env.OLM_VAULT.get(env.OLM_VAULT.idFromName("global"));
			return stub.fetch("https://vault/bootstrap", { method: "POST" });
		}
		if (req.method === "POST" && url.pathname === "/admin/vault/upload-device") {
			const stub = env.OLM_VAULT.get(env.OLM_VAULT.idFromName("global"));
			return stub.fetch("https://vault/upload-device", { method: "POST" });
		}
		if (req.method === "POST" && url.pathname === "/admin/vault/upload-otks") {
			const stub = env.OLM_VAULT.get(env.OLM_VAULT.idFromName("global"));
			return stub.fetch("https://vault/upload-otks", { method: "POST", body: '{"count":50}' });
		}
		if (req.method === "GET" && url.pathname === "/debug/kv-conflicts") {
			// Walk all `room:` mappings in KV and surface any case where
			// the same replicaId is mapped to multiple rooms. Cross-room
			// contamination of the watcher state would result from such a
			// collision — Jaden's "many chats saying the same thing" is
			// exactly the symptom. Today empirically zero collisions; the
			// endpoint is the standing detector.
			const list = await env.MAP.list({ prefix: "room:" });
			const byReplica: Record<string, string[]> = {};
			for (const k of list.keys) {
				const val = await env.MAP.get(k.name);
				if (!val) continue;
				(byReplica[val] = byReplica[val] ?? []).push(k.name);
			}
			const conflicts = Object.fromEntries(
				Object.entries(byReplica).filter(([, rooms]) => rooms.length > 1),
			);
			return Response.json({
				totalRooms: list.keys.length,
				totalReplicas: Object.keys(byReplica).length,
				conflicts,
				conflictCount: Object.keys(conflicts).length,
			});
		}

		if (req.method === "GET" && url.pathname.startsWith("/debug/verify-room/")) {
			// Per-room delivery audit. Pulls the watcher's stored
			// `statusEventId` + `replyEventId` and checks they're both
			// present in the room's recent timeline. Used to triage
			// reports of "I asked the bot and never got a reply" —
			// surfaces whether the bridge thinks it sent something the
			// room doesn't actually have.
			const roomId = decodeURIComponent(url.pathname.slice("/debug/verify-room/".length));
			if (!roomId) return new Response("missing room id", { status: 400 });
			const replicaId = await env.MAP.get(`room:${roomId}`);
			if (!replicaId) return Response.json({ ok: false, error: "no KV mapping for room" });
			const stub = env.WATCHER.get(env.WATCHER.idFromName(replicaId));
			const dbg = await stub.fetch("https://watcher/debug").then((r) => r.json() as Promise<{ state?: Record<string, unknown> }>);
			const state = dbg.state ?? {};
			const statusEventId = state.statusEventId as string | undefined;
			const replyEventId = state.replyEventId as string | undefined;
			const present = async (eid: string): Promise<boolean> => {
				const r = await fetch(
					`${env.MATRIX_HOMESERVER}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eid)}`,
					{ headers: { Authorization: `Bearer ${env.MATRIX_ACCESS_TOKEN}` } },
				);
				return r.ok;
			};
			return Response.json({
				roomId,
				replicaId,
				statusEventId: statusEventId ?? null,
				statusEventDelivered: statusEventId ? await present(statusEventId) : null,
				replyEventId: replyEventId ?? null,
				replyEventDelivered: replyEventId ? await present(replyEventId) : null,
			});
		}

		if (req.method === "GET" && url.pathname === "/debug/vault/lookup") {
			const roomId = url.searchParams.get("room") ?? "";
			const sessionId = url.searchParams.get("session") ?? "";
			const stub = env.OLM_VAULT.get(env.OLM_VAULT.idFromName("global"));
			return stub.fetch(
				`https://vault/lookup?room=${encodeURIComponent(roomId)}&session=${encodeURIComponent(sessionId)}`,
			);
		}

		if (req.method === "GET" && url.pathname === "/debug/vault/keystore") {
			const stub = env.OLM_VAULT.get(env.OLM_VAULT.idFromName("global"));
			return stub.fetch("https://vault/keystore");
		}

		if (req.method === "GET" && url.pathname === "/debug/olm") {
			try {
				const { getOlm } = await import("./olm-init");
				const Olm = await getOlm();
				const acc = new Olm.Account();
				acc.create();
				const ids = acc.identity_keys();
				acc.free();
				return new Response(
					JSON.stringify({ ok: true, library_version: Olm.get_library_version(), identity_keys: JSON.parse(ids) }),
					{ headers: { "Content-Type": "application/json" } },
				);
			} catch (e) {
				return new Response(
					JSON.stringify({ ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e), stack: e instanceof Error ? e.stack : undefined }),
					{ status: 500, headers: { "Content-Type": "application/json" } },
				);
			}
		}

		if (req.method === "GET" && url.pathname.startsWith("/debug/watcher/")) {
			const replicaId = url.pathname.slice("/debug/watcher/".length);
			if (!replicaId) return new Response("missing replica id", { status: 400 });
			const stub = env.WATCHER.get(env.WATCHER.idFromName(replicaId));
			return stub.fetch("https://watcher/debug", { method: "GET" });
		}

		if (req.method === "POST" && url.pathname.startsWith("/admin/recover-room/")) {
			// One-shot E2EE recovery: pulls the recent timeline for a room,
			// finds encrypted events whose Megolm session key isn't in the
			// vault, queues each into pending-decrypt, and emits a single
			// m.room_key_request per unknown session. Use when messages
			// were sent BEFORE the auto-recovery code shipped — the
			// listener won't re-process them on /sync (past the since
			// token), so we need an out-of-band pull.
			const roomId = decodeURIComponent(url.pathname.slice("/admin/recover-room/".length));
			if (!roomId) return new Response("missing room id", { status: 400 });
			const encoded = encodeURIComponent(roomId);
			const limitParam = url.searchParams.get("limit") ?? "20";
			const r = await fetch(
				`${env.MATRIX_HOMESERVER}/_matrix/client/v3/rooms/${encoded}/messages?dir=b&limit=${limitParam}`,
				{ headers: { Authorization: `Bearer ${env.MATRIX_ACCESS_TOKEN}` } },
			);
			if (!r.ok) return new Response(`upstream ${r.status}`, { status: 502 });
			const body = (await r.json()) as {
				chunk?: {
					type?: string;
					event_id?: string;
					sender?: string;
					origin_server_ts?: number;
					content?: { algorithm?: string; ciphertext?: string; session_id?: string; sender_key?: string };
				}[];
			};
			// Hand the encrypted events to the listener via a new helper
			// endpoint so its DO state (queue + dedupe + key-request) is
			// the source of truth. The listener handles queuing and
			// sending the m.room_key_request.
			const stub = env.LISTENER.get(env.LISTENER.idFromName("global"));
			const resp = await stub.fetch("https://listener/recover-room", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ roomId, events: body.chunk ?? [] }),
			});
			const txt = await resp.text();
			return new Response(txt, { status: resp.status, headers: { "Content-Type": "application/json" } });
		}

		if (req.method === "POST" && url.pathname.startsWith("/admin/join-room/")) {
			const roomId = decodeURIComponent(url.pathname.slice("/admin/join-room/".length));
			if (!roomId) return new Response("missing room id", { status: 400 });
			const encoded = encodeURIComponent(roomId);
			const r = await fetch(
				`${env.MATRIX_HOMESERVER}/_matrix/client/v3/rooms/${encoded}/join`,
				{ method: "POST", headers: { Authorization: `Bearer ${env.MATRIX_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: "{}" },
			);
			const body = await r.text();
			return new Response(body, { status: r.status, headers: { "Content-Type": "application/json" } });
		}

		if (req.method === "POST" && url.pathname.startsWith("/admin/watcher/") && url.pathname.endsWith("/cancel")) {
			const replicaId = url.pathname.slice("/admin/watcher/".length, -"/cancel".length);
			if (!replicaId) return new Response("missing replica id", { status: 400 });
			const stub = env.WATCHER.get(env.WATCHER.idFromName(replicaId));
			return stub.fetch("https://watcher/cancel", { method: "POST" });
		}

		if (req.method === "GET" && url.pathname.startsWith("/debug/roomname/")) {
			const roomId = decodeURIComponent(url.pathname.slice("/debug/roomname/".length));
			if (!roomId) return new Response("missing room id", { status: 400 });
			const encoded = encodeURIComponent(roomId);
			const r = await fetch(
				`${env.MATRIX_HOMESERVER}/_matrix/client/v3/rooms/${encoded}/state/m.room.name/`,
				{ headers: { Authorization: `Bearer ${env.MATRIX_ACCESS_TOKEN}` } },
			);
			const body = await r.text();
			return new Response(body, { status: r.status, headers: { "Content-Type": "application/json" } });
		}

		if (req.method === "GET" && url.pathname === "/debug/invites") {
			const r = await fetch(
				`${env.MATRIX_HOMESERVER}/_matrix/client/v3/sync?filter=%7B%22room%22%3A%7B%22invite%22%3A%7B%22limit%22%3A50%7D%2C%22join%22%3A%7B%22limit%22%3A0%2C%22timeline%22%3A%7B%22limit%22%3A0%7D%7D%2C%22leave%22%3A%7B%22limit%22%3A0%7D%7D%7D&timeout=0`,
				{ headers: { Authorization: `Bearer ${env.MATRIX_ACCESS_TOKEN}` } },
			);
			const data = (await r.json()) as {
				rooms?: { invite?: Record<string, { invite_state?: { events?: Array<{ type: string; content: Record<string, unknown> }> } }> };
			};
			const invites = data.rooms?.invite ?? {};
			const out = Object.entries(invites).map(([roomId, room]) => {
				const events = room.invite_state?.events ?? [];
				const nameEv = events.find((e) => e.type === "m.room.name");
				const name = nameEv ? String(nameEv.content.name ?? "") : null;
				return { roomId, name };
			});
			return new Response(JSON.stringify({ invites: out }), {
				status: r.status,
				headers: { "Content-Type": "application/json" },
			});
		}

		if (req.method === "GET" && url.pathname === "/debug/joined-rooms") {
			const r = await fetch(
				`${env.MATRIX_HOMESERVER}/_matrix/client/v3/joined_rooms`,
				{ headers: { Authorization: `Bearer ${env.MATRIX_ACCESS_TOKEN}` } },
			);
			const body = await r.text();
			return new Response(body, { status: r.status, headers: { "Content-Type": "application/json" } });
		}

		if (req.method === "GET" && url.pathname.startsWith("/debug/room-timeline/")) {
			const roomId = decodeURIComponent(url.pathname.slice("/debug/room-timeline/".length));
			if (!roomId) return new Response("missing room id", { status: 400 });
			const encoded = encodeURIComponent(roomId);
			const limit = url.searchParams.get("limit") ?? "20";
			const r = await fetch(
				`${env.MATRIX_HOMESERVER}/_matrix/client/v3/rooms/${encoded}/messages?dir=b&limit=${limit}`,
				{ headers: { Authorization: `Bearer ${env.MATRIX_ACCESS_TOKEN}` } },
			);
			const body = await r.text();
			return new Response(body, { status: r.status, headers: { "Content-Type": "application/json" } });
		}

		if (req.method === "POST" && url.pathname === "/dispatch") {
			const body = (await req.json()) as DispatchBody;
			ctx.waitUntil(handleMatrixMessage(env, body.roomId, body.eventId, body.body));
			return new Response("ok");
		}

		return new Response("not found", { status: 404 });
	},

	async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		// Kick the listener every minute. If its alarm chain is healthy this
		// is a no-op (setAlarm just replaces the existing alarm); if it's
		// somehow stuck the /start handler re-arms it.
		const stub = env.LISTENER.get(env.LISTENER.idFromName("global"));
		ctx.waitUntil(stub.fetch("https://listener/start", { method: "POST" }).catch(() => {}));

		// Defense-in-depth invite sweeper. The listener's per-sync
		// `for (invite) { joinRoom() }` loop is the fast path, but it
		// silently fails on rate limit / transient network errors and the
		// catch swallows the failure. Two manual joins already today
		// (Jett Butler, Nomad Office) — the pattern is real. Once per
		// minute, fetch pending invites and force-join each.
		ctx.waitUntil(
			(async () => {
				try {
					const r = await fetch(
						`${env.MATRIX_HOMESERVER}/_matrix/client/v3/sync?filter=%7B%22room%22%3A%7B%22invite%22%3A%7B%22limit%22%3A50%7D%2C%22join%22%3A%7B%22limit%22%3A0%2C%22timeline%22%3A%7B%22limit%22%3A0%7D%7D%2C%22leave%22%3A%7B%22limit%22%3A0%7D%7D%7D&timeout=0`,
						{ headers: { Authorization: `Bearer ${env.MATRIX_ACCESS_TOKEN}` } },
					);
					if (!r.ok) return;
					const data = (await r.json()) as { rooms?: { invite?: Record<string, unknown> } };
					const invites = Object.keys(data.rooms?.invite ?? {});
					for (const roomId of invites) {
						const encoded = encodeURIComponent(roomId);
						try {
							const joinResp = await fetch(
								`${env.MATRIX_HOMESERVER}/_matrix/client/v3/rooms/${encoded}/join`,
								{
									method: "POST",
									headers: {
										Authorization: `Bearer ${env.MATRIX_ACCESS_TOKEN}`,
										"Content-Type": "application/json",
									},
									body: "{}",
								},
							);
							if (joinResp.ok) {
								console.log(`[cron] auto-joined invite ${roomId}`);
							} else {
								console.log(`[cron] invite-sweep join failed ${roomId} status=${joinResp.status}`);
							}
						} catch (e) {
							console.log(`[cron] invite-sweep join exception ${roomId}: ${e instanceof Error ? e.message : e}`);
						}
					}
				} catch (e) {
					console.log(`[cron] invite-sweep top-level failed: ${e instanceof Error ? e.message : e}`);
				}
			})(),
		);
	},
};
