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
const RECENT_LINES_VISIBLE = 4;
// Older steps go into <blockquote expandable> ("Show more"). Generous cap
// since the user can collapse the expandable.
const MAX_TOTAL_LINES = 80;
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
	// Anthropic upstream rate-limited the agent — Replicas emits
	// claude-rate_limit_event. Surfaced as a distinct phase so the
	// frozen status frame is legible ("waiting on Anthropic, not
	// hung").
	| "RATE_LIMITED"
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
	// stop_reason from Replicas' claude-result. Surfaced on the Done
	// header when it's anything other than "end_turn" so silent
	// truncation (max_tokens etc.) is impossible to miss.
	stopReason?: string;
	// Count of tools the agent tried that were blocked by a permission
	// hook. Pulled from claude-result.permission_denials[].length.
	denials?: number;
}

export interface ContextUsage {
	pct: number;
	totalTokens: number;
	maxTokens: number;
}

// Per-room totals accumulated across all turns in a steered
// conversation. Kept in KV under `session:${roomId}`. Surfaced in the
// subtitle once it's > 1 turn so the user sees cumulative spend.
export interface SessionTotals {
	costUsd: number;
	steps: number;
	turns: number;
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
	// Timestamp of the last NEW Replicas event we projected. When the
	// alarm finds no new events for >5s and we're not in cleanup, the
	// header gets a "· idle Ns" tail so the user can distinguish
	// "waiting on Claude" from "actually frozen".
	lastEventAt?: number;
	// Deduped basenames of files the agent has touched via Read /
	// Edit / Write / NotebookEdit. Rendered as a footer.
	filesTouched?: string[];
	// Per-room session totals (accumulated across steered turns). Only
	// surfaced once turnCount > 1, so a single-turn conversation looks
	// the same as before.
	sessionTotals?: SessionTotals;
	// Start timestamp of the most recently issued tool_use that has not
	// yet matched a tool_result. When set, the active 🔄 tool line in
	// the rolling log carries a live `· Ns` elapsed counter that ticks
	// on every render — so a long-running tool never looks frozen.
	activeToolStartedAt?: number;
	// Index into `lines` where the CURRENT editable segment starts. Lines
	// before this index belong to earlier sealed segments (each its own
	// Matrix message). The renderer only includes `lines.slice(start)` in
	// the active frame so a long turn renders as N separate messages
	// instead of one giant rolling log. Undefined / 0 == no segmentation
	// (single-message-per-turn legacy behavior).
	segmentStartLine?: number;
	// When true, the current render is the FINAL render of a segment that
	// is about to be sealed. The renderer appends a "▶️ continues below"
	// tail so the user knows this isn't the live edit anymore.
	sealing?: boolean;
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
	RATE_LIMITED: "⏸",
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
	RATE_LIMITED: "Rate-limited",
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

// Smart cost formatting: $0.07 not $0.0781; sub-cent shown as "<$0.01"
// instead of a sea of zeros. Used in the terminal header.
export function formatCost(usd: number): string {
	if (usd <= 0) return "";
	if (usd < 0.01) return "<$0.01";
	if (usd < 10) return `$${usd.toFixed(2)}`;
	return `$${Math.round(usd)}`;
}

// Render the context-window usage as a tiny 10-segment bar plus the
// percentage, e.g. `📊 ctx ▰▰▰▱▱▱▱▱▱▱ 28%`. When usage is >=85%, the
// `📊` becomes `⚠️` so the user sees context exhaustion approaching
// (OpenACP pattern). Returns "" when there's no usage data to show.
export function renderContextUsage(usage: ContextUsage | undefined): string {
	if (!usage || usage.pct <= 0) return "";
	const pct = Math.round(usage.pct);
	const segments = 10;
	const filled = Math.min(segments, Math.max(0, Math.round((pct / 100) * segments)));
	const bar = "▰".repeat(filled) + "▱".repeat(segments - filled);
	const icon = pct >= 85 ? "⚠️" : "📊";
	return `${icon} ctx ${bar} ${pct}%`;
}

// "📂 Files: foo.ts, bar.ts, baz.ts (+3 more)" footer. Basename-only;
// dedupes and shows up to 6 names before collapsing the tail count.
export function renderFilesTouched(files: string[] | undefined): string {
	if (!files || files.length === 0) return "";
	const VISIBLE = 6;
	const basenames = files.map((p) => {
		const parts = p.split("/");
		return parts[parts.length - 1] || p;
	});
	const head = basenames.slice(0, VISIBLE).map(escapeHtml).join(", ");
	const more = basenames.length > VISIBLE ? ` <i>(+${basenames.length - VISIBLE} more)</i>` : "";
	return `📂 <b>Files:</b> ${head}${more}`;
}

// Human label for Anthropic's stop_reason. Only the unusual ones get
// surfaced — `end_turn` returns "" so the happy path stays clean.
export function stopReasonLabel(stop?: string): string {
	switch (stop) {
		case "end_turn":
			return "";
		case "max_tokens":
			return "⚠️ cut off (max_tokens)";
		case "tool_use":
			return "⏸ stopped at tool_use";
		case "pause_turn":
			return "⏸ paused";
		case "stop_sequence":
			return "⏹ stop sequence";
		case undefined:
		case null:
		case "":
			return "";
		default:
			return `⏹ ${stop}`;
	}
}

// Short elapsed-time format for per-tool tags: 0.4s / 12s / 1:24.
export function formatToolElapsed(ms: number): string {
	if (ms < 0) return "";
	const sec = ms / 1000;
	if (sec < 10) return `${sec.toFixed(1)}s`;
	if (sec < 60) return `${Math.round(sec)}s`;
	const m = Math.floor(sec / 60);
	const s = Math.round(sec % 60);
	return `${m}:${s.toString().padStart(2, "0")}`;
}

// Scan `lines` for the 🔄 / ✅ / ❌ lifecycle prefixes and tally a
// "📋 Tools (M/N)" header line. Stateless — relies on the prefixes the
// poller writes when it pairs each tool_use to its later tool_result.
//
// Returns the rendered header HTML, or "" when there are no tool lines.
// Adds a trailing " ✅" when M === N AND N > 0 — matches the OpenACP
// allComplete header treatment.
export function renderToolsHeader(lines: string[]): string {
	let total = 0;
	let done = 0;
	for (const line of lines) {
		if (line.startsWith("🔄 ")) {
			total += 1;
		} else if (line.startsWith("✅ ") || line.startsWith("❌ ")) {
			total += 1;
			done += 1;
		}
	}
	if (total === 0) return "";
	const allComplete = done === total && total > 0 ? " ✅" : "";
	return `📋 <b>Tools (${done}/${total})</b>${allComplete}`;
}

// Per OpenACP: a long thinking phase that never makes a tool call
// looks frozen at "Planning · 0s" forever. After 60s, prefix the label
// with "Still …". The ticker now keeps running indefinitely (the prior
// 3-min hard-stop was removed) so the elapsed counter keeps advancing
// and the heartbeat spinner keeps rotating — the user always sees the
// pane move.
const THINKING_STILL_THRESHOLD_MS = 60_000;

// Braille spinner frames. The renderer picks a frame from the current
// elapsed time so the dot advances by one position on every render
// regardless of whether anything else in the state changed. That's the
// "always moving" guarantee: even when phase, step count, and lines
// are static, the heartbeat ticks once per render. Frame interval is
// the poller's TICKER_REFRESH_MS (~4s), so it reads as a steady pulse.
const HEARTBEAT_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Render the spinner frame for the current tick. Frame index is derived
// from the elapsed seconds so successive ticks always land on different
// frames (no risk of two consecutive renders showing the same frame).
export function heartbeatFrame(elapsedSec: number): string {
	const idx = ((elapsedSec | 0) % HEARTBEAT_FRAMES.length + HEARTBEAT_FRAMES.length) % HEARTBEAT_FRAMES.length;
	return HEARTBEAT_FRAMES[idx];
}

function renderActive(state: StatusState): string {
	const elapsedMs = Math.max(0, Date.now() - state.startedAt);
	const elapsedSec = Math.round(elapsedMs / 1000);

	// "Still planning…" prefix when the phase has stalled — only applies
	// while no tools have been called yet. As soon as a tool runs the
	// label drops back to the normal "Planning" / "Running" etc.
	const isThinkingPhase = state.phase === "STARTING" || state.phase === "PLANNING";
	const isStuckThinking =
		isThinkingPhase &&
		state.stepCount === 0 &&
		elapsedMs >= THINKING_STILL_THRESHOLD_MS;
	const labelText = isStuckThinking
		? `Still ${PHASE_LABEL[state.phase].toLowerCase()}…`
		: PHASE_LABEL[state.phase];

	// Heartbeat dot prefixes the phase emoji and rotates one frame per
	// render. Even if no other field in the header changes, the dot
	// advances — so the pane is always visibly moving. Terminal frames
	// (Done / Failed) drop the heartbeat (the rolling log replaces it).
	const heartbeat = heartbeatFrame(elapsedSec);
	const headerParts: string[] = [
		`${heartbeat} ${PHASE_EMOJI[state.phase]} <b>${labelText}</b>`,
	];
	if (state.stepCount > 0) headerParts.push(`step ${state.stepCount}`);
	headerParts.push(formatDuration(elapsedSec));

	// Idle indicator: if the last projected event was >5s ago AND we're
	// in an active phase, append "· idle Ns". Distinguishes "waiting on
	// the LLM" from "actually frozen / network dead".
	if (state.lastEventAt !== undefined) {
		const idleMs = Date.now() - state.lastEventAt;
		if (idleMs >= 5_000) {
			const idleSec = Math.round(idleMs / 1000);
			headerParts.push(`<i>idle ${idleSec}s</i>`);
		}
	}

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

	// Slice to the current segment first. Lines before segmentStartLine
	// belong to earlier sealed segments (each rendered to its own
	// frozen Matrix message). The active frame only shows the live
	// segment's lines — and the tools header counts THIS segment's
	// tool calls, not the cumulative total across sealed predecessors.
	const segStart = state.segmentStartLine ?? 0;
	const segmentLines = segStart > 0 ? state.lines.slice(segStart) : state.lines;

	// "📋 Tools (M/N) ✅" header — live completion count derived from the
	// 🔄 / ✅ / ❌ lifecycle prefixes the poller writes on each tool line.
	// Sits above the rolling log so the user sees "how many tools done" at
	// a glance before reading the individual lines.
	const toolsHeader = renderToolsHeader(segmentLines);
	if (toolsHeader) blocks.push(toolsHeader);

	// Live-elapsed tail on the latest in-flight tool. Find the LAST 🔄
	// line in the array and append ` · Ns` from activeToolStartedAt so
	// the user can see a long-running tool actively timing instead of
	// staring at a static "🔄 e2b__run_code" forever. Only mutates a
	// shallow clone — the array in state stays as-is.
	let lines = segmentLines;
	if (state.activeToolStartedAt !== undefined && segmentLines.length > 0) {
		const toolElapsed = Math.max(0, Math.round((Date.now() - state.activeToolStartedAt) / 1000));
		let lastRunning = -1;
		for (let i = segmentLines.length - 1; i >= 0; i--) {
			if (segmentLines[i].startsWith("🔄 ")) {
				lastRunning = i;
				break;
			}
		}
		if (lastRunning >= 0) {
			lines = segmentLines.slice();
			lines[lastRunning] = `${lines[lastRunning]} <i>· ${formatDuration(toolElapsed)}</i>`;
		}
	}

	// Stream every tool call through unmodified. Tool calls are the point —
	// the user is watching the agent work, line by line in real time. The
	// older overflow goes into <blockquote expandable> ("Show more") so the
	// active window stays readable on long turns.
	if (lines.length > 0) {
		const recent = lines.slice(-RECENT_LINES_VISIBLE);
		const older = lines.slice(0, Math.max(0, lines.length - RECENT_LINES_VISIBLE));
		const trimmedOlder = older.slice(-Math.max(0, MAX_TOTAL_LINES - recent.length));
		const dropped = older.length - trimmedOlder.length;

		if (trimmedOlder.length > 0) {
			const dropNote = dropped > 0 ? `<br><i>… ${dropped} earlier</i>` : "";
			blocks.push(`<blockquote expandable>${trimmedOlder.join("<br>")}${dropNote}</blockquote>`);
		}
		blocks.push(recent.join("<br>"));
	}

	// Files-touched footer: deduped basenames of Read/Edit/Write/
	// NotebookEdit targets, at the bottom of the active frame so the user
	// has an at-a-glance "what is this turn working on" anchor.
	const filesFooter = renderFilesTouched(state.filesTouched);
	if (filesFooter) blocks.push(filesFooter);

	// Seal tail: when this is the FINAL render of a segment before the
	// poller starts a new message, append a "▶️ continues" marker so the
	// reader knows this isn't the live edit anymore. Followed by a fresh
	// Matrix message that becomes the new editable segment.
	if (state.sealing) blocks.push(`<i>▶️ continues in next message…</i>`);

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
	let stopReasonAccent = "";
	let denialsBadge = "";
	if (state.resultMeta) {
		const m = state.resultMeta;
		const costStr = formatCost(m.costUsd ?? 0);
		if (costStr) headerParts.push(costStr);
		const t = (m.inputTokens ?? 0) + (m.outputTokens ?? 0);
		if (t > 0) headerParts.push(`${formatTokens(t)} tok`);

		// Stop-reason accent — only when it's something OTHER than the
		// normal end_turn. Surfaces silent truncations (`max_tokens` etc.)
		// that today look exactly like a clean finish.
		stopReasonAccent = stopReasonLabel(m.stopReason);
		// Denials badge — "🔐 N blocked" goes on the Done header so the
		// reader sees that the agent tried things and got told no.
		if (m.denials && m.denials > 0) {
			denialsBadge = `🔐 ${m.denials} blocked`;
		}
	}
	if (stopReasonAccent) headerParts.push(stopReasonAccent);
	if (denialsBadge) headerParts.push(denialsBadge);
	const headerLine = headerParts.join(" · ");

	const blocks: string[] = [headerLine];

	const subtitle = renderSubtitle(state);
	if (subtitle) blocks.push(subtitle);

	if (!isDone && state.terminal!.errorMsg) {
		blocks.push(`<blockquote>${escapeHtml(state.terminal!.errorMsg.slice(0, 400))}</blockquote>`);
	}

	// Terminal renders only the CURRENT segment's log (same slicing as
	// renderActive). Earlier sealed segments are already on screen as
	// their own Matrix messages and don't need to be re-included here.
	const termSegStart = state.segmentStartLine ?? 0;
	const termSegLines = termSegStart > 0 ? state.lines.slice(termSegStart) : state.lines;

	// Compact Done for text-only turns — when there were no tools at
	// all, skip the plan / Tools / rolling-log / files-footer sections
	// entirely. The Done frame becomes header + subtitle + (embedded
	// body) which is exactly the right shape for "Jada, what's 2+2?"
	// style conversation turns.
	const hasAnyToolPrefix = termSegLines.some(
		(l) => l.startsWith("🔄 ") || l.startsWith("✅ ") || l.startsWith("❌ "),
	);
	const isTextOnly = isDone && !hasAnyToolPrefix && !state.plan;

	if (!isTextOnly) {
		if (state.plan) {
			blocks.push(renderPlan(state.plan));
		}

		// "📋 Tools (M/N) ✅" header — same as renderActive. On the Done frame
		// this is a permanent at-a-glance recap of how many tools ran.
		const toolsHeader = renderToolsHeader(termSegLines);
		if (toolsHeader) blocks.push(toolsHeader);

		// Keep the rolling log (tool-calls, narration) visible after terminal so
		// the reader can see what actually happened during the turn — same
		// window as the in-progress render. Tool calls are the showpiece; the
		// answer body sits below them.
		if (termSegLines.length > 0) {
			const recent = termSegLines.slice(-RECENT_LINES_VISIBLE);
			const older = termSegLines.slice(0, Math.max(0, termSegLines.length - RECENT_LINES_VISIBLE));
			const trimmedOlder = older.slice(-Math.max(0, MAX_TOTAL_LINES - recent.length));
			const dropped = older.length - trimmedOlder.length;
			if (trimmedOlder.length > 0) {
				const dropNote = dropped > 0 ? `<br><i>… ${dropped} earlier</i>` : "";
				blocks.push(`<blockquote expandable>${trimmedOlder.join("<br>")}${dropNote}</blockquote>`);
			}
			blocks.push(recent.join("<br>"));
		}

		// Files-touched footer in the Done frame — same as renderActive.
		const filesFooter = renderFilesTouched(state.filesTouched);
		if (filesFooter) blocks.push(filesFooter);
	}

	// Embed the agent's final reply directly in the Done frame. Single
	// message per turn — Beeper and other bridges can't drop a "second
	// message" if there is no second message. Sits below the op log so
	// reading order is past → present → answer.
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
	// Cumulative session totals (when more than one turn in this room) —
	// surfaces "across the conversation" cost + steps so the user has
	// running visibility into total spend.
	if (state.sessionTotals && state.sessionTotals.turns > 1) {
		const t = state.sessionTotals;
		const costStr = formatCost(t.costUsd);
		if (costStr) parts.push(`session ${costStr} · ${t.steps} steps · ${t.turns} turns`);
		else parts.push(`session ${t.steps} steps · ${t.turns} turns`);
	}
	// The plain `ctx N%` line stays — keeps the at-a-glance number.
	if (state.contextUsage && state.contextUsage.pct > 0) {
		parts.push(`ctx ${Math.round(state.contextUsage.pct)}%`);
	}
	const lines: string[] = [];
	if (parts.length > 0) lines.push(`<i>${escapeHtml(parts.join(" · "))}</i>`);

	// Context bar on its own line below the dimmed subtitle when ctx > 0
	// — too wide to fit comfortably alongside the model/MCP info.
	const ctxBar = renderContextUsage(state.contextUsage);
	if (ctxBar) lines.push(`<i>${ctxBar}</i>`);

	return lines.join("<br>");
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
		case "RATE_LIMITED":
			return "⏸";
		case "DONE":
			return "🎉";
		case "FAILED":
			return "😭";
	}
}
