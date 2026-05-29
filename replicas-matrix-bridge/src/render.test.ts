import { describe, expect, it } from "vitest";
import {
	formatCost,
	formatDuration,
	formatToolUseLine,
	parsePlan,
	phaseFor,
	phaseToReactionEmoji,
	render,
	renderPlan,
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
	it("done keeps the rolling log below the Done header", () => {
		const out = render({
			startedAt: Date.now() - 14000,
			stepCount: 6,
			phase: "EDITING",
			lines: ["🔧 <code>ls</code>", "📖 src/index.ts"],
			terminal: { kind: "done", durationSec: 14 },
		});
		expect(out).toContain("🎉 <b>Done</b> · 14s");
		expect(out).toContain("🔧 <code>ls</code>");
		expect(out).toContain("📖 src/index.ts");
	});

	it("done with no rolling content is just the header", () => {
		const out = render({
			startedAt: Date.now() - 3000,
			stepCount: 0,
			phase: "STARTING",
			lines: [],
			terminal: { kind: "done", durationSec: 3 },
		});
		expect(out).toBe("🎉 <b>Done</b> · 3s");
	});

	it("done preserves the plan block too", () => {
		const out = render({
			startedAt: Date.now() - 9000,
			stepCount: 4,
			phase: "RUNNING",
			lines: ["🔧 <code>npm test</code>"],
			plan: { done: 2, total: 3, items: [
				{ done: true, content: "scaffold" },
				{ done: true, content: "wire" },
				{ done: false, content: "test" },
			] },
			terminal: { kind: "done", durationSec: 9 },
		});
		expect(out).toContain("🎉 <b>Done</b> · 9s");
		expect(out).toContain("📋 Plan (2/3)");
		expect(out).toContain("✓ <s>scaffold</s>");
		// First not-done item is marked as the current focus (►), not a
		// pending bullet — matches the focus-window plan rendering.
		expect(out).toContain("► <b>test</b>");
	});

	it("failed shows error + rolling log + plan", () => {
		const out = render({
			startedAt: Date.now() - 8000,
			stepCount: 3,
			phase: "TESTING",
			lines: ["🧪 <code>bun test</code>"],
			terminal: { kind: "failed", durationSec: 8, errorMsg: "exit code 1: tests failed" },
		});
		expect(out).toContain("❌ <b>Failed</b> · 8s");
		expect(out).toContain("<blockquote>exit code 1: tests failed</blockquote>");
		expect(out).toContain("🧪 <code>bun test</code>");
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

describe("parsePlan", () => {
	const sample = [
		"Plan (2/6)",
		"~Round 2 sandbox created (folder + 2 docs + blocks)~",
		"Blocks add/get/update/delete confirmed; retry blocks_move + blocks_revert",
		"~markdown_add OK (text only); image_view needs Craft-hosted URL (external blocked)~",
		"Re-run tasks + comments; retry collections_create, whiteboard_create",
		"Re-run document/documents_search",
		"Cleanup (docs + folder delete)",
	].join("\n");

	it("returns null for non-plan text", () => {
		expect(parsePlan("just regular narration text")).toBeNull();
		expect(parsePlan("")).toBeNull();
	});

	it("extracts the done / total counts from the header", () => {
		const plan = parsePlan(sample);
		expect(plan).not.toBeNull();
		expect(plan!.done).toBe(2);
		expect(plan!.total).toBe(6);
	});

	it("marks tilde-wrapped items as done", () => {
		const plan = parsePlan(sample)!;
		expect(plan.items.length).toBe(6);
		expect(plan.items[0]).toEqual({
			content: "Round 2 sandbox created (folder + 2 docs + blocks)",
			done: true,
		});
		expect(plan.items[1]).toEqual({
			content: "Blocks add/get/update/delete confirmed; retry blocks_move + blocks_revert",
			done: false,
		});
		expect(plan.items[2]).toEqual({
			content: "markdown_add OK (text only); image_view needs Craft-hosted URL (external blocked)",
			done: true,
		});
		expect(plan.items.filter((i) => i.done).length).toBe(2);
	});

	it("tolerates whitespace in the header", () => {
		expect(parsePlan("Plan ( 3 / 8 )\nitem one\n~item two~")?.done).toBe(3);
		expect(parsePlan("Plan ( 3 / 8 )\nitem one\n~item two~")?.total).toBe(8);
	});
});

describe("renderPlan", () => {
	it("renders done items with strikethrough and marks the first undone item as current focus", () => {
		const html = renderPlan({
			done: 1,
			total: 2,
			items: [
				{ content: "do this", done: true },
				{ content: "then this", done: false },
			],
		});
		expect(html).toContain("<b>📋 Plan (1/2)</b>");
		expect(html).toContain("<s>do this</s>");
		// First not-done = current ► (not a pending ◦)
		expect(html).toContain("► <b>then this</b>");
	});

	it("only the FIRST not-done item gets the ► marker; the rest stay ◦", () => {
		const html = renderPlan({
			done: 0,
			total: 3,
			items: [
				{ content: "alpha", done: false },
				{ content: "beta", done: false },
				{ content: "gamma", done: false },
			],
		});
		expect(html).toContain("► <b>alpha</b>");
		expect(html).toContain("◦ beta");
		expect(html).toContain("◦ gamma");
	});

	it("escapes HTML in item content", () => {
		const html = renderPlan({
			done: 0,
			total: 1,
			items: [{ content: "fix <a> tag", done: false }],
		});
		expect(html).toContain("fix &lt;a&gt; tag");
	});
});

describe("render — plan section", () => {
	it("inserts the plan block between currentAction and the rolling lines", () => {
		const out = render({
			startedAt: Date.now() - 14000,
			stepCount: 4,
			phase: "PLANNING",
			currentAction: "<i>Working on the plan</i>",
			plan: {
				done: 1,
				total: 3,
				items: [
					{ content: "scaffold", done: true },
					{ content: "wire it up", done: false },
					{ content: "test", done: false },
				],
			},
			lines: ["🔧 <code>ls</code>"],
		});
		expect(out).toContain("📋 Plan (1/3)");
		expect(out).toContain("<s>scaffold</s>");
		// "wire it up" is the first not-done → marked as current focus.
		expect(out).toContain("► <b>wire it up</b>");
		// "test" stays as a pending bullet — only one ► per render.
		expect(out).toContain("◦ test");
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

describe("render — focus window", () => {
	const tool = (s: string) => `🔧 <code>${s}</code>`;
	const read = (s: string) => `📖 <code>${s}</code>`;
	const out = (s: string) => `<i>↳ ${s}</i>`;
	const err = (s: string) => `<i>✗ ${s}</i>`;

	it("expands the CURRENT op with its ↳ output, indented", () => {
		const lines = [
			read("/some/file.ts"),
			out("file contents excerpt..."),
			tool("git status"),
			out("On branch main"),
		];
		const html = render({
			startedAt: Date.now() - 5000,
			stepCount: 2,
			phase: "RUNNING",
			lines,
		});
		// CURRENT (last tool) keeps both the command + its output line
		expect(html).toContain("git status");
		expect(html).toContain("On branch main");
		// Output is indented (under the tool line)
		expect(html).toMatch(/git status<\/code>.*?&nbsp;.*?On branch main/);
	});

	it("compresses RECENT tool lines (basename + truncation) and drops their non-error output", () => {
		const lines = [
			read("/home/user/.claude.json"),
			out("470 some line content from the file"),
			tool("ls -la /very/long/directory/path"),
			tool("git status"),
		];
		const html = render({
			startedAt: Date.now() - 5000,
			stepCount: 3,
			phase: "RUNNING",
			lines,
		});
		// RECENT read line shows basename only — full path dropped
		expect(html).toContain(".claude.json");
		expect(html).not.toContain("/home/user/.claude.json");
		// Non-error output on RECENT is dropped (only CURRENT keeps ↳ output)
		expect(html).not.toContain("470 some line content");
	});

	it("collapses OLDER ops (4+ ago) into <blockquote expandable> with a count header", () => {
		const lines = [
			read("/file1"),
			read("/file2"),
			read("/file3"),
			read("/file4"),
			tool("ls"),
			tool("pwd"),
			tool("whoami"),
		];
		const html = render({
			startedAt: Date.now() - 5000,
			stepCount: 7,
			phase: "RUNNING",
			lines,
		});
		expect(html).toContain("<blockquote expandable>");
		expect(html).toMatch(/<i>4 earlier ops?<\/i>/);
		// The 3 most-recent ops are above the fold
		expect(html).toContain("whoami");
		expect(html).toContain("pwd");
		expect(html).toContain("ls");
	});

	it("ERROR outputs survive even in RECENT and OLDER tiers (silent failures are the worst hide)", () => {
		const lines = [
			tool("rm -rf /"),
			err("Operation not permitted"),
			tool("ls"),
			tool("pwd"),
			tool("date"),
		];
		const html = render({
			startedAt: Date.now() - 5000,
			stepCount: 5,
			phase: "RUNNING",
			lines,
		});
		// rm error is at OLDER position but must still be visible
		expect(html).toContain("Operation not permitted");
	});
});

describe("Done frame — resultHtml embedding", () => {
	it("embeds the result HTML below the op log so a single message carries the answer", () => {
		const out = render({
			startedAt: Date.now() - 56000,
			stepCount: 0,
			phase: "DONE",
			lines: [],
			terminal: {
				kind: "done",
				durationSec: 56,
				resultHtml: "<p>Yes — found it. <b>Beeper MCP:</b> https://example.com</p>",
			},
		});
		expect(out).toContain("🎉 <b>Done</b> · 56s");
		expect(out).toContain("Yes — found it.");
		expect(out).toContain("<b>Beeper MCP:</b>");
		expect(out).toContain("https://example.com");
	});

	it("text-only Done frame is no longer empty — header + subtitle + body all in one message", () => {
		const out = render({
			startedAt: Date.now() - 18000,
			stepCount: 0,
			phase: "DONE",
			lines: [],
			systemInfo: { model: "claude-opus-4-7", mcpCount: 13, mcpActive: 7, toolCount: 181 },
			resultMeta: { costUsd: 1.0222, inputTokens: 50, outputTokens: 320 },
			terminal: {
				kind: "done",
				durationSec: 18,
				resultHtml: "<p>Did I find what?</p>",
			},
		});
		// Header has the new cost format
		expect(out).toContain("$1.02");
		expect(out).not.toContain("$1.0222");
		// Subtitle is present
		expect(out).toContain("Opus 4.7");
		expect(out).toContain("7/13 MCP");
		// Body is embedded — the user actually SEES the answer in the Done frame
		expect(out).toContain("Did I find what?");
	});

	it("failed turn never embeds resultHtml — only the errorMsg", () => {
		const out = render({
			startedAt: Date.now() - 8000,
			stepCount: 0,
			phase: "FAILED",
			lines: [],
			terminal: {
				kind: "failed",
				durationSec: 8,
				errorMsg: "agent error: rate limited",
				// Even if a caller accidentally passes resultHtml on a failed
				// turn, it must NOT appear (we keep the failure surface clean).
				resultHtml: "<p>This should not appear.</p>",
			},
		});
		expect(out).toContain("❌ <b>Failed</b>");
		expect(out).toContain("agent error: rate limited");
		expect(out).not.toContain("This should not appear");
	});
});

describe("formatCost", () => {
	it("rounds to 2 decimals for normal range", () => {
		expect(formatCost(0.07811774999999999)).toBe("$0.08");
		expect(formatCost(0.92322625)).toBe("$0.92");
	});
	it("shows <$0.01 below one cent instead of $0.00", () => {
		expect(formatCost(0.005)).toBe("<$0.01");
		expect(formatCost(0.009)).toBe("<$0.01");
	});
	it("returns empty for zero/negative", () => {
		expect(formatCost(0)).toBe("");
		expect(formatCost(-1)).toBe("");
	});
	it("drops decimals once we're past $10", () => {
		expect(formatCost(12.456)).toBe("$12");
		expect(formatCost(1.42)).toBe("$1.42");
	});
});
