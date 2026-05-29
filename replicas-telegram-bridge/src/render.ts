// Status-message rendering. Pure functions over a WatchSpec + history events.
//
// The rendered shape is the "aesthetic Phase 1+2" from
// ~/.replicas/plans/telegram-status-ux-research.md:
//
//   <b>📋 PLANNING</b>  ·  step 3/7  ·  ⏱ 0:14
//   <i>Reading repo to choose strategy…</i>
//
//   <code>🔧 $ ls -la src/</code>
//   <code>📖 src/index.ts</code>
//   <code>✏️  src/server.ts</code>
//
//   <blockquote expandable>
//   <code>📖 README.md</code>
//   <code>🔧 $ git status</code>
//   … 17 earlier steps
//   </blockquote>

const STATUS_MAX_LEN = 200;
const RECENT_LINES_VISIBLE = 4;
const MAX_TOTAL_LINES = 40;
const MAX_RENDER_CHARS = 3800; // leave headroom for reply_markup and HTML tags

export type Phase = "STARTING" | "PLANNING" | "EDITING" | "RUNNING" | "TESTING" | "SHIPPING" | "DONE" | "FAILED";

export interface StatusState {
	userText?: string;
	startedAt: number;
	stepCount: number;
	phase: Phase;
	currentAction?: string;
	lines: string[];
	terminal?: { kind: "done" | "failed"; durationSec: number; errorMsg?: string };
}

const PHASE_DISPLAY: Record<Phase, string> = {
	STARTING: "🤔 STARTING",
	PLANNING: "📋 PLANNING",
	EDITING: "✍️ EDITING",
	RUNNING: "🔧 RUNNING",
	TESTING: "🧪 TESTING",
	SHIPPING: "🚢 SHIPPING",
	DONE: "🎉 DONE",
	FAILED: "❌ FAILED",
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
			if (/\b(npm test|bun test|pnpm test|yarn test|pytest|jest|cargo test|go test|vitest|mocha|rspec|phpunit|junit)\b/.test(c)) {
				return "TESTING";
			}
			if (/\b(gh pr|git push|wrangler deploy|fly deploy|vercel deploy|cf|netlify deploy)\b/.test(c)) {
				return "SHIPPING";
			}
			if (/\b(npm run build|bun run build|pnpm build|yarn build|cargo build|go build|tsc|webpack|esbuild)\b/.test(c)) {
				return "TESTING";
			}
			return "RUNNING";
		}
		default:
			return "PLANNING";
	}
}

export function formatToolUseLine(name: string, input: Record<string, unknown>): string {
	const s = (k: string): string => {
		const v = input[k];
		return typeof v === "string" ? v : "";
	};
	switch (name) {
		case "Bash":
			return code("🔧 $ " + truncate(s("command"), STATUS_MAX_LEN));
		case "Read":
			return code("📖 " + truncate(s("file_path"), STATUS_MAX_LEN));
		case "Write":
			return code("✍️  " + truncate(s("file_path"), STATUS_MAX_LEN));
		case "Edit":
		case "NotebookEdit":
			return code("✏️  " + truncate(s("file_path"), STATUS_MAX_LEN));
		case "Grep":
			return code("🔍 grep " + truncate(s("pattern") || s("path"), STATUS_MAX_LEN));
		case "Glob":
			return code("🔍 glob " + truncate(s("pattern"), STATUS_MAX_LEN));
		case "WebFetch":
		case "WebSearch":
			return code("🌐 " + truncate(s("url") || s("query"), STATUS_MAX_LEN));
		default:
			if (name.startsWith("mcp__")) {
				return code("🧰 " + truncate(name.replace(/^mcp__/, ""), STATUS_MAX_LEN));
			}
			return code("🔧 " + truncate(name, STATUS_MAX_LEN));
	}
}

export function thinkingLine(thinking: string): string {
	const stripped = truncate(thinking.replace(/\n/g, " "), STATUS_MAX_LEN);
	return `<i>🤔 ${escapeHtml(stripped)}</i>`;
}

export function render(state: StatusState): string {
	const phaseTxt = state.terminal?.kind === "failed"
		? PHASE_DISPLAY.FAILED
		: state.terminal?.kind === "done"
			? PHASE_DISPLAY.DONE
			: PHASE_DISPLAY[state.phase];

	const elapsedSec = state.terminal?.durationSec ?? Math.max(0, Math.round((Date.now() - state.startedAt) / 1000));
	const elapsed = formatDuration(elapsedSec);
	const headerParts = [`<b>${phaseTxt}</b>`];
	if (state.stepCount > 0 && !state.terminal) headerParts.push(`step ${state.stepCount}`);
	headerParts.push(`⏱ ${elapsed}`);
	const header = headerParts.join("  ·  ");

	const sections: string[] = [header];

	if (state.userText) {
		const preview = truncate(state.userText.split("\n").find((l) => l.trim().length > 0) ?? "", 120);
		if (preview) sections.push(`<i>Task:</i> ${escapeHtml(preview)}`);
	}

	if (state.currentAction && !state.terminal) {
		sections.push(state.currentAction);
	}

	if (state.terminal?.kind === "failed" && state.terminal.errorMsg) {
		sections.push(`<blockquote>${escapeHtml(state.terminal.errorMsg.slice(0, 400))}</blockquote>`);
	}

	if (state.lines.length > 0) {
		const recent = state.lines.slice(-RECENT_LINES_VISIBLE);
		const older = state.lines.slice(0, Math.max(0, state.lines.length - RECENT_LINES_VISIBLE));
		const trimmedOlder = older.slice(-Math.max(0, MAX_TOTAL_LINES - recent.length));
		const droppedCount = older.length - trimmedOlder.length;

		if (trimmedOlder.length > 0) {
			const olderBlock = trimmedOlder.join("\n");
			const dropNote = droppedCount > 0 ? `\n<i>… ${droppedCount} earlier steps</i>` : "";
			sections.push(`<blockquote expandable>${olderBlock}${dropNote}</blockquote>`);
		}
		sections.push(recent.join("\n"));
	}

	let out = sections.filter(Boolean).join("\n");
	if (out.length > MAX_RENDER_CHARS) {
		// Trim from the expandable older block first if present.
		out = out.slice(0, MAX_RENDER_CHARS - 1) + "…";
	}
	return out;
}

export function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function code(s: string): string {
	return `<code>${escapeHtml(s)}</code>`;
}

export function truncate(s: string, n: number): string {
	if (s.length <= n) return s;
	return s.slice(0, n - 1) + "…";
}

export function formatDuration(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m}m ${s}s`;
}

export function phaseToReactionEmoji(phase: Phase): string {
	// Telegram bot-allowed standard reactions. Custom emoji require premium.
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
