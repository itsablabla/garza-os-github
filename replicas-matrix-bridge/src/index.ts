import { handleMatrixMessage } from "./dispatch";

export interface Env {
	MAP: KVNamespace;
	WATCHER: DurableObjectNamespace;
	LISTENER: DurableObjectNamespace;
	OLM_VAULT: DurableObjectNamespace;
	MATRIX_HOMESERVER: string;
	MATRIX_ACCESS_TOKEN: string;
	MATRIX_USER_ID: string;
	MATRIX_DEVICE_ID?: string;
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
	// JSON array of Megolm session keys (Element key-export format, decrypted
	// out of band and stashed here). Used by the listener to decrypt
	// m.room.encrypted events whose session_id we hold.
	MATRIX_MEGOLM_KEYS_JSON?: string;
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

	async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
		const stub = env.LISTENER.get(env.LISTENER.idFromName("global"));
		await stub.fetch("https://listener/start", { method: "POST" }).catch(() => {});
	},
};
