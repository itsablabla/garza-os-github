import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatVoiceDuration, transcribeAudio } from "./transcribe";

describe("formatVoiceDuration", () => {
	it("formats sub-minute durations as Ns", () => {
		expect(formatVoiceDuration(4200)).toBe("4s");
		expect(formatVoiceDuration(999)).toBe("1s");
		expect(formatVoiceDuration(0)).toBe("0s");
	});
	it("formats >=1 minute durations as Nm Ss", () => {
		expect(formatVoiceDuration(60_000)).toBe("1m");
		expect(formatVoiceDuration(75_000)).toBe("1m 15s");
		expect(formatVoiceDuration(180_000)).toBe("3m");
	});
});

describe("transcribeAudio", () => {
	const origFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
	});
	afterEach(() => {
		globalThis.fetch = origFetch;
	});

	it("returns provider:'none' when OPENAI_API_KEY is unset", async () => {
		const res = await transcribeAudio({}, new ArrayBuffer(8), "x.ogg", "audio/ogg");
		expect(res.ok).toBe(false);
		expect(res.provider).toBe("none");
		expect(res.error).toContain("OPENAI_API_KEY");
	});

	it("returns ok+text on 200 from Whisper", async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			new Response(JSON.stringify({ text: "Hello world" }), { status: 200 }),
		);
		const res = await transcribeAudio(
			{ OPENAI_API_KEY: "sk-test" },
			new ArrayBuffer(16),
			"v.ogg",
			"audio/ogg",
		);
		expect(res.ok).toBe(true);
		expect(res.text).toBe("Hello world");
		expect(res.provider).toBe("openai-whisper");
	});

	it("returns error on non-2xx from Whisper", async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			new Response("rate limited", { status: 429 }),
		);
		const res = await transcribeAudio(
			{ OPENAI_API_KEY: "sk-test" },
			new ArrayBuffer(16),
			"v.ogg",
			"audio/ogg",
		);
		expect(res.ok).toBe(false);
		expect(res.error).toContain("429");
	});

	it("rejects audio over 25MB without calling Whisper", async () => {
		const huge = new ArrayBuffer(26 * 1024 * 1024);
		const res = await transcribeAudio(
			{ OPENAI_API_KEY: "sk-test" },
			huge,
			"v.ogg",
			"audio/ogg",
		);
		expect(res.ok).toBe(false);
		expect(res.error).toContain("too large");
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it("treats empty transcript as a failure", async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			new Response(JSON.stringify({ text: "   " }), { status: 200 }),
		);
		const res = await transcribeAudio(
			{ OPENAI_API_KEY: "sk-test" },
			new ArrayBuffer(16),
			"v.ogg",
			"audio/ogg",
		);
		expect(res.ok).toBe(false);
		expect(res.error).toContain("empty");
	});
});
