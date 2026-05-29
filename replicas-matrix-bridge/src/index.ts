import { handleMatrixMessage } from "./dispatch";

export interface Env {
	MAP: KVNamespace;
	WATCHER: DurableObjectNamespace;
	LISTENER: DurableObjectNamespace;
	MATRIX_HOMESERVER: string;
	MATRIX_ACCESS_TOKEN: string;
	MATRIX_USER_ID: string;
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
