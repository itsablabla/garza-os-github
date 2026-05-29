// Native-Telegram status rendering.
//
// Design principles synthesized from the Telegram and Factory Droid research:
//   1. The status message is sent as a reply to the user's prompt, so
//      Telegram already shows the prompt above. No "Task:" repetition.
//   2. Emoji go OUTSIDE <code>; <code> wraps only the actual command/path.
//      `🔧 <code>ls -la src/</code>` reads cleanly. `<code>🔧 $ ls -la</code>`
//      forces the emoji into monospace and looks like ASCII art.
//   3. Single ` · ` separator in the header. Title-case phase names. No
//      ALL-CAPS dashboard look.
//   4. Terminal frames collapse to one line — the activity log was the
//      live storytelling, the final reply is the answer.
//   5. Use Telegram-native containers: <blockquote expandable> for old
//      history, <blockquote> for error messages.
//
// Result shapes:
//
// Active (no thinking yet, no tools yet):
//   🤔 <b>Starting</b> · 0:01
//
// Active with thinking preview:
//   📋 <b>Planning</b> · 0:14
//   <i>Reading repo structure to find the right approach</i>
//
// Active with tool calls:
//   🔧 <b>Running</b> · step 3 · 0:14
//
//   🔧 <code>ls -la src/</code>
//   📖 <code>src/index.ts</code>
//   ✏️ <code>src/server.ts</code>
//
// Active with overflow (older steps collapsed):
//   🧪 <b>Testing</b> · step 12 · 0:42
//
//   [tap to expand]
//     📖 <code>src/router.ts</code>
//     … 6 earlier
//
//   🧪 <code>bun test</code>
//   🚢 <code>gh pr create</code>
//
// Terminal — done:
//   🎉 <b>Done</b> · 14s
//
// Terminal — failed:
//   ❌ <b>Failed</b> · 8s
//   [blockquote: exit code 1: tests failed]

const STATUS_MAX_LEN = 200;
// Matrix events cap around 64KB; keep well under that since clients vary.
// Set generously because terminal frames now embed the full result body
// instead of sending it as a separate message (single-message turns).
const MAX_RENDER_CHARS = 30_000;

export type Phase =
	| "STARTING"
	| "PLANNING"
	| "EDITING"
	| "RUNNING"
	| "TESTING"
	| "SHIPPING"
	| "DONE"
	| "FAILED";

export interface PlanItem {
	content: string;
	done: boolean;
}

export interface PlanState {
	done: number;
	total: number;
	items: PlanItem[];
}

export interface SystemInfo {
	model: string;
	mcpCount: number;
	mcpActive: number;
	toolCount: number;
}

export interface ResultMeta {
	costUsd: number;
	inputTokens: number;
	outputTokens: number;
}

export interface ContextUsage {
	pct: number;
	totalTokens: number;
	maxTokens: number;
}

export interface StatusState {
	userText?: string;
	startedAt: number;
	stepCount: number;
	phase: Phase;
	currentAction?: string;
	lines: string[];
	plan?: PlanState;
	systemInfo?: SystemInfo;
	resultMeta?: ResultMeta;
	contextUsage?: ContextUsage;
	terminal?: {
		kind: "done" | "failed";
		durationSec: number;
		errorMsg?: string;
		// Pre-rendered HTML of the agent's final reply. When set,
		// renderTerminal embeds it inline below the focus-window op log
		// so the user gets one complete message per turn (no separate
		// markdown-reply message that Beeper/bridges can drop).
		resultHtml?: string;
	};
}

export function parsePlan(text: string): PlanState | null {
	const trimmed = text.trim();
	const lines = trimmed
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean);
	if (lines.length === 0) return null;
	const headerMatch = lines[0]!.match(/^Plan\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)\s*$/i);
	if (!headerMatch) return null;
	const done = parseInt(headerMatch[1]!, 10);
	const total = parseInt(headerMatch[2]!, 10);
	const items: PlanItem[] = [];
	for (const line of lines.slice(1)) {
		const stripped = line.match(/^~(.+)~$/);
		if (stripped) {
			items.push({ content: stripped[1]!.trim(), done: true });
		} else {
			items.push({ content: line, done: false });
		}
	}
	return { done, total, items };
}

const PHASE_EMOJI: Record<Phase, string> = {
	STARTING: "🤔",
	PLANNING: "📋",
	EDITING: "✏️",
	RUNNING: "🔧",
	TESTING: "🧪",
	SHIPPING: "🚢",
	DONE: "🎉",
	FAILED: "❌",
};

const PHASE_LABEL: Record<Phase, string> = {
	STARTING: "Starting",
	PLANNING: "Planning",
	EDITING: "Editing",
	RUNNING: "Running",
	TESTING: "Testing",
	SHIPPING: "Shipping",
	DONE: "Done",
	FAILED: "Failed",
};

export function phaseFor(toolName: string, command: string | undefined): Phase {
	switch (toolName) {
		case "Read":
		case "Grep":
		case "Glob":
		case "WebFetch":
		case "WebSearch":
			return "PLANNING";
		case "Edit":
		case "Write":
		case "NotebookEdit":
			return "EDITING";
		case "Bash": {
			if (!command) return "RUNNING";
			const c = command.toLowerCase();
			if (
				/\b(npm test|bun test|pnpm test|yarn test|pytest|jest|cargo test|go test|vitest|mocha|rspec|phpunit|junit|npm run build|bun run build|pnpm build|yarn build|cargo build|go build|tsc|webpack|esbuild)\b/.test(
					c,
				)
			) {
				return "TESTING";
			}
			if (
				/\b(gh pr|git push|wrangler deploy|fly deploy|vercel deploy|netlify deploy)\b/.test(c)
			) {
				return "SHIPPING";
			}
			return "RUNNING";
		}
		default:
			return "PLANNING";
	}
}

export function formatToolUseLine(name: string, input: Record<string, unknown>): string {
	const s = (k: string): string => (typeof input[k] === "string" ? (input[k] as string) : "");
	const line = (emoji: string, body: string): string =>
		`${emoji} <code>${escapeHtml(truncate(body, STATUS_MAX_LEN))}</code>`;
	switch (name) {
		case "Bash":
			return line("🔧", s("command"));
		case "Read":
			return line("📖", s("file_path"));
		case "Write":
			return line("✍️", s("file_path"));
		case "Edit":
		case "NotebookEdit":
			return line("✏️", s("file_path"));
		case "Grep":
			return line("🔍", "grep " + (s("pattern") || s("path")));
		case "Glob":
			return line("🔍", s("pattern"));
		case "WebFetch":
		case "WebSearch":
			return line("🌐", s("url") || s("query"));
		default:
			if (name.startsWith("mcp__")) return line("🧰", name.replace(/^mcp__/, ""));
			return line("🔧", name);
	}
}

export function thinkingLine(thinking: string): string {
	const stripped = truncate(thinking.replace(/\n/g, " "), STATUS_MAX_LEN);
	return `<i>${escapeHtml(stripped)}</i>`;
}

export function render(state: StatusState): string {
	if (state.terminal) return renderTerminal(state);
	return renderActive(state);
}

// ──────────────────────────────────────────────────────────────────────────
// Focus-window rendering (2026-05-29 UI cleanup)
//
// Designed to make "what is the agent doing RIGHT NOW" instantly readable
// without forcing the user to skim a 30-line tool log. Three tiers:
//
//   CURRENT (latest op): full command + ↳ output preview, indented under it
//   RECENT (2 prior):    one-line each, basename paths, bash truncated
//   OLDER (3+ ago):      collapsed into <blockquote expandable> with a
//                        "[N earlier ops]" header. Errors and user
//                        steers survive aggregation; everything else
//                        compresses.
//
// Parsing is line-shape based — tool calls match TOOL_EMOJI_RE, tool
// outputs match OUTPUT_RE, user/narration match NARRATION_RE. We pair an
// output line with the preceding tool line so the renderer can show them
// together (or, for non-current ops, drop the output).
// ──────────────────────────────────────────────────────────────────────────

const TOOL_EMOJI_RE = /^(🔧|📖|✍️|✏️|🔍|🌐|🧰) <code>([\s\S]*)<\/code>$/;
const OUTPUT_RE = /^<i>(↳|✗) /;
const NARRATION_RE = /^💬 /;

type OpKind = "tool" | "narration" | "user" | "other";

interface Op {
	kind: OpKind;
	line: string;
	output?: string;
	isError?: boolean;
}

function parseOps(lines: string[]): Op[] {
	const ops: Op[] = [];
	for (const line of lines) {
		if (OUTPUT_RE.test(line)) {
			const isErr = line.startsWith("<i>✗ ");
			const last = ops[ops.length - 1];
			if (last && last.kind === "tool") {
				last.output = line;
				last.isError = isErr;
			} else {
				ops.push({ kind: "other", line, isError: isErr });
			}
		} else if (NARRATION_RE.test(line)) {
			ops.push({
				kind: line.includes("You:") ? "user" : "narration",
				line,
			});
		} else if (TOOL_EMOJI_RE.test(line)) {
			ops.push({ kind: "tool", line });
		} else {
			ops.push({ kind: "other", line });
		}
	}
	return ops;
}

// Trim a tool line for compressed rendering: basename for paths,
// first-~60-chars for bash, leave short args alone. Used in the RECENT
// + OLDER tiers; CURRENT keeps the full original line.
const COMPRESS_TARGET = 60;
function compressToolLine(line: string): string {
	const m = TOOL_EMOJI_RE.exec(line);
	if (!m) return line;
	const emoji = m[1]!;
	let content = m[2]!;
	if (content.startsWith("/")) {
		const parts = content.split("/");
		content = parts[parts.length - 1] || content;
	}
	if (content.length > COMPRESS_TARGET) {
		content = content.slice(0, COMPRESS_TARGET - 1) + "…";
	}
	return `${emoji} <code>${content}</code>`;
}

function renderOpsFocused(ops: Op[]): string[] {
	if (ops.length === 0) return [];

	// Window: last 3 ops shown inline (CURRENT + 2 RECENT). Everything
	// before goes into the expandable.
	const CURRENT_IDX = ops.length - 1;
	const RECENT_WINDOW = 3;
	const VISIBLE_START = Math.max(0, ops.length - RECENT_WINDOW);

	const blocks: string[] = [];

	const older = ops.slice(0, VISIBLE_START);
	if (older.length > 0) {
		const olderRendered: string[] = [];
		for (const op of older) {
			if (op.kind === "tool") {
				olderRendered.push(compressToolLine(op.line));
				// Errors survive even in OLDER; non-error outputs are
				// dropped to keep the expandable scannable.
				if (op.isError && op.output) olderRendered.push(op.output);
			} else if (op.kind === "user") {
				olderRendered.push(op.line);
			} else if (op.kind === "other" && op.isError) {
				olderRendered.push(op.line);
			}
			// drop: narration (assistant chatter) and non-error standalone outputs
		}
		if (olderRendered.length > 0) {
			blocks.push(
				`<blockquote expandable><i>${older.length} earlier op${older.length === 1 ? "" : "s"}</i><br>${olderRendered.join("<br>")}</blockquote>`,
			);
		}
	}

	for (let i = VISIBLE_START; i < ops.length; i++) {
		const op = ops[i]!;
		const isCurrent = i === CURRENT_IDX;
		if (op.kind === "tool") {
			if (isCurrent) {
				// Full line + indented output under it
				blocks.push(op.line);
				if (op.output) blocks.push(`&nbsp;&nbsp;&nbsp;${op.output}`);
			} else {
				blocks.push(compressToolLine(op.line));
				// Errors survive on non-current too — silent failures are
				// the worst thing a focus window can hide.
				if (op.isError && op.output) blocks.push(op.output);
			}
		} else if (op.kind === "user" || op.kind === "narration") {
			blocks.push(op.line);
		} else if (op.kind === "other") {
			blocks.push(op.line);
		}
	}

	return blocks;
}

// Smart cost formatting: $0.07 not $0.0781; sub-cent shown as "<$0.01"
// instead of a sea of zeros. Used in the terminal header.
export function formatCost(usd: number): string {
	if (usd <= 0) return "";
	if (usd < 0.01) return "<$0.01";
	if (usd < 10) return `$${usd.toFixed(2)}`;
	return `$${Math.round(usd)}`;
}

function renderActive(state: StatusState): string {
	const elapsedSec = Math.max(0, Math.round((Date.now() - state.startedAt) / 1000));
	const headerParts: string[] = [
		`${PHASE_EMOJI[state.phase]} <b>${PHASE_LABEL[state.phase]}</b>`,
	];
	if (state.stepCount > 0) headerParts.push(`step ${state.stepCount}`);
	headerParts.push(formatDuration(elapsedSec));
	const blocks: string[] = [headerParts.join(" · ")];

	const subtitle = renderSubtitle(state);
	if (subtitle) blocks.push(subtitle);

	// Thinking preview lives separately from the op log — it's the
	// agent's *internal* state ("reading the codebase…"), not a tool
	// call. Surface it under the header so the user sees direction
	// during the gap between tool uses.
	if (state.currentAction && state.currentAction.startsWith("<i>")) {
		blocks.push(state.currentAction);
	}

	if (state.plan) {
		blocks.push(renderPlan(state.plan));
	}

	if (state.lines.length > 0) {
		const ops = parseOps(state.lines);
		const opBlocks = renderOpsFocused(ops);
		if (opBlocks.length > 0) blocks.push(opBlocks.join("<br>"));
	}

	// Matrix HTML treats source `\n` as whitespace, so use `<br><br>` between
	// blocks. (Plain `\n` in the formatted_body collapses to spaces, which is
	// why tool-call lines were appearing on one line in clients.)
	let out = blocks.join("<br><br>");
	if (out.length > MAX_RENDER_CHARS) out = out.slice(0, MAX_RENDER_CHARS - 1) + "…";
	return out;
}

export function renderPlan(plan: PlanState): string {
	const lines: string[] = [`<b>📋 Plan (${plan.done}/${plan.total})</b>`];
	let currentMarked = false;
	for (const item of plan.items) {
		const escaped = escapeHtml(item.content);
		if (item.done) {
			lines.push(`✓ <s>${escaped}</s>`);
		} else if (!currentMarked) {
			// First not-done item is the "current focus" — highlight it
			// so the user can spot where the agent is in the plan without
			// scanning the rolling log.
			lines.push(`► <b>${escaped}</b>`);
			currentMarked = true;
		} else {
			lines.push(`◦ ${escaped}`);
		}
	}
	// Plan items are stacked with <br> so the renderer puts each on its own
	// line — using \n leaves them concatenated since Matrix HTML treats
	// newlines as whitespace.
	return lines.join("<br>");
}

function renderTerminal(state: StatusState): string {
	const duration = formatDuration(state.terminal!.durationSec);
	const isDone = state.terminal!.kind === "done";
	const headerEmoji = isDone ? PHASE_EMOJI.DONE : PHASE_EMOJI.FAILED;
	const headerLabel = isDone ? PHASE_LABEL.DONE : PHASE_LABEL.FAILED;
	const headerParts: string[] = [`${headerEmoji} <b>${headerLabel}</b>`, duration];
	if (state.resultMeta) {
		const m = state.resultMeta;
		const costStr = formatCost(m.costUsd ?? 0);
		if (costStr) headerParts.push(costStr);
		const t = (m.inputTokens ?? 0) + (m.outputTokens ?? 0);
		if (t > 0) headerParts.push(`${formatTokens(t)} tok`);
	}
	const headerLine = headerParts.join(" · ");

	const blocks: string[] = [headerLine];

	const subtitle = renderSubtitle(state);
	if (subtitle) blocks.push(subtitle);

	if (!isDone && state.terminal!.errorMsg) {
		blocks.push(`<blockquote>${escapeHtml(state.terminal!.errorMsg.slice(0, 400))}</blockquote>`);
	}

	if (state.plan) {
		blocks.push(renderPlan(state.plan));
	}

	// Same focus window as the active render, so Done frames stay tidy:
	// CURRENT op (last) expanded with its output, RECENT compressed, OLDER
	// collapsed under an expandable. Plan items above it are the at-a-glance
	// recap; if the user wants exact-command-by-command they tap to expand.
	if (state.lines.length > 0) {
		const ops = parseOps(state.lines);
		const opBlocks = renderOpsFocused(ops);
		if (opBlocks.length > 0) blocks.push(opBlocks.join("<br>"));
	}

	// Embed the agent's final reply directly in the Done frame. Single
	// message per turn — Beeper and other bridges can't drop a "second
	// message" if there is no second message. Sits below the focus-window
	// log so reading order is past → present → answer.
	if (isDone && state.terminal!.resultHtml) {
		blocks.push(state.terminal!.resultHtml);
	}

	let out = blocks.join("<br><br>");
	if (out.length > MAX_RENDER_CHARS) out = out.slice(0, MAX_RENDER_CHARS - 1) + "…";
	return out;
}

export function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function truncate(s: string, n: number): string {
	if (s.length <= n) return s;
	return s.slice(0, n - 1) + "…";
}

// Single dimmed subtitle line under the phase header — model, MCP/tool count
// once we've seen claude-system, plus context % once we've seen
// context-usage. Wrapped in <i> so it sits visually beneath the bold header.
function renderSubtitle(state: StatusState): string {
	const parts: string[] = [];
	if (state.systemInfo) {
		const s = state.systemInfo;
		parts.push(prettyModel(s.model));
		if (s.mcpCount > 0) parts.push(`${s.mcpActive}/${s.mcpCount} MCP`);
		if (s.toolCount > 0) parts.push(`${s.toolCount} tools`);
	}
	if (state.contextUsage && state.contextUsage.pct > 0) {
		parts.push(`ctx ${Math.round(state.contextUsage.pct)}%`);
	}
	if (parts.length === 0) return "";
	return `<i>${escapeHtml(parts.join(" · "))}</i>`;
}

// "claude-sonnet-4-6" → "Sonnet 4.6"; "claude-opus-4-7" → "Opus 4.7"; leave
// unfamiliar shapes alone.
function prettyModel(m: string): string {
	const match = m.match(/^claude-(sonnet|opus|haiku)-(\d+)-(\d+)/i);
	if (!match) return m;
	const [, family, major, minor] = match;
	return `${family![0]!.toUpperCase() + family!.slice(1)} ${major}.${minor}`;
}

// 12345 → "12.3k". Avoids the "1234 tok" eye-strain shape.
export function formatTokens(n: number): string {
	if (n < 1000) return String(n);
	if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
	return `${Math.round(n / 1000)}k`;
}

export function formatDuration(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	const sPad = s.toString().padStart(2, "0");
	return `${m}:${sPad}`;
}

export function phaseToReactionEmoji(phase: Phase): string {
	switch (phase) {
		case "STARTING":
			return "👀";
		case "PLANNING":
			return "🤔";
		case "EDITING":
			return "✍️";
		case "RUNNING":
		case "TESTING":
		case "SHIPPING":
			return "👨‍💻";
		case "DONE":
			return "🎉";
		case "FAILED":
			return "😭";
	}
}
