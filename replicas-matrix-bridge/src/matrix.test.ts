import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	editMessage,
	joinRoom,
	pin,
	react,
	redact,
	sendMessage,
	stripHtml,
	sync,
	typing,
	unpin,
	whoami,
} from "./matrix";

const env = {
	MATRIX_HOMESERVER: "https://matrix.example/",
	MATRIX_ACCESS_TOKEN: "syt_test",
	MATRIX_USER_ID: "@bot:example",
};

interface Capture {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
}

function mockFetch(handlers: Array<{ match: string; respond: () => Response }>) {
	const calls: Capture[] = [];
	const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
		const h = (init?.headers ?? {}) as Record<string, string>;
		calls.push({
			url,
			method: init?.method,
			headers: h,
			body: typeof init?.body === "string" ? init.body : undefined,
		});
		for (const h of handlers) {
			if (url.includes(h.match)) return h.respond();
		}
		return new Response("not found", { status: 404 });
	});
	vi.stubGlobal("fetch", fn);
	return { calls };
}

beforeEach(() => {
	vi.restoreAllMocks();
});

describe("matrix client", () => {
	it("sendMessage PUTs an event and returns event_id", async () => {
		const { calls } = mockFetch([
			{
				match: "/rooms/!r/send/m.room.message/",
				respond: () => new Response(JSON.stringify({ event_id: "$ev1" }), { status: 200 }),
			},
		]);
		const id = await sendMessage(env, "!r", "<b>hi</b>");
		expect(id).toBe("$ev1");
		expect(calls).toHaveLength(1);
		expect(calls[0]!.method).toBe("PUT");
		const body = JSON.parse(calls[0]!.body ?? "{}");
		expect(body.msgtype).toBe("m.text");
		expect(body.format).toBe("org.matrix.custom.html");
		expect(body.formatted_body).toBe("<b>hi</b>");
		expect(body.body).toBe("hi");
	});

	it("sendMessage with replyTo attaches m.in_reply_to relation", async () => {
		const { calls } = mockFetch([
			{
				match: "send/m.room.message",
				respond: () => new Response(JSON.stringify({ event_id: "$ev1" })),
			},
		]);
		await sendMessage(env, "!r", "<i>hi</i>", { replyTo: "$parent" });
		const body = JSON.parse(calls[0]!.body ?? "{}");
		expect(body["m.relates_to"]).toEqual({ "m.in_reply_to": { event_id: "$parent" } });
	});

	it("editMessage wraps the new content in m.replace + m.new_content", async () => {
		const { calls } = mockFetch([
			{ match: "send/m.room.message", respond: () => new Response("{}") },
		]);
		await editMessage(env, "!r", "$orig", "<b>updated</b>");
		const body = JSON.parse(calls[0]!.body ?? "{}");
		expect(body["m.relates_to"]).toEqual({ rel_type: "m.replace", event_id: "$orig" });
		expect(body["m.new_content"]).toMatchObject({
			msgtype: "m.text",
			format: "org.matrix.custom.html",
			formatted_body: "<b>updated</b>",
		});
		expect(body.formatted_body).toBe("* <b>updated</b>"); // outer body for non-supporting clients
	});

	it("react sends an m.reaction event with m.annotation relation", async () => {
		const { calls } = mockFetch([
			{ match: "/send/m.reaction/", respond: () => new Response(JSON.stringify({ event_id: "$r" })) },
		]);
		const id = await react(env, "!r", "$target", "👀");
		expect(id).toBe("$r");
		const body = JSON.parse(calls[0]!.body ?? "{}");
		expect(body["m.relates_to"]).toEqual({
			rel_type: "m.annotation",
			event_id: "$target",
			key: "👀",
		});
	});

	it("redact PUTs to /redact/{eventId}/{txn}", async () => {
		const { calls } = mockFetch([{ match: "/redact/", respond: () => new Response("{}") }]);
		await redact(env, "!r", "$victim", "phase change");
		expect(calls[0]!.method).toBe("PUT");
		expect(calls[0]!.url).toContain("/redact/%24victim");
		expect(JSON.parse(calls[0]!.body ?? "{}")).toEqual({ reason: "phase change" });
	});

	it("typing sends true + timeout while active", async () => {
		const { calls } = mockFetch([{ match: "/typing/", respond: () => new Response("{}") }]);
		await typing(env, "!r", true);
		const body = JSON.parse(calls[0]!.body ?? "{}");
		expect(body.typing).toBe(true);
		expect(body.timeout).toBeGreaterThan(0);
	});

	it("pin GETs current pinned + PUTs with the eventId prepended", async () => {
		const { calls } = mockFetch([
			{
				match: "state/m.room.pinned_events",
				respond: () => new Response(JSON.stringify({ pinned: ["$old"] })),
			},
		]);
		await pin(env, "!r", "$new");
		expect(calls).toHaveLength(2);
		expect(calls[0]!.method).toBe("GET");
		expect(calls[1]!.method).toBe("PUT");
		const body = JSON.parse(calls[1]!.body ?? "{}");
		expect(body.pinned).toEqual(["$new", "$old"]);
	});

	it("pin tolerates a 404 from the GET (no pinned-events state yet)", async () => {
		const responses = [
			new Response("not found", { status: 404 }),
			new Response("{}"),
		];
		const { calls } = mockFetch([
			{ match: "state/m.room.pinned_events", respond: () => responses.shift()! },
		]);
		await pin(env, "!r", "$new");
		const body = JSON.parse(calls[1]!.body ?? "{}");
		expect(body.pinned).toEqual(["$new"]);
	});

	it("unpin removes the eventId from the pinned list", async () => {
		const responses = [
			new Response(JSON.stringify({ pinned: ["$a", "$b", "$c"] })),
			new Response("{}"),
		];
		const { calls } = mockFetch([
			{ match: "state/m.room.pinned_events", respond: () => responses.shift()! },
		]);
		await unpin(env, "!r", "$b");
		const body = JSON.parse(calls[1]!.body ?? "{}");
		expect(body.pinned).toEqual(["$a", "$c"]);
	});

	it("joinRoom POSTs to /join", async () => {
		const { calls } = mockFetch([{ match: "/join", respond: () => new Response("{}") }]);
		await joinRoom(env, "!r");
		expect(calls[0]!.method).toBe("POST");
		expect(calls[0]!.url).toContain("/rooms/!r/join");
	});

	it("whoami returns the bot user_id", async () => {
		mockFetch([
			{ match: "/whoami", respond: () => new Response(JSON.stringify({ user_id: "@bot:example" })) },
		]);
		const out = await whoami(env);
		expect(out.user_id).toBe("@bot:example");
	});

	it("sync passes the since token and a generous timeout", async () => {
		const { calls } = mockFetch([
			{ match: "/sync?", respond: () => new Response(JSON.stringify({ next_batch: "n2" })) },
		]);
		const out = await sync(env, "n1", 28000);
		expect(out.next_batch).toBe("n2");
		expect(calls[0]!.url).toContain("since=n1");
		expect(calls[0]!.url).toContain("timeout=28000");
	});
});

describe("stripHtml", () => {
	it("removes tags and unescapes entities", () => {
		expect(stripHtml("<b>hello</b> &lt;world&gt;")).toBe("hello <world>");
	});
	it("turns <br> into newlines", () => {
		expect(stripHtml("a<br>b<br/>c")).toBe("a\nb\nc");
	});
});
