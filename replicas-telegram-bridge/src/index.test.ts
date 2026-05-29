import { describe, expect, it, vi, beforeEach } from "vitest";
import worker, { handleMessage, replicaName, routingKey, type Env } from "./index";

function mockKv() {
	const store = new Map<string, string>();
	return {
		store,
		kv: {
			get: vi.fn(async (k: string) => store.get(k) ?? null),
			put: vi.fn(async (k: string, v: string, _opts?: unknown) => {
				store.set(k, v);
			}),
			delete: vi.fn(async (k: string) => {
				store.delete(k);
			}),
		} as unknown as KVNamespace,
	};
}

function mockEnv(overrides: Partial<Env> = {}): { env: Env; store: Map<string, string> } {
	const { kv, store } = mockKv();
	return {
		store,
		env: {
			MAP: kv,
			TG_TOKEN: "test-tg-token",
			TG_WEBHOOK_SECRET: "test-secret",
			REPLICAS_API_KEY: "test-replicas-key",
			REPLICAS_ORG_ID: "org-id",
			REPLICAS_ENV_ID: "env-id",
			REPLICAS_API_BASE: "https://api.example/v1",
			TG_API_BASE: "https://tg.example",
			REPLICA_TTL_SECONDS: "604800",
			...overrides,
		},
	};
}

function tgMessage(overrides: Record<string, unknown> = {}) {
	return {
		message_id: 100,
		date: 0,
		chat: { id: 555, type: "private" as const },
		from: { id: 1, username: "alice" },
		text: "hello",
		...overrides,
	};
}

function mockFetch(handlers: Record<string, (init: RequestInit | undefined) => Response | Promise<Response>>) {
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
		calls.push({ url, init });
		for (const [pattern, handler] of Object.entries(handlers)) {
			if (url.includes(pattern)) return handler(init);
		}
		return new Response("not found", { status: 404 });
	});
	vi.stubGlobal("fetch", impl);
	return { calls, impl };
}

const ctx: ExecutionContext = {
	waitUntil: (p: Promise<unknown>) => {
		// Run synchronously for tests so we can assert on side effects.
		void p;
	},
	passThroughOnException: () => {},
	props: {},
};

beforeEach(() => {
	vi.restoreAllMocks();
});

describe("worker.fetch", () => {
	it("returns 200 on /health", async () => {
		const { env } = mockEnv();
		const res = await worker.fetch(new Request("https://w/health"), env, ctx);
		expect(res.status).toBe(200);
	});

	it("rejects unknown paths", async () => {
		const { env } = mockEnv();
		const res = await worker.fetch(
			new Request("https://w/other", { method: "POST", body: "{}" }),
			env,
			ctx,
		);
		expect(res.status).toBe(404);
	});

	it("rejects POSTs missing the webhook secret", async () => {
		const { env } = mockEnv();
		const res = await worker.fetch(
			new Request("https://w/tg", { method: "POST", body: JSON.stringify({}) }),
			env,
			ctx,
		);
		expect(res.status).toBe(403);
	});

	it("accepts valid POSTs with the secret header", async () => {
		const { env } = mockEnv();
		mockFetch({});
		const req = new Request("https://w/tg", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-telegram-bot-api-secret-token": "test-secret",
			},
			body: JSON.stringify({ update_id: 1 }),
		});
		const res = await worker.fetch(req, env, ctx);
		expect(res.status).toBe(200);
	});

	it("returns 400 on malformed JSON", async () => {
		const { env } = mockEnv();
		const req = new Request("https://w/tg", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-telegram-bot-api-secret-token": "test-secret",
			},
			body: "not-json",
		});
		const res = await worker.fetch(req, env, ctx);
		expect(res.status).toBe(400);
	});
});

describe("handleMessage", () => {
	it("creates a replica on the first message in a chat", async () => {
		const { env, store } = mockEnv();
		const { calls } = mockFetch({
			"api.example/v1/replica": () =>
				new Response(JSON.stringify({ replica: { id: "rep-1" } }), { status: 200 }),
			"tg.example": () => new Response("{}", { status: 200 }),
		});

		await handleMessage(tgMessage(), "deploy the api", env);

		const created = calls.find((c) => c.url.endsWith("/v1/replica"));
		expect(created).toBeDefined();
		const body = JSON.parse((created!.init!.body as string) ?? "{}");
		expect(body.message).toBe("deploy the api");
		expect(body.source).toBe("telegram");
		expect(body.environment_id).toBe("env-id");
		expect(body.metadata.telegram_chat_id).toBe(555);

		expect(store.get("chat:555:thread:main")).toBe("rep-1");
	});

	it("sends a follow-up message when a replica already exists", async () => {
		const { env, store } = mockEnv();
		store.set("chat:555:thread:main", "rep-existing");

		const { calls } = mockFetch({
			"rep-existing/messages": () => new Response("{}", { status: 200 }),
			"tg.example": () => new Response("{}", { status: 200 }),
		});

		await handleMessage(tgMessage({ message_id: 101, text: "and add tests" }), "and add tests", env);

		const followUp = calls.find((c) => c.url.includes("rep-existing/messages"));
		expect(followUp).toBeDefined();

		const created = calls.find((c) => c.url.endsWith("/v1/replica"));
		expect(created).toBeUndefined();

		expect(store.get("chat:555:thread:main")).toBe("rep-existing");
	});

	it("is idempotent for duplicate Telegram deliveries of the same message_id", async () => {
		const { env } = mockEnv();
		const created = vi.fn(
			() => new Response(JSON.stringify({ replica: { id: "rep-1" } }), { status: 200 }),
		);
		mockFetch({
			"api.example/v1/replica": created,
			"tg.example": () => new Response("{}", { status: 200 }),
		});

		await handleMessage(tgMessage(), "hello", env);
		await handleMessage(tgMessage(), "hello", env);

		expect(created).toHaveBeenCalledTimes(1);
	});

	it("posts an error message back to Telegram when the Replicas API fails", async () => {
		const { env } = mockEnv();
		const { calls } = mockFetch({
			"api.example/v1/replica": () => new Response("boom", { status: 500 }),
			"tg.example": () => new Response("{}", { status: 200 }),
		});

		await handleMessage(tgMessage(), "do a thing", env);

		const errMsg = calls.find(
			(c) => c.url.includes("/sendMessage") && (c.init!.body as string).includes("couldn't reach Replicas"),
		);
		expect(errMsg).toBeDefined();
	});

	it("keys forum-topic messages by message_thread_id", async () => {
		const { env, store } = mockEnv();
		mockFetch({
			"api.example/v1/replica": () =>
				new Response(JSON.stringify({ replica: { id: "rep-topic" } }), { status: 200 }),
			"tg.example": () => new Response("{}", { status: 200 }),
		});

		await handleMessage(
			tgMessage({ message_thread_id: 42, chat: { id: 999, type: "supergroup" } }),
			"hi from a topic",
			env,
		);

		expect(store.get("chat:999:thread:42")).toBe("rep-topic");
	});
});

describe("helpers", () => {
	it("routingKey separates DM and forum topics", () => {
		expect(routingKey(1)).toBe("chat:1:thread:main");
		expect(routingKey(1, 5)).toBe("chat:1:thread:5");
	});

	it("replicaName slugifies sender", () => {
		const name = replicaName(tgMessage({ from: { id: 1, username: "Alice Wonder!" } }));
		expect(name).toMatch(/^tg-alice-wonder-555-100$/);
	});

	it("replicaName falls back to a safe default for missing usernames", () => {
		const name = replicaName(tgMessage({ from: undefined }));
		expect(name).toMatch(/^tg-tg-555-100$/);
	});
});
