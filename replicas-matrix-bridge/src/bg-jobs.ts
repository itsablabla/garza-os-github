// Background-process detector. Scans Bash tool_use input + tool_result
// content for backgrounded jobs and returns short labels for the
// subtitle. Heuristic — not exhaustive — surfaces what's there in the
// 80% case without false-positive-ing every Bash command.
//
// Sources:
//   - tool_use input: `command` ending in `&` (no `&&`), `nohup ... &`,
//     or `run_in_background=true`.
//   - tool_result: lines like `[N] <pid>` (the shell's job notification),
//     `Started background process <pid>` / similar agent-emitted strings.

const PID_BRACKET = /\[\d+\][+\-]?\s+(\d{2,7})\b/g; // "[1] 12345"
const STARTED_BG = /\b(?:started|running|spawned|background process|pid)[^\d\n]{0,40}(\d{2,7})\b/gi;

/**
 * Pick a label for a backgrounded job based on the originating Bash
 * command and the surfaced pid. Returns something like `bun build (pid
 * 1234)` so the subtitle row stays scannable.
 */
export function bgJobLabel(command: string | undefined, pid: string | number): string {
	const safePid = String(pid).slice(0, 7);
	if (!command) return `pid ${safePid}`;
	// First non-trivial word — strip leading `nohup`, env-var prefixes,
	// `time`, etc. Then cap at ~24 chars so two jobs fit on one line.
	const tokens = command
		.trim()
		.split(/\s+/)
		.filter((t) => !/^(?:[A-Z_][A-Z0-9_]*=\S*|nohup|time|sudo|\(|\{)$/.test(t));
	const head = tokens.slice(0, 2).join(" ").slice(0, 24);
	return head ? `${head} (pid ${safePid})` : `pid ${safePid}`;
}

/**
 * Detect backgrounded jobs from the tool_use input. Returns a slug for
 * the command (the first 2 meaningful tokens) when the command appears
 * to backgrounded; or null otherwise. PID isn't known here yet — that
 * comes from the matching tool_result.
 */
export function bgJobFromCommand(toolName: string, input: Record<string, unknown> | undefined): string | null {
	if (toolName !== "Bash" || !input) return null;
	const cmd = typeof input.command === "string" ? (input.command as string) : "";
	const runInBg = input.run_in_background === true;
	const trailingAmp = /(?<!&)&\s*$/.test(cmd.trim()); // ends in `&` but not `&&`
	const nohup = /\bnohup\b/.test(cmd);
	if (!runInBg && !trailingAmp && !nohup) return null;
	return cmd;
}

/**
 * Scan a Bash tool_result string for PID markers and yield labels for
 * each backgrounded job mentioned. Pairs with the originating command
 * passed in `commandHint` so the label can include a meaningful name.
 * Bounded to 8 hits per result so a pathological log doesn't explode
 * the state.
 */
export function extractBgJobs(resultContent: string, commandHint?: string): string[] {
	const labels: string[] = [];
	const seen = new Set<string>();
	const push = (pid: string) => {
		if (seen.has(pid) || labels.length >= 8) return;
		seen.add(pid);
		labels.push(bgJobLabel(commandHint, pid));
	};
	let m: RegExpExecArray | null;
	PID_BRACKET.lastIndex = 0;
	while ((m = PID_BRACKET.exec(resultContent)) !== null) {
		push(m[1]!);
		if (labels.length >= 8) break;
	}
	STARTED_BG.lastIndex = 0;
	while ((m = STARTED_BG.exec(resultContent)) !== null) {
		push(m[1]!);
		if (labels.length >= 8) break;
	}
	return labels;
}
