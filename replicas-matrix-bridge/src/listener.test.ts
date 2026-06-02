import { describe, expect, it } from "vitest";
import { isDedicatedBotRoomName, isPlainTextWakeWord } from "./listener";

describe("isPlainTextWakeWord", () => {
	it("matches the bot name at the start of the body", () => {
		expect(isPlainTextWakeWord("Jada do this thing", "Jada")).toBe(true);
	});

	it("matches with optional @ prefix", () => {
		expect(isPlainTextWakeWord("@Jada do this", "Jada")).toBe(true);
	});

	it("is case-insensitive", () => {
		expect(isPlainTextWakeWord("JADA do this", "Jada")).toBe(true);
		expect(isPlainTextWakeWord("jada do this", "Jada")).toBe(true);
		expect(isPlainTextWakeWord("jAdA hello", "Jada")).toBe(true);
	});

	it("tolerates leading whitespace", () => {
		expect(isPlainTextWakeWord("  Jada hello", "Jada")).toBe(true);
		expect(isPlainTextWakeWord("\tJada hello", "Jada")).toBe(true);
	});

	it("requires a word boundary so substrings don't false-positive", () => {
		// The bug we ship after this: a chat title or autocomplete that
		// happens to begin with the name should not wake the bot.
		expect(isPlainTextWakeWord("jadaphone is cool", "Jada")).toBe(false);
		expect(isPlainTextWakeWord("Jadaesque thing", "Jada")).toBe(false);
		expect(isPlainTextWakeWord("Jada42 is invalid", "Jada")).toBe(false);
	});

	it("does not match the name in the middle of the body", () => {
		expect(isPlainTextWakeWord("I told Jada earlier", "Jada")).toBe(false);
		expect(isPlainTextWakeWord("send this to @Jada later", "Jada")).toBe(false);
		expect(isPlainTextWakeWord("question: Jada do you know", "Jada")).toBe(false);
	});

	it("treats Jada followed by common punctuation as a wake", () => {
		expect(isPlainTextWakeWord("Jada, please help", "Jada")).toBe(true);
		expect(isPlainTextWakeWord("Jada: do this", "Jada")).toBe(true);
		expect(isPlainTextWakeWord("Jada!", "Jada")).toBe(true);
		expect(isPlainTextWakeWord("Jada?", "Jada")).toBe(true);
		expect(isPlainTextWakeWord("Jada.", "Jada")).toBe(true);
	});

	it("supports a multi-word display name", () => {
		// If you ever rename the bot to "Lord Garza", configure
		// MATRIX_DISPLAY_NAME and the gate still works.
		expect(isPlainTextWakeWord("Lord Garza handle this", "Lord Garza")).toBe(true);
		expect(isPlainTextWakeWord("lord garza handle this", "Lord Garza")).toBe(true);
		expect(isPlainTextWakeWord("Lord do this", "Lord Garza")).toBe(false);
	});

	it("returns false for empty body", () => {
		expect(isPlainTextWakeWord("", "Jada")).toBe(false);
	});

	it("returns false for empty display name", () => {
		expect(isPlainTextWakeWord("Jada hi", "")).toBe(false);
	});

	it("escapes regex special characters in the display name", () => {
		// Defensive — a misconfigured display name with a `.` or `*`
		// should not silently become a wildcard match.
		expect(isPlainTextWakeWord("Bot.Name hello", "Bot.Name")).toBe(true);
		expect(isPlainTextWakeWord("BotXName hello", "Bot.Name")).toBe(false);
	});

	it("matches a single-character display name with a word boundary", () => {
		expect(isPlainTextWakeWord("J handle this", "J")).toBe(true);
		expect(isPlainTextWakeWord("Jada handle this", "J")).toBe(false); // word boundary after "J"
	});
});

describe("isDedicatedBotRoomName", () => {
	it("matches Agent Maker's Beeper and Matrix room names", () => {
		expect(isDedicatedBotRoomName("Agent Maker")).toBe(true);
		expect(isDedicatedBotRoomName("Project Maker")).toBe(true);
	});

	it("keeps existing dedicated bot room names working", () => {
		expect(isDedicatedBotRoomName("Security Manager")).toBe(true);
		expect(isDedicatedBotRoomName("Langbot Garza Bots")).toBe(true);
		expect(isDedicatedBotRoomName("Replicas Bridge")).toBe(true);
	});

	it("does not match ordinary small group names", () => {
		expect(isDedicatedBotRoomName("Jaden and Jessica")).toBe(false);
		expect(isDedicatedBotRoomName("Nomad Office")).toBe(false);
	});
});
