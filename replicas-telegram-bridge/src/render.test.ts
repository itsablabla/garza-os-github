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
	it("maps Read/Grep/Glob/WebFetch to PLANNING", () => {
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
	it("places emoji outside <code> so monospace only wraps the command", () => {
		expect(formatToolUseLine("Bash", { command: "ls -la" })).toBe(
			"🔧 <code>ls -la</code>",
		);
	});
	it("formats Read with file_path", () => {
		expect(formatToolUseLine("Read", { file_path: "src/index.ts" })).toBe(
			"📖 <code>src/index.ts</code>",
		);
	});
	it("uses ✏️ for Edit", () => {
		expect(formatToolUseLine("Edit", { file_path: "src/server.ts" })).toBe(
			"✏️ <code>src/server.ts</code>",
		);
	});
	it("uses ✍️ for Write", () => {
		expect(formatToolUseLine("Write", { file_path: "new/file.ts" })).toBe(
			"✍️ <code>new/file.ts</code>",
		);
	});
	it("formats Grep with grep prefix inside <code>", () => {
		expect(formatToolUseLine("Grep", { pattern: "TODO" })).toBe(
			"🔍 <code>grep TODO</code>",
		);
	});
	it("formats WebFetch with url", () => {
		expect(formatToolUseLine("WebFetch", { url: "https://example.com" })).toBe(
			"🌐 <code>https://example.com</code>",
		);
	});
	it("formats unknown MCP tool with 🧰 and namespace strip", () => {
		expect(formatToolUseLine("mcp__replicas__create_replica", {})).toBe(
			"🧰 <code>replicas__create_replica</code>",
		);
	});
	it("HTML-escapes paths with angle brackets", () => {
		expect(formatToolUseLine("Read", { file_path: "src/<weird>" })).toContain("&lt;weird&gt;");
	});
});

describe("thinkingLine", () => {
	it("wraps in italic with no leading emoji (header already shows phase)", () => {
		expect(thinkingLine("planning the change")).toBe("<i>planning the change</i>");
	});
	it("collapses newlines into spaces", () => {
		expect(thinkingLine("line one\nline two")).toContain("line one line two");
	});
	it("escapes HTML", () => {
		expect(thinkingLine("use <foo>")).toContain("&lt;foo&gt;");
	});
});

describe("render — active state", () => {
	it("starting state shows just the phase header with elapsed time", () => {
		const out = render({
			startedAt: Date.now(),
			stepCount: 0,
			phase: "STARTING",
			userText: "deploy the api",
			lines: [],
		});
		expect(out).toBe("🤔 <b>Starting</b> · 0s");
		// Crucially does NOT repeat the user prompt — the message is a reply
		// to it in Telegram, so the prompt is already visible above.
		expect(out).not.toContain("deploy the api");
	});

	it("planning state with thinking preview puts italic line under header", () => {
		const out = render({
			startedAt: Date.now() - 14000,
			stepCount: 0,
			phase: "PLANNING",
			currentAction: "<i>reading the codebase</i>",
			lines: [],
		});
		expect(out).toContain("📋 <b>Planning</b>");
		expect(out).toContain("<i>reading the codebase</i>");
	});

	it("running state with step counter and tool lines", () => {
		const out = render({
			startedAt: Date.now() - 14000,
			stepCount: 3,
			phase: "RUNNING",
			lines: [
				"🔧 <code>ls -la src/</code>",
				"📖 <code>src/index.ts</code>",
				"✏️ <code>src/server.ts</code>",
			],
		});
		expect(out).toContain("🔧 <b>Running</b> · step 3 · 14s");
		expect(out).toContain("ls -la src/");
		expect(out).toContain("src/server.ts");
	});

	it("collapses older steps into expandable blockquote when many lines exist", () => {
		const lines = Array.from({ length: 12 }, (_, i) => `📖 <code>step ${i}</code>`);
		const out = render({
			startedAt: Date.now(),
			stepCount: 12,
			phase: "EDITING",
			lines,
		});
		expect(out).toContain("<blockquote expandable>");
		expect(out).toContain("step 11"); // most recent visible
		expect(out).toContain("step 7"); // first of the recent window (12 - 4 = 8)
	});
});

describe("render — terminal state", () => {
	it("done collapses to one line", () => {
		const out = render({
			startedAt: Date.now() - 14000,
			stepCount: 6,
			phase: "EDITING",
			lines: ["🔧 <code>ls</code>"],
			terminal: { kind: "done", durationSec: 14 },
		});
		expect(out).toBe("🎉 <b>Done</b> · 14s");
	});

	it("failed shows error in a blockquote", () => {
		const out = render({
			startedAt: Date.now() - 8000,
			stepCount: 3,
			phase: "TESTING",
			lines: ["🧪 <code>bun test</code>"],
			terminal: { kind: "failed", durationSec: 8, errorMsg: "exit code 1: tests failed" },
		});
		expect(out).toContain("❌ <b>Failed</b> · 8s");
		expect(out).toContain("<blockquote>exit code 1: tests failed</blockquote>");
	});

	it("failed without errorMsg still renders cleanly", () => {
		const out = render({
			startedAt: Date.now() - 5000,
			stepCount: 1,
			phase: "RUNNING",
			lines: [],
			terminal: { kind: "failed", durationSec: 5 },
		});
		expect(out).toBe("❌ <b>Failed</b> · 5s");
	});
});

describe("formatDuration", () => {
	it("renders seconds under a minute as Ns", () => {
		expect(formatDuration(14)).toBe("14s");
		expect(formatDuration(59)).toBe("59s");
	});
	it("renders minutes and seconds as M:SS", () => {
		expect(formatDuration(60)).toBe("1:00");
		expect(formatDuration(102)).toBe("1:42");
		expect(formatDuration(605)).toBe("10:05");
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
