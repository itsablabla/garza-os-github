import { describe, expect, it } from "vitest";
import { splitMarkdownReply } from "./split-reply";

describe("splitMarkdownReply", () => {
	it("returns a single chunk for short replies", () => {
		const out = splitMarkdownReply("Hello world");
		expect(out).toEqual(["Hello world"]);
	});

	it("returns an empty array for empty input", () => {
		expect(splitMarkdownReply("")).toEqual([]);
		expect(splitMarkdownReply("   \n   ")).toEqual([]);
	});

	it("respects per-chunk char cap", () => {
		const para = "x".repeat(2000);
		const md = `${para}\n\n${para}\n\n${para}`;
		const out = splitMarkdownReply(md, { maxChars: 2500 });
		expect(out.length).toBe(3);
		for (const chunk of out) expect(chunk.length).toBeLessThanOrEqual(2500);
	});

	it("packs small paragraphs together up to the cap", () => {
		const md = "Para A.\n\nPara B.\n\nPara C.";
		const out = splitMarkdownReply(md, { maxChars: 1000 });
		expect(out.length).toBe(1);
		expect(out[0]).toContain("Para A.");
		expect(out[0]).toContain("Para B.");
		expect(out[0]).toContain("Para C.");
	});

	it("never splits a fenced code block", () => {
		const code = ["```ts", "x".repeat(500), "y".repeat(500), "```"].join("\n");
		const md = `Intro paragraph.\n\n${code}\n\nOutro paragraph.`;
		const out = splitMarkdownReply(md, { maxChars: 700 });
		// The code block lands in exactly one chunk.
		const codeChunkCount = out.filter((c) => c.includes("```ts")).length;
		expect(codeChunkCount).toBe(1);
		const codeChunk = out.find((c) => c.includes("```ts"))!;
		expect(codeChunk.endsWith("```")).toBe(true);
	});

	it("keeps a heading with its following block", () => {
		const md = "# Big Title\n\nFirst paragraph that follows the heading.";
		const out = splitMarkdownReply(md, { maxChars: 1000 });
		expect(out.length).toBe(1);
		expect(out[0]).toContain("# Big Title");
		expect(out[0]).toContain("First paragraph");
	});

	it("attaches a heading to the next block even when current is at cap", () => {
		const longPara = "x".repeat(2000);
		const md = `${longPara}\n\n## Section Header\n\nFollowing content.`;
		const out = splitMarkdownReply(md, { maxChars: 2200 });
		// The header should be in the same chunk as "Following content."
		const headerChunk = out.find((c) => c.includes("## Section Header"));
		expect(headerChunk).toBeDefined();
		expect(headerChunk!).toContain("Following content.");
	});

	it("keeps a bulleted list together as one block", () => {
		const md = [
			"Choices:",
			"",
			"- option one",
			"- option two",
			"- option three",
			"",
			"Pick wisely.",
		].join("\n");
		const out = splitMarkdownReply(md, { maxChars: 1000 });
		expect(out.length).toBe(1);
		expect(out[0]).toMatch(/option one[\s\S]*option two[\s\S]*option three/);
	});

	it("ships an oversize block alone as a single chunk", () => {
		const huge = "z".repeat(5000);
		const md = `Tiny intro.\n\n${huge}\n\nTiny outro.`;
		const out = splitMarkdownReply(md, { maxChars: 1000 });
		// Intro, oversize-as-its-own-chunk, outro.
		expect(out.length).toBe(3);
		expect(out[0]).toBe("Tiny intro.");
		expect(out[1]).toBe(huge);
		expect(out[2]).toBe("Tiny outro.");
	});

	it("matches the realistic 'long answer' shape — splits into multiple chunks on natural boundaries", () => {
		const md = [
			"Reviewed all Beeper chats/groups with activity since 15:50 UTC across all 10 connected accounts (WhatsApp, Signal, Telegram, Slack, Instagram, LinkedIn, Matrix). No Amazon OTP anywhere — the only WhatsApp unread is from \"Andy\" dated April. The WhatsApp account linked to Beeper is +13035001234 (ends in 234), not the 123 number Amazon is messaging.",
			"",
			"There is no autonomous path left. To proceed I need you to paste the actual 6-digit code from either:",
			"",
			"- The WhatsApp on the (210) 941-0123 device, or",
			"- An Authenticator app for jadenorders@pm.me",
			"",
			"Or share a delivery ZIP to browse as a guest.",
		].join("\n");
		// First paragraph alone is ~360 chars; at maxChars=300 it ships alone.
		const out = splitMarkdownReply(md, { maxChars: 300 });
		expect(out.length).toBeGreaterThanOrEqual(2);
		expect(out[0]).toContain("Reviewed all Beeper");
		// Bulleted list should not be split across chunks.
		const listChunk = out.find((c) => c.includes("(210) 941-0123"));
		expect(listChunk).toBeDefined();
		expect(listChunk!).toContain("Authenticator app");
	});
});
