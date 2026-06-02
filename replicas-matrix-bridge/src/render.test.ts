import { describe, expect, it } from "vitest";
import {
	formatCost,
	renderToolsHeader,
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
		// Heartbeat dot prefixes the phase emoji and rotates each tick.
		// For elapsedSec=0 the frame is the first quadrant glyph (◐).
		expect(out).toBe("◐ 🤔 <b>Starting</b> · 0s");
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
		expect(out).toContain("<blockquote>");
		expect(out).toContain("</blockquote>");
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

	it("heartbeat dot advances by one frame per elapsed second", () => {
		const out0 = render({
			startedAt: Date.now(),
			stepCount: 0,
			phase: "STARTING",
			lines: [],
		});
		const out1 = render({
			startedAt: Date.now() - 1000,
			stepCount: 0,
			phase: "STARTING",
			lines: [],
		});
		// Two consecutive seconds must produce different heartbeat frames
		// so the user always sees the pane moving even when nothing else
		// changes.
		const frame0 = out0.split(" ")[0];
		const frame1 = out1.split(" ")[0];
		expect(frame0).not.toBe(frame1);
	});

	it("active 🔄 tool line gets a live elapsed tail from activeToolStartedAt", () => {
		const out = render({
			startedAt: Date.now() - 30_000,
			stepCount: 1,
			phase: "RUNNING",
			lines: ["🔄 🧰 <code>e2b__run_code</code>"],
			activeToolStartedAt: Date.now() - 7_500,
		});
		expect(out).toContain("🔄 🧰 <b>MCP</b> · <code>e2b__run_code</code>");
		// Renderer appends ` · Ns` to the last 🔄 line so a slow tool
		// visibly times instead of looking frozen.
		expect(out).toMatch(/🔄 🧰 <b>MCP<\/b> · <code>e2b__run_code<\/code> <i>· [78]s<\/i>/);
	});

	it("segmentStartLine slices the rolling log to the current segment", () => {
		const lines = [
			"🔧 <code>step 0 (sealed)</code>",
			"🔧 <code>step 1 (sealed)</code>",
			"🔧 <code>step 2 (sealed)</code>",
			"🔧 <code>step 3 (current)</code>",
			"🔧 <code>step 4 (current)</code>",
		];
		const out = render({
			startedAt: Date.now() - 10_000,
			stepCount: 5,
			phase: "RUNNING",
			lines,
			segmentStartLine: 3,
		});
		expect(out).toContain("step 3 (current)");
		expect(out).toContain("step 4 (current)");
		// Lines before segmentStartLine were rendered in earlier (sealed)
		// Matrix messages — they must NOT re-appear in the active frame.
		expect(out).not.toContain("step 0 (sealed)");
		expect(out).not.toContain("step 1 (sealed)");
		expect(out).not.toContain("step 2 (sealed)");
	});

	it("steered prompt (💬 You: …) opens a fresh segment with no prior tools visible", () => {
		// Simulates the post-steer state: prior segment had 4 tool calls
		// (now sealed in their own message), the new segment opens with
		// the user's steered prompt and is empty of tools.
		const lines = [
			"🔧 <code>prior step 0</code>",
			"🔧 <code>prior step 1</code>",
			"🔧 <code>prior step 2</code>",
			"🔧 <code>prior step 3</code>",
			"💬 <i>You: actually look at the other repo instead</i>",
		];
		const out = render({
			startedAt: Date.now() - 30_000,
			stepCount: 4,
			phase: "RUNNING",
			lines,
			segmentStartLine: 4, // the 💬 line is the first line of the new segment
		});
		expect(out).toContain("💬 <i>You: actually look at the other repo instead</i>");
		// Prior segment's tool lines must NOT appear in the new active frame.
		expect(out).not.toContain("prior step 0");
		expect(out).not.toContain("prior step 3");
		// Tools header should reflect THIS segment (0 tools so far), not 4.
		expect(out).not.toContain("Tools (4");
	});

	it("sealing flag appends a dotted-trail '▶ continues' tail", () => {
		const out = render({
			startedAt: Date.now() - 10_000,
			stepCount: 12,
			phase: "RUNNING",
			lines: ["🔧 <code>last-tool-in-segment</code>"],
			sealing: true,
		});
		expect(out).toContain("continues");
		expect(out).toContain("▶");
		// Thin dotted trail (┄┄┄┄┄) breathes off the end of the message
		// rather than ending abruptly — sealed segments read as one
		// continuous turn flowing across multiple messages.
		expect(out).toContain("┄");
	});

	it("activeToolStartedAt does NOT mutate completed ✅ lines", () => {
		const out = render({
			startedAt: Date.now() - 30_000,
			stepCount: 2,
			phase: "RUNNING",
			lines: ["✅ 🧰 <code>e2b__run_code</code> <i>(1.2s)</i>", "🔄 🧰 <code>e2b__run_code</code>"],
			activeToolStartedAt: Date.now() - 3_000,
		});
		// First line untouched
		expect(out).toContain("✅ 🧰 <b>MCP</b> · <code>e2b__run_code</code> <i>(1.2s)</i>");
		// Second (last 🔄) line gets the tail
		expect(out).toMatch(/🔄 🧰 <b>MCP<\/b> · <code>e2b__run_code<\/code> <i>· [23]s<\/i>/);
	});
});

describe("render — terminal state", () => {
	it("done keeps the rolling log below the Done header", () => {
		// Lines now ship with a 🔄/✅/❌ lifecycle prefix (see PR #14 in
		// the bridges thread). Lines that have any lifecycle prefix mark
		// the turn as non-text-only so the rolling log is preserved.
		const out = render({
			startedAt: Date.now() - 14000,
			stepCount: 6,
			phase: "EDITING",
			lines: ["✅ 🔧 <code>ls</code>", "✅ 📖 src/index.ts"],
			terminal: { kind: "done", durationSec: 14 },
		});
		expect(out).toContain("🎉 <b>Done</b> · 14s");
		expect(out).toContain("🔧 <b>Bash</b><br><code>ls</code>");
		expect(out).toContain("src/index.ts");
	});

	it("renders tool output previews as labeled detail rows inside the tool block", () => {
		const out = render({
			startedAt: Date.now() - 4000,
			stepCount: 1,
			phase: "DONE",
			lines: ["✅ 📖 <code>/etc/hostname</code> <i>(0.0s)</i>", "<i>↳ e2b.local</i>"],
			terminal: { kind: "done", durationSec: 4 },
		});
		expect(out).toContain("📋 <b>Tools</b> <code>1/1</code> ✅");
		expect(out).toContain("<blockquote>");
		expect(out).toContain("✅ 📖 <b>Read</b> · <code>/etc/hostname</code> <i>(0.0s)</i>");
		expect(out).toContain("↳ <b>output</b> · <code>e2b.local</code>");
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

describe("Done frame — result is its own message block", () => {
	it("Done frame does NOT embed resultHtml (poller sends it as a separate message)", () => {
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
		// Per UX review: the reply lives in its OWN message block sent
		// by the poller. The Done frame is just the status summary.
		expect(out).not.toContain("Yes — found it.");
		expect(out).not.toContain("<b>Beeper MCP:</b>");
		expect(out).not.toContain("https://example.com");
	});

	it("text-only Done frame is the status summary, body lives in a follow-up message", () => {
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
		// Per-turn $ removed for subscription-account framing — Done
		// header is duration + tokens only. The dollar figure used to
		// appear here but doesn't anymore.
		expect(out).not.toContain("$1.02");
		expect(out).not.toContain("$1.0222");
		expect(out).toContain("370 tok"); // 50 + 320
		// Subtitle is present
		expect(out).toContain("Opus 4.7");
		expect(out).toContain("7/13 MCP");
		// Body is NO LONGER embedded — the poller sends a separate
		// message for the reply right after this Done frame lands.
		expect(out).not.toContain("Did I find what?");
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

describe("renderUsageWindows", () => {
	it("renders % left for both windows with (est) tag when quotas are configured", () => {
		// 47k consumed against a 5M quota → 99% left.
		// 215k consumed against a 100M quota → 100% left (rounds up).
		// (est) tag is honest about the source — bridge-side estimate,
		// not Anthropic's remaining-tokens header (which Replicas doesn't
		// expose).
		const out = render({
			startedAt: Date.now() - 5000,
			stepCount: 0,
			phase: "STARTING",
			lines: [],
			usageWindows: {
				tok5h: 47_000,
				tok7d: 215_000,
				cost5h: 0,
				cost7d: 0,
				pct5hLeft: 99,
				pct7dLeft: 100,
			},
		});
		expect(out).toContain("🪙");
		expect(out).toContain("5h: 99% left (est)");
		expect(out).toContain("7d: 100% left (est)");
		// No raw token figure in the rendered fragment when % is present.
		expect(out).not.toContain("47k tok");
	});

	it("renders the real Anthropic resetsAt as a 'resets in' tail", () => {
		// resetsAt 1h 18m in the future.
		const resetsAt = Date.now() + (1 * 60 * 60 * 1000 + 18 * 60 * 1000);
		const out = render({
			startedAt: Date.now() - 5000,
			stepCount: 0,
			phase: "STARTING",
			lines: [],
			usageWindows: {
				tok5h: 47_000,
				tok7d: 215_000,
				cost5h: 0,
				cost7d: 0,
				pct5hLeft: 99,
				pct7dLeft: 100,
				resetsAt,
			},
		});
		expect(out).toMatch(/resets in 1h 1[78]m/);
	});

	it("falls back to absolute tokens when quotas are not configured", () => {
		const out = render({
			startedAt: Date.now() - 5000,
			stepCount: 0,
			phase: "STARTING",
			lines: [],
			usageWindows: { tok5h: 47_000, tok7d: 215_000, cost5h: 0, cost7d: 0 },
		});
		expect(out).toContain("🪙");
		expect(out).toContain("5h: 47k tok");
		expect(out).toContain("7d: 215k tok");
	});

	it("hides the usage line when both windows are zero and no quota set", () => {
		const out = render({
			startedAt: Date.now() - 5000,
			stepCount: 0,
			phase: "STARTING",
			lines: [],
			usageWindows: { tok5h: 0, tok7d: 0, cost5h: 0, cost7d: 0 },
		});
		expect(out).not.toContain("🪙");
	});

	it("clamps to 0% left when consumption exceeds quota", () => {
		const out = render({
			startedAt: Date.now() - 5000,
			stepCount: 0,
			phase: "STARTING",
			lines: [],
			usageWindows: {
				tok5h: 6_000_000,
				tok7d: 0,
				cost5h: 0,
				cost7d: 0,
				pct5hLeft: 0,
			},
		});
		expect(out).toContain("5h: 0% left");
	});

	it("formats M (millions) for very large absolute token totals in fallback", () => {
		const out = render({
			startedAt: Date.now() - 5000,
			stepCount: 0,
			phase: "STARTING",
			lines: [],
			usageWindows: { tok5h: 312_000, tok7d: 2_100_000, cost5h: 0, cost7d: 0 },
		});
		expect(out).toContain("312k tok");
		expect(out).toContain("2.1M tok");
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

describe("renderToolsHeader", () => {
	const run = (s: string) => `🔄 ${s}`;
	const ok = (s: string) => `✅ ${s}`;
	const err = (s: string) => `❌ ${s}`;
	const tool = (s: string) => `🔧 <code>${s}</code>`;

	it("returns empty when there are no tool lines", () => {
		expect(renderToolsHeader([])).toBe("");
		expect(renderToolsHeader(["💬 some narration", "<i>↳ standalone output</i>"])).toBe("");
	});

	it("counts running tools toward the total but not the done count", () => {
		const lines = [run(tool("ls")), run(tool("pwd"))];
		expect(renderToolsHeader(lines)).toBe("📋 <b>Tools</b> <code>0/2</code>");
	});

	it("counts both ✅ and ❌ as done", () => {
		const lines = [
			ok(tool("ls")),
			err(tool("rm -rf /")),
			run(tool("git status")),
		];
		expect(renderToolsHeader(lines)).toBe("📋 <b>Tools</b> <code>2/3</code>");
	});

	it("appends ✅ to the header when all tools are done", () => {
		const lines = [ok(tool("ls")), ok(tool("pwd")), err(tool("nope"))];
		// 3 done, 3 total → all complete
		expect(renderToolsHeader(lines)).toBe("📋 <b>Tools</b> <code>3/3</code> ✅");
	});

	it("ignores non-tool lines mixed in (narration, outputs, user steers)", () => {
		const lines = [
			"💬 <i>Reading the codebase</i>",
			ok(tool("ls")),
			"<i>↳ index.ts main.ts</i>",
			"💬 <i>You: now what</i>",
			run(tool("grep foo")),
		];
		expect(renderToolsHeader(lines)).toBe("📋 <b>Tools</b> <code>1/2</code>");
	});
});
