import { describe, expect, it } from "vitest";
import {
	formatDuration,
	formatToolUseLine,
	phaseFor,
	phaseToReactionEmoji,
	render,
	thinkingLine,
} from "./render";

describe("phaseFor", () => {
	it("maps Read/Grep/Glob to PLANNING", () => {
		expect(phaseFor("Read", undefined)).toBe("PLANNING");
		expect(phaseFor("Grep", undefined)).toBe("PLANNING");
		expect(phaseFor("Glob", undefined)).toBe("PLANNING");
		expect(phaseFor("WebFetch", undefined)).toBe("PLANNING");
	});
	it("maps Edit/Write/NotebookEdit to EDITING", () => {
		expect(phaseFor("Edit", undefined)).toBe("EDITING");
		expect(phaseFor("Write", undefined)).toBe("EDITING");
		expect(phaseFor("NotebookEdit", undefined)).toBe("EDITING");
	});
	it("recognizes test runners as TESTING", () => {
		expect(phaseFor("Bash", "bun test")).toBe("TESTING");
		expect(phaseFor("Bash", "npm test -- --watch")).toBe("TESTING");
		expect(phaseFor("Bash", "pytest tests/")).toBe("TESTING");
		expect(phaseFor("Bash", "vitest run")).toBe("TESTING");
	});
	it("recognizes deploy commands as SHIPPING", () => {
		expect(phaseFor("Bash", "gh pr create")).toBe("SHIPPING");
		expect(phaseFor("Bash", "git push origin main")).toBe("SHIPPING");
		expect(phaseFor("Bash", "wrangler deploy")).toBe("SHIPPING");
		expect(phaseFor("Bash", "fly deploy --remote-only")).toBe("SHIPPING");
	});
	it("defaults Bash to RUNNING", () => {
		expect(phaseFor("Bash", "ls -la")).toBe("RUNNING");
		expect(phaseFor("Bash", undefined)).toBe("RUNNING");
	});
});

describe("formatToolUseLine", () => {
	it("formats Bash with $ prefix", () => {
		expect(formatToolUseLine("Bash", { command: "ls" })).toBe("<code>🔧 $ ls</code>");
	});
	it("formats Read with file_path", () => {
		expect(formatToolUseLine("Read", { file_path: "src/index.ts" })).toBe(
			"<code>📖 src/index.ts</code>",
		);
	});
	it("formats Edit with file_path", () => {
		expect(formatToolUseLine("Edit", { file_path: "src/server.ts" })).toContain("src/server.ts");
	});
	it("formats Grep with pattern", () => {
		expect(formatToolUseLine("Grep", { pattern: "TODO" })).toBe("<code>🔍 grep TODO</code>");
	});
	it("formats WebFetch with url", () => {
		expect(formatToolUseLine("WebFetch", { url: "https://example.com" })).toBe(
			"<code>🌐 https://example.com</code>",
		);
	});
	it("formats unknown MCP tool with namespace strip", () => {
		expect(formatToolUseLine("mcp__replicas__create_replica", {})).toBe(
			"<code>🧰 replicas__create_replica</code>",
		);
	});
	it("HTML-escapes file paths with angle brackets", () => {
		expect(formatToolUseLine("Read", { file_path: "src/<weird>" })).toContain("&lt;weird&gt;");
	});
});

describe("thinkingLine", () => {
	it("wraps in italic with thinking emoji", () => {
		expect(thinkingLine("planning the change")).toBe("<i>🤔 planning the change</i>");
	});
	it("collapses newlines into spaces", () => {
		expect(thinkingLine("line one\nline two")).toContain("line one line two");
	});
	it("escapes HTML", () => {
		expect(thinkingLine("use <foo>")).toContain("&lt;foo&gt;");
	});
});

describe("render", () => {
	it("renders a starting state with task header", () => {
		const out = render({
			startedAt: Date.now(),
			stepCount: 0,
			phase: "STARTING",
			userText: "deploy the api",
			lines: [],
		});
		expect(out).toContain("🤔 STARTING");
		expect(out).toContain("<i>Task:</i> deploy the api");
		expect(out).toContain("⏱");
	});

	it("renders a running state with step counter and current action", () => {
		const out = render({
			startedAt: Date.now() - 14000,
			stepCount: 3,
			phase: "PLANNING",
			currentAction: "<code>🔧 $ ls -la src/</code>",
			lines: ["<code>📖 src/index.ts</code>"],
		});
		expect(out).toContain("📋 PLANNING");
		expect(out).toContain("step 3");
		expect(out).toContain("ls -la");
	});

	it("collapses older steps into an expandable blockquote when many lines exist", () => {
		const lines = Array.from({ length: 12 }, (_, i) => `<code>step ${i}</code>`);
		const out = render({
			startedAt: Date.now(),
			stepCount: 12,
			phase: "EDITING",
			lines,
		});
		expect(out).toContain("<blockquote expandable>");
		expect(out).toContain("step 11"); // most recent visible
		expect(out).toContain("step 7"); // oldest of the recent window (12 - 4 = 8 onward)
	});

	it("renders a DONE terminal state without current action", () => {
		const out = render({
			startedAt: Date.now() - 14000,
			stepCount: 6,
			phase: "EDITING",
			lines: ["<code>step 1</code>"],
			terminal: { kind: "done", durationSec: 14 },
		});
		expect(out).toContain("🎉 DONE");
		expect(out).toContain("14s");
		expect(out).not.toContain("step 6"); // no step counter in terminal
	});

	it("renders a FAILED terminal state with error blockquote", () => {
		const out = render({
			startedAt: Date.now() - 8000,
			stepCount: 3,
			phase: "TESTING",
			lines: ["<code>step</code>"],
			terminal: { kind: "failed", durationSec: 8, errorMsg: "exit code 1: tests failed" },
		});
		expect(out).toContain("❌ FAILED");
		expect(out).toContain("<blockquote>exit code 1: tests failed</blockquote>");
	});
});

describe("formatDuration", () => {
	it("renders seconds under a minute", () => {
		expect(formatDuration(14)).toBe("14s");
		expect(formatDuration(59)).toBe("59s");
	});
	it("renders minutes and seconds over a minute", () => {
		expect(formatDuration(60)).toBe("1m 0s");
		expect(formatDuration(102)).toBe("1m 42s");
	});
});

describe("phaseToReactionEmoji", () => {
	it("maps each phase to a bot-allowed standard reaction emoji", () => {
		expect(phaseToReactionEmoji("STARTING")).toBe("👀");
		expect(phaseToReactionEmoji("PLANNING")).toBe("🤔");
		expect(phaseToReactionEmoji("EDITING")).toBe("✍️");
		expect(phaseToReactionEmoji("DONE")).toBe("🎉");
		expect(phaseToReactionEmoji("FAILED")).toBe("😭");
	});
});
