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
// since the user can collapse the expandable; only the 4096-char Telegram
// total bites us, and we cap that separately below.
const MAX_TOTAL_LINES = 80;
const MAX_RENDER_CHARS = 3800;

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

export interface StatusState {
	userText?: string;
	startedAt: number;
	stepCount: number;
	phase: Phase;
	currentAction?: string;
	lines: string[];
	plan?: PlanState;
	terminal?: { kind: "done" | "failed"; durationSec: number; errorMsg?: string };
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

function renderActive(state: StatusState): string {
	const elapsedSec = Math.max(0, Math.round((Date.now() - state.startedAt) / 1000));
	const headerParts: string[] = [
		`${PHASE_EMOJI[state.phase]} <b>${PHASE_LABEL[state.phase]}</b>`,
	];
	if (state.stepCount > 0) headerParts.push(`step ${state.stepCount}`);
	headerParts.push(formatDuration(elapsedSec));
	const blocks: string[] = [headerParts.join(" · ")];

	if (state.currentAction && state.currentAction.startsWith("<i>")) {
		blocks.push(state.currentAction);
	}

	if (state.plan) {
		blocks.push(renderPlan(state.plan));
	}

	if (state.lines.length > 0) {
		const recent = state.lines.slice(-RECENT_LINES_VISIBLE);
		const older = state.lines.slice(0, Math.max(0, state.lines.length - RECENT_LINES_VISIBLE));
		const trimmedOlder = older.slice(-Math.max(0, MAX_TOTAL_LINES - recent.length));
		const dropped = older.length - trimmedOlder.length;

		if (trimmedOlder.length > 0) {
			const dropNote = dropped > 0 ? `<br><i>… ${dropped} earlier</i>` : "";
			blocks.push(`<blockquote expandable>${trimmedOlder.join("<br>")}${dropNote}</blockquote>`);
		}
		blocks.push(recent.join("<br>"));
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
	for (const item of plan.items) {
		const escaped = escapeHtml(item.content);
		lines.push(item.done ? `✓ <s>${escaped}</s>` : `◦ ${escaped}`);
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
	const headerLine = `${headerEmoji} <b>${headerLabel}</b> · ${duration}`;

	const blocks: string[] = [headerLine];

	if (!isDone && state.terminal!.errorMsg) {
		blocks.push(`<blockquote>${escapeHtml(state.terminal!.errorMsg.slice(0, 400))}</blockquote>`);
	}

	if (state.plan) {
		blocks.push(renderPlan(state.plan));
	}

	// Keep the rolling log (tool-calls, narration) visible after terminal so
	// the reader can see what actually happened during the turn — same window
	// as the in-progress render.
	if (state.lines.length > 0) {
		const recent = state.lines.slice(-RECENT_LINES_VISIBLE);
		const older = state.lines.slice(0, Math.max(0, state.lines.length - RECENT_LINES_VISIBLE));
		const trimmedOlder = older.slice(-Math.max(0, MAX_TOTAL_LINES - recent.length));
		const dropped = older.length - trimmedOlder.length;
		if (trimmedOlder.length > 0) {
			const dropNote = dropped > 0 ? `<br><i>… ${dropped} earlier</i>` : "";
			blocks.push(`<blockquote expandable>${trimmedOlder.join("<br>")}${dropNote}</blockquote>`);
		}
		blocks.push(recent.join("<br>"));
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
