import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stripMarkdownForTts, synthesizeSpeech } from "./tts";

describe("stripMarkdownForTts", () => {
	it("strips fenced code blocks", () => {
		const out = stripMarkdownForTts("Here is code:\n```ts\nconst x = 1\n```\nAnd more.");
		expect(out).not.toContain("```");
		expect(out).not.toContain("const x");
		expect(out).toContain("Here is code");
		expect(out).toContain("[code block]");
		expect(out).toContain("And more.");
	});

	it("strips inline code to plain text", () => {
		expect(stripMarkdownForTts("Run `npm test` now.")).toBe("Run npm test now.");
	});

	it("removes bold/italic markers", () => {
		expect(stripMarkdownForTts("**bold** and _italic_ here")).toBe("bold and italic here");
	});

	it("strips heading hashes", () => {
		expect(stripMarkdownForTts("# Big Title\n\nBody.")).toBe("Big Title\n\nBody.");
	});

	it("strips link decorations to label only", () => {
		expect(stripMarkdownForTts("see [the docs](https://example.com) please")).toBe(
			"see the docs please",
		);
	});

	it("strips list bullets", () => {
		const out = stripMarkdownForTts("- one\n- two\n- three");
		expect(out).toBe("one\ntwo\nthree");
	});
});


describe("synthesizeSpeech", () => {
	const origFetch = globalThis.fetch;
	beforeEach(() => {
		globalThis.fetch = vi.fn();
	});
	afterEach(() => {
		globalThis.fetch = origFetch;
	});

	it("returns error when OPENAI_API_KEY is unset", async () => {
		const res = await synthesizeSpeech({}, "hello");
		expect(res.ok).toBe(false);
		expect(res.error).toContain("OPENAI_API_KEY");
	});

	it("returns audio on 200", async () => {
		const buf = new TextEncoder().encode("OPUS_BYTES").buffer as ArrayBuffer;
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			new Response(buf, { status: 200, headers: { "Content-Type": "audio/ogg" } }),
		);
		const res = await synthesizeSpeech({ OPENAI_API_KEY: "sk-test" }, "Hello world");
		expect(res.ok).toBe(true);
		expect(res.audio).toBeDefined();
		expect(res.mimetype).toBe("audio/ogg");
	});

	it("returns error on non-2xx", async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			new Response("rate limited", { status: 429 }),
		);
		const res = await synthesizeSpeech({ OPENAI_API_KEY: "sk-test" }, "hello");
		expect(res.ok).toBe(false);
		expect(res.error).toContain("429");
	});

	it("rejects empty text without calling OpenAI", async () => {
		const res = await synthesizeSpeech({ OPENAI_API_KEY: "sk-test" }, "   ");
		expect(res.ok).toBe(false);
		expect(res.error).toContain("empty");
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});
});
