import type { Env } from "./index";
import { markdownToTelegramHtml as markdownToHtml } from "./markdown";
import { editMessage, MatrixError, react, redact, sendMessage, typing, unpin, pin } from "./matrix";
import {
	escapeHtml,
	formatToolElapsed,
	formatToolUseLine,
	parsePlan,
	phaseFor,
	render,
	thinkingLine,
	type ContextUsage,
	type Phase,
	type PlanState,
	type ResultMeta,
	type StatusState,
	type SystemInfo,
} from "./render";

/**
 * Matrix-flavored Replicas poller. Mirrors the Telegram bridge's
 * ReplicaPoller state machine (alarms → poll /history → diff → render
 * → edit), swapping every outbound Telegram call for the matching
 * Matrix Client-Server call.
 *
 * Reused without change:
 *   - render.ts (phase header, plan block, expandable log, etc.)
 *   - markdown.ts (final-reply Markdown → HTML)
 *   - The diff-guard, edit-rate-limit, snapshot-event-count, idempotency,
 *     and parallel-terminal patterns from the Telegram poller's perf
 *     tuning (commits b5252e4, 6a4db4a, 76ccf54, aaf50bf).
 */

interface WatchSpec {
	replicaId: string;
	roomId: string;
	startEventId?: string;
	userText?: string;
	// Event id of the dispatch-side 👀 ack reaction. Threaded through so the
	// poller can redact it when it places the terminal 🎉/😭 — otherwise
	// both stack on the user's prompt.
	ackReactionId?: string;
	// Event id of the initial "Starting · 0s" frame dispatch pre-sent in
	// parallel with the Replicas spawn. The poller adopts it as its
	// statusEventId so subsequent renders edit instead of sending fresh.
	initialStatusEventId?: string;
}

interface HistoryEvent {
	type?: string;
	payload?: {
		message?: { content?: ContentBlock[] };
		result?: string;
		is_error?: boolean;
		api_error_status?: string | null;
	};
}

interface ContentBlock {
	type?: string;
	text?: string;
	thinking?: string;
	name?: string;
	input?: Record<string, unknown>;
	// tool_use blocks: Anthropic-assigned id ("toolu_…"). Used to pair the
	// later tool_result back to its tool_use so we can swap the running 🔄
	// status icon on the rendered line in place to ✅ / ❌.
	id?: string;
	// tool_result blocks: points at the originating tool_use.id.
	tool_use_id?: string;
	// tool_result blocks only — the raw output (string) or list of inner blocks.
	content?: string | Array<{ type?: string; text?: string }>;
	is_error?: boolean;
}

interface HistoryResponse {
	events?: HistoryEvent[];
	total?: number;
}

const FIRST_POLL_DELAY_MS = 80;
const ACTIVE_POLL_INTERVAL_MS = 180;
const BACKOFF_POLL_INTERVAL_MS = 3000;
const MAX_WATCH_DURATION_MS = 30 * 60 * 1000;
// matrix.org's per-room send rate is roughly 30/min (one every 2s).
// 1000ms edits were tripping M_LIMIT_EXCEEDED on long turns, fragmenting
// the status frame. 2000ms / 4000ms ticker keeps us safely under the
// limit while still feeling live for the user.
const EDIT_MIN_INTERVAL_MS = 2000;
const TICKER_REFRESH_MS = 4000;

// Per-segment tool cap. When the current editable segment has accumulated
// this many tool_use lines, seal it (one final render with "▶️ continues"
// tail) and start a new message for the next tool. So a 30-tool turn
// renders as ~3 messages instead of one wall of scroll. Also triggers on
// every Task subagent invocation regardless of count, since that's the
// clearest "new context" boundary. Disabled when set to 0.
const SEGMENT_TOOL_CAP = 12;

// Char-delta edit gate (n3d1117/chatgpt-telegram-bot pattern, see
// docs/acp-telegram-status-research.md). On non-terminal renders with no
// phase transition, skip the edit if the rendered text length changed by
// fewer than this many characters. Stops thinking-preview ticks (~5 chars
// of italic narration delta) from burning matrix.org quota.
const CHAR_DELTA_CUTOFF = 50;

// Self-tuning per-turn backoff bonus. Each non-terminal 429 from
// matrix.org adds 1500ms to the effective edit throttle, capped at 10s.
// Wiped on /watch fresh-spawn so calm turns start fast; noisy turns
// settle into a sustainable cadence (matches the TG bridge's pattern).
const BACKOFF_PER_429_MS = 1500;
const MAX_BACKOFF_BONUS_MS = 10_000;
const TYPING_INTERVAL_MS = 25_000;
const REPLY_MAX_LEN = 16_000; // Matrix doesn't cap message length the way Telegram does (~16KB safe)

export class ReplicaPoller {
	private state: DurableObjectState;
	private env: Env;

	constructor(state: DurableObjectState, env: Env) {
		this.state = state;
		this.env = env;
	}

	async fetch(req: Request): Promise<Response> {
		const url = new URL(req.url);
		if (req.method === "POST" && url.pathname === "/watch") {
			return this.handleWatch(req);
		}
		if (req.method === "POST" && url.pathname === "/cancel") {
			return this.handleCancel();
		}
		if (req.method === "POST" && url.pathname === "/ack") {
			// Late-arriving dispatch-side ids. The 👀 reaction id is stored so
			// the terminal swapReaction can redact it instead of stacking
			// emojis. The initial status frame id is adopted as statusEventId
			// when dispatch pre-sent a "Starting · 0s" frame in parallel with
			// the Replicas spawn — subsequent renders will edit rather than
			// send fresh.
			const body = (await req.json()) as { ackReactionId?: string; initialStatusEventId?: string };
			const writes: Record<string, unknown> = {};

			// Strict "one emoji at a time" enforcement: if the watcher has
			// already reached terminal (swap fired with no prior, leaving the
			// 👀 unredacted), this incoming 👀 would stack against the 🎉/😭
			// that's already on the prompt. Immediately redact instead of
			// storing — there's no future swap to clean it up.
			if (body.ackReactionId) {
				const phase = await this.state.storage.get<Phase>("phase");
				const watch = await this.state.storage.get<WatchSpec>("watch");
				const isPostTerminal = phase === "DONE" || phase === "FAILED";
				if (isPostTerminal && watch?.roomId) {
					redact(matrixEnv(this.env), watch.roomId, body.ackReactionId, "post-terminal stale ack")
						.catch((e) => console.log(`[poller] /ack post-terminal redact failed: ${e instanceof Error ? e.message : e}`));
				} else {
					writes.reactionEventId = body.ackReactionId;
				}
			}

			if (body.initialStatusEventId) {
				const existing = await this.state.storage.get<string>("statusEventId");
				// Only adopt if we haven't already started editing a frame.
				if (!existing) writes.statusEventId = body.initialStatusEventId;
			}
			if (Object.keys(writes).length > 0) await this.state.storage.put(writes);
			return new Response("ok");
		}
		if (req.method === "GET" && url.pathname === "/debug") {
			const all = await this.state.storage.list();
			const out: Record<string, unknown> = {};
			for (const [k, v] of all) out[k] = v;
			const alarmAt = await this.state.storage.getAlarm();
			return new Response(JSON.stringify({ state: out, alarmAt }), {
				headers: { "Content-Type": "application/json" },
			});
		}
		return new Response("not found", { status: 404 });
	}

	private async handleWatch(req: Request): Promise<Response> {
		const body = (await req.json()) as WatchSpec;
		const prior = await this.state.storage.get<WatchSpec>("watch");
		if (
			prior &&
			prior.replicaId === body.replicaId &&
			prior.startEventId !== undefined &&
			prior.startEventId === body.startEventId
		) {
			console.log(`[poller] /watch dedupe replica=${body.replicaId} ev=${body.startEventId}`);
			return new Response("ok");
		}

		// Steering: a new message arrived while the previous turn is still
		// running (status event live, no terminal yet). Don't reset — just
		// update watch + inject a 💬 You: line, let the alarm chain pick up
		// the agent's response.
		//
		// We ALSO gate on phase here. There's a race window between
		// setTerminal (phase=DONE, 🎉 placed on the user's prompt) and
		// pendingCleanup being set (which only happens after flushFinalReply
		// finishes). A user who follow-ups in that ~1s window would otherwise
		// fall into steering and inherit the previous turn's "🎉 Done · Ns"
		// header on what's actually a fresh turn — visible as a premature
		// done-emoji on the new prompt. Treating DONE/FAILED as terminal
		// closes the gate immediately.
		const statusEventId = await this.state.storage.get<string>("statusEventId");
		const pendingCleanup = await this.state.storage.get<boolean>("pendingCleanup");
		const priorPhase = await this.state.storage.get<Phase>("phase");
		const isPostTerminal = priorPhase === "DONE" || priorPhase === "FAILED";
		console.log(
			`[poller] /watch arrived replica=${body.replicaId} ev=${body.startEventId} prior_replicaId=${prior?.replicaId ?? "none"} statusEventId=${statusEventId ?? "none"} pendingCleanup=${pendingCleanup ?? "false"} priorPhase=${priorPhase ?? "none"}`,
		);
		if (
			prior &&
			prior.replicaId === body.replicaId &&
			statusEventId !== undefined &&
			!pendingCleanup &&
			!isPostTerminal
		) {
			// Steer-race protection (audit finding #1): the DO is
			// single-threaded but `await` yields. alarmInner does
			// fetch() on Replicas /history which can yield for 100s of
			// ms — during that window a steer /watch can race the
			// alarm's read-modify-write on `lines`. Wrap the steer's
			// state mutation in blockConcurrencyWhile so the alarm's
			// in-flight body completes before we touch `lines`, and
			// the final `lines` array reflects BOTH the tool events
			// the alarm just projected AND the steer's 💬 You: line.
			await this.state.blockConcurrencyWhile(async () => {
				const lines = (await this.state.storage.get<string[]>("lines")) ?? [];
				let segmentStartLine =
					(await this.state.storage.get<number>("segmentStartLine")) ?? 0;
				// Seal-on-steer: when the current segment has any content,
				// seal it (final-edit with "▶️ continues" tail) and start
				// a new message that opens with the 💬 You: line. Each
				// steered prompt is a clear narrative boundary, so always
				// splitting on steer matches the "more calls = more blocks"
				// intuition. If the current segment is empty (steered
				// before any tool ran), just push the 💬 line into the
				// existing segment — no seal.
				if (SEGMENT_TOOL_CAP > 0 && lines.length > segmentStartLine) {
					const priorState = await this.loadState();
					if (priorState) await this.sealCurrentSegment(priorState);
					segmentStartLine = lines.length;
				}
				if (body.userText) {
					const escaped = body.userText
						.replace(/&/g, "&amp;")
						.replace(/</g, "&lt;")
						.replace(/>/g, "&gt;")
						.slice(0, 200);
					lines.push(`💬 <i>You: ${escaped}</i>`);
				}
				const steerWrites: Record<string, unknown> = {
					watch: body,
					lines,
					lastRendered: "",
					segmentStartLine,
				};
				// Re-point reactionEventId at the NEW prompt's 👀 so
				// terminal places the final emoji on whatever message
				// the user just sent (and redacts that 👀, not the prior
				// phase emoji). BEFORE overwriting, redact the prior
				// reactionEventId — otherwise it stays orphaned forever.
				if (body.ackReactionId) {
					const priorReactionId = await this.state.storage.get<string>("reactionEventId");
					if (priorReactionId && priorReactionId !== body.ackReactionId) {
						redact(matrixEnv(this.env), body.roomId, priorReactionId, "steering: prior prompt finished")
							.catch((e) => console.log(`[poller] steering redact prior 👀 failed: ${e instanceof Error ? e.message : e}`));
					}
					steerWrites.reactionEventId = body.ackReactionId;
				}
				await this.state.storage.put(steerWrites);
				console.log(`[poller] /watch steer replica=${body.replicaId} ev=${body.startEventId}`);
				await this.renderAndSend();
			});
			return new Response("ok");
		}

		const baselineP = this.snapshotEventCount(body.replicaId);
		await this.state.storage.delete([
			"statusEventId",
			"reactionEventId",
			"pendingCleanup",
			"lastRendered",
			"pinned",
			"lastTypingAt",
			"lastEditAt",
			"plan",
			// Per-turn tool lifecycle + visibility tracker — wipe so the
			// next turn doesn't inherit stale tool_use_id mappings, tool
			// metadata, or the touched-files list.
			"toolLineIndex",
			"toolStartedAt",
			"toolNameById",
			"toolDiffById",
			"filesTouched",
			"lastEventAt",
			"phaseBeforeRateLimit",
			"activeToolStartedAt",
			"segmentStartLine",
			"replyEventId",
			// Per-turn throttle bookkeeping — wipe so a fresh turn starts
			// fast even if the prior turn ratcheted the backoff bonus up.
			"backoffBonusMs",
			"rateLimitedUntil",
			"lastRenderedLen",
			"lastEditedPhase",
		]);
		const baseline = await baselineP;
		const seed: Record<string, unknown> = {
			watch: body,
			lastSeenCount: baseline,
			lines: [],
			stepCount: 0,
			phase: "STARTING",
			currentAction: "",
			startedAt: Date.now(),
		};
		// #14 — load any prior cumulative session totals for this room so
		// the second-and-later turn's subtitle shows running totals from
		// the first edit.
		try {
			const sessKey = `session:${body.roomId}`;
			const prior = await this.env.MAP.get<import("./render").SessionTotals>(sessKey, {
				type: "json",
			});
			if (prior && prior.turns > 0) seed.sessionTotals = prior;
		} catch {}
		// Seed reactionEventId with the dispatch-side 👀 so the first
		// swapReaction (terminal) redacts it. Without this the 👀 hangs
		// around forever next to the 🎉.
		if (body.ackReactionId) seed.reactionEventId = body.ackReactionId;
		// Adopt the pre-sent "Starting · 0s" frame as our statusEventId so
		// subsequent renders edit it rather than sending fresh — dispatch
		// fires this in parallel with Replicas spawn for a fast TTFB.
		if (body.initialStatusEventId) seed.statusEventId = body.initialStatusEventId;
		await this.state.storage.put(seed);
		console.log(`[poller] /watch replica=${body.replicaId} baseline=${baseline}`);

		await this.renderAndSend();
		await this.state.storage.setAlarm(Date.now() + FIRST_POLL_DELAY_MS);
		return new Response("ok");
	}

	private async handleCancel(): Promise<Response> {
		const watch = await this.state.storage.get<WatchSpec>("watch");
		if (!watch) return new Response("ok");
		try {
			await fetch(`${this.env.REPLICAS_API_BASE}/replica/${watch.replicaId}`, {
				method: "DELETE",
				headers: replicasHeaders(this.env),
			});
		} catch {}
		const startedAt = (await this.state.storage.get<number>("startedAt")) ?? Date.now();
		const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
		await this.setTerminal(watch, { kind: "failed", durationSec: seconds, errorMsg: "Cancelled by user." });
		await this.state.storage.deleteAlarm();
		await this.state.storage.put("pendingCleanup", true);
		await this.state.storage.setAlarm(Date.now() + 30_000);
		return new Response("ok");
	}

	async alarm(): Promise<void> {
		// Schedule the safety-net alarm BEFORE the body runs. If
		// alarmInner hangs, throws past the catch, or the DO instance is
		// killed mid-execution by CF Workers, the chain self-heals via
		// the pre-set alarm — without relying on the catch's setAlarm
		// (which itself can fail) or any external poke. Same pattern as
		// the listener fix (`c39beb13`): the watcher had silent-die
		// scenarios where phase=STARTING with alarm=NO and the user saw
		// a frozen "🤔 Starting · 0s" pane forever.
		await this.state.storage.setAlarm(Date.now() + BACKOFF_POLL_INTERVAL_MS);
		try {
			await this.alarmInner();
		} catch (e) {
			console.error("[poller] alarm threw", e instanceof Error ? e.message : String(e));
			try {
				await this.state.storage.setAlarm(Date.now() + BACKOFF_POLL_INTERVAL_MS);
			} catch {}
		}
	}

	private async alarmInner(): Promise<void> {
		const snap = (await this.state.storage.get([
			"watch",
			"startedAt",
			"lastSeenCount",
			"pendingCleanup",
			"lines",
			"phase",
			"stepCount",
			"currentAction",
			"plan",
		])) as Map<string, unknown>;
		const watch = snap.get("watch") as WatchSpec | undefined;
		if (!watch) return;

		const startedAt = (snap.get("startedAt") as number | undefined) ?? Date.now();
		if (Date.now() - startedAt > MAX_WATCH_DURATION_MS) {
			// Pre-fix: deleteAll() ran silently, leaving the user-facing
			// status pane frozen at whatever mid-progress frame was last
			// rendered. Now we land a terminal "timed out" frame first so
			// the pane resolves cleanly and the room doesn't look stuck.
			const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
			await this.setTerminal(watch, {
				kind: "failed",
				durationSec: seconds,
				errorMsg: `Watch timed out — agent ran longer than ${Math.round(MAX_WATCH_DURATION_MS / 60_000)} min.`,
			});
			await this.state.storage.deleteAll();
			return;
		}

		const pendingCleanup = snap.get("pendingCleanup") as boolean | undefined;
		// Orphan detection: if phase is already terminal (DONE/FAILED)
		// but pendingCleanup was somehow never set, treat as orphan and
		// force cleanup. This catches the scenario where setTerminal's
		// post-phase work threw an exception and the caller's
		// pendingCleanup directive never landed — empirically observed
		// today on a Failed frame that ticked for 15 minutes. setTerminal
		// itself now writes pendingCleanup atomically (so this branch
		// shouldn't ever trip), but it's free defense-in-depth.
		const phaseFromSnap = snap.get("phase") as Phase | undefined;
		const isTerminal = phaseFromSnap === "DONE" || phaseFromSnap === "FAILED";
		if (isTerminal && !pendingCleanup) {
			console.log(`[poller] orphan terminal detected phase=${phaseFromSnap} — forcing cleanup`);
			await this.state.storage.put("pendingCleanup", true);
			await this.unpinStatus(watch);
			await this.state.storage.deleteAll();
			return;
		}
		if (pendingCleanup) {
			// Pre-cleanup delivery verification — confirm both the Done
			// frame edit and the reply message landed in the room. If
			// they didn't, the timeline check logs a warning so we can
			// see in tail when the bridge silently dropped a message.
			// Best-effort; failures don't block the cleanup.
			await this.verifyTurnDelivered(watch);
			await this.unpinStatus(watch);
			await this.state.storage.deleteAll();
			return;
		}

		const lastSeenCount = (snap.get("lastSeenCount") as number | undefined) ?? 0;
		const historyP = fetch(
			`${this.env.REPLICAS_API_BASE}/replica/${watch.replicaId}/history?include=content&verbose=1`,
			{ headers: replicasHeaders(this.env) },
		);
		const r = await historyP;

		if (!r.ok) {
			console.log(`[poller] /history ${r.status}`);
			if (r.status === 404 || r.status === 410) {
				// 404/410 = upstream replica deleted (TTL expiry / auto-stop
				// + lifecycle / manual delete). Sweep observation today:
				// this was 5/7 of the failed turns in a 2h sample — by far
				// the dominant failure class. Used to land a Failed frame
				// and require the user to send a second message to spawn
				// fresh. Now we auto-respawn inline: flush the dead room:
				// + model: KV, create a fresh replica with the SAME user
				// text, and re-bootstrap the watcher pointing at the new
				// replica id. The user sees a brief "respawning..." frame
				// rather than Failed + a manual retry. If anything fails
				// we fall back to the legacy Failed-and-give-up path.
				const userText = watch.userText;
				if (userText) {
					try {
						await this.env.MAP.delete(`room:${watch.roomId}`);
						await this.env.MAP.delete(`model:${watch.roomId}`);
						const newReplicaId = await this.respawnReplica(watch, userText);
						if (newReplicaId) {
							// Persist the new replicaId to KV with the same TTL.
							const ttl = Math.max(60, parseInt(this.env.REPLICA_TTL_SECONDS, 10) || 604800);
							await this.env.MAP.put(`room:${watch.roomId}`, newReplicaId, { expirationTtl: ttl });
							// Re-point THIS watcher at the new replica id so the
							// next /history poll succeeds against it. lastSeenCount
							// resets to 0 so we project from scratch.
							const newWatch: WatchSpec = { ...watch, replicaId: newReplicaId };
							await this.state.storage.put({
								watch: newWatch,
								lastSeenCount: 0,
								// Wipe per-turn projection state so the new
								// replica's events render cleanly.
								lines: [],
								stepCount: 0,
								phase: "STARTING",
								startedAt: Date.now(),
							});
							await this.state.storage.setAlarm(Date.now() + ACTIVE_POLL_INTERVAL_MS);
							console.log(`[poller] auto-respawn: ${watch.replicaId} → ${newReplicaId}`);
							return;
						}
					} catch (e) {
						console.log(`[poller] auto-respawn failed: ${e instanceof Error ? e.message : e}`);
					}
				}
				// Fallback: legacy Failed-and-give-up path.
				const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
				await this.setTerminal(watch, {
					kind: "failed",
					durationSec: seconds,
					errorMsg: `Replica gone (upstream returned ${r.status}). Send a new message to start a fresh session.`,
				});
				await this.state.storage.deleteAll();
				return;
			}
			await this.state.storage.setAlarm(Date.now() + BACKOFF_POLL_INTERVAL_MS);
			return;
		}

		const body = (await r.json()) as HistoryResponse;
		const events = body.events ?? [];
		const fresh = events.slice(lastSeenCount);

		const lines = (snap.get("lines") as string[] | undefined) ?? [];
		let phase = (snap.get("phase") as Phase | undefined) ?? "STARTING";
		let stepCount = (snap.get("stepCount") as number | undefined) ?? 0;
		let currentAction = (snap.get("currentAction") as string | undefined) ?? "";
		let plan = (snap.get("plan") as PlanState | undefined) ?? null;
		// Segment offset into `lines[]`. Lines before this index belong to
		// earlier sealed (frozen) Matrix messages. The active render only
		// shows `lines.slice(segmentStartLine)` so a long turn renders as
		// N separate messages instead of one giant rolling log.
		let segmentStartLine = (await this.state.storage.get<number>("segmentStartLine")) ?? 0;
		// Per-tool lifecycle tracker: tool_use.id → index in `lines`. When the
		// matching tool_result lands later, we use this to find and mutate the
		// `🔄 …` status prefix in place (→ `✅ …` or `❌ …`). Matches the
		// OpenACP per-line lifecycle icon UX.
		const toolLineIndex =
			(await this.state.storage.get<Record<string, number>>("toolLineIndex")) ?? {};
		let systemInfo = (await this.state.storage.get<import("./render").SystemInfo>("systemInfo")) ?? null;
		let contextUsage = (await this.state.storage.get<import("./render").ContextUsage>("contextUsage")) ?? null;
		let resultMeta = (await this.state.storage.get<import("./render").ResultMeta>("resultMeta")) ?? null;

		// Per-tool start timestamps for #2 (elapsed time on each completed
		// tool line). Keyed by tool_use.id, value is Date.now() when the
		// tool_use was projected. Cleared one-shot when the tool_result
		// lands so a stray duplicate result can't re-time the line.
		const toolStartedAt =
			(await this.state.storage.get<Record<string, number>>("toolStartedAt")) ?? {};

		// Per-tool name (Read / Edit / Write / Bash / Task / mcp__…) so the
		// tool_result handler can decide whether to compute diff stats.
		const toolNameById =
			(await this.state.storage.get<Record<string, string>>("toolNameById")) ?? {};

		// Per-tool diff stats (#3): pre-computed at tool_use time from the
		// block's input (Edit: old_string vs new_string line delta; Write /
		// NotebookEdit: lines added). Surfaced as a "(+12 −3)" suffix when
		// the result lands successfully.
		const toolDiffById =
			(await this.state.storage.get<Record<string, string>>("toolDiffById")) ?? {};

		// Deduped basenames of files the agent has touched, for #9 footer.
		const filesTouched =
			(await this.state.storage.get<string[]>("filesTouched")) ?? [];
		const filesTouchedSet = new Set(filesTouched);

		// #11 idle indicator — bumped to Date.now() whenever we project ANY
		// new event from /history. The render layer reads this and shows
		// "· idle Ns" once 5s have passed without a refresh.
		let lastEventAt = (await this.state.storage.get<number>("lastEventAt")) ?? Date.now();

		// #7 rate-limited phase. When a claude-rate_limit_event arrives we
		// stash the prior phase here so we can revert on the next agent
		// event. (Otherwise the frame would stay "Rate-limited" past the
		// actual upstream throttle.)
		let phaseBeforeRateLimit =
			(await this.state.storage.get<Phase>("phaseBeforeRateLimit")) ?? null;

		// Start time of the most recent unmatched tool_use. Used by the
		// renderer to append a live `· Ns` tail to the latest 🔄 line,
		// so a long-running tool keeps visibly timing on every tick.
		// Cleared when no 🔄 lines remain after a tool_result.
		let activeToolStartedAt =
			(await this.state.storage.get<number>("activeToolStartedAt")) ?? undefined;

		// Real Anthropic Claude Max 5h reset timestamp (ms epoch) parsed
		// from rate_limit_event payloads. Used by the subtitle to render
		// "resets in 1h 18m" — actual data from Anthropic, not an estimate.
		let rateLimitResetsAt =
			(await this.state.storage.get<number>("rateLimitResetsAt")) ?? undefined;

		let sawResult = false;
		let resultText: string | null = null;
		let resultIsError = false;
		let resultErrorMsg: string | null = null;
		// Set true when claude-result returns an error class that
		// can't be fixed within the existing replica's history
		// (lone surrogate, context window blown). Triggers the auto-cut
		// path: flush room: KV mapping after the Failed frame so the
		// next user message spawns a fresh replica with empty history.
		let unrecoverable = false;
		let pendingAssistantText: string | null = null;
		// Track where the latest text-narration line landed so we can drop it
		// before terminal — otherwise the user sees the same content twice
		// (once truncated in the Done frame's 💬 line and once fully rendered
		// as the markdown reply right under it).
		let lastTextNarrationIdx: number | null = null;
		let appended = false;

		for (const ev of fresh) {
			const t = ev.type ?? "";
			const content = ev.payload?.message?.content ?? [];
			// #11 — bump the last-event timestamp on every projected
			// Replicas event so the renderer can decide when to show
			// the "idle Ns" tail in the header.
			lastEventAt = Date.now();
			if (t === "claude-assistant") {
				// #7 — if we were in RATE_LIMITED and the agent is talking
				// again, the throttle has lifted. Revert to whatever phase
				// we were in before the rate-limit event hit.
				if (phase === "RATE_LIMITED" && phaseBeforeRateLimit !== null) {
					phase = phaseBeforeRateLimit;
					phaseBeforeRateLimit = null;
				}
				for (const block of content) {
					if (block.type === "thinking" && block.thinking) {
						currentAction = thinkingLine(block.thinking);
						if (phase === "STARTING") phase = "PLANNING";
					} else if (block.type === "tool_use") {
						const cmd =
							typeof block.input?.command === "string" ? (block.input.command as string) : undefined;
						phase = phaseFor(block.name ?? "tool", cmd);
						const toolName = block.name ?? "tool";
						let line = formatToolUseLine(
							toolName,
							(block.input ?? {}) as Record<string, unknown>,
						);

						// #12 minimal subagent visibility — when Claude
						// launches a Task subagent, render the line with the
						// label bolded so it stands out from regular tool
						// calls. (Full nested rendering needs Replicas to
						// expose parent_tool_use_id, which it doesn't today.)
						if (toolName === "Task") {
							const desc =
								typeof block.input?.description === "string"
									? ` ${block.input.description as string}`
									: "";
							line = `🧰 <b>Task</b>${desc ? `: ${desc}` : ""}`;
						}

						// Segment-seal trigger. Two cases force the current
						// editable segment to seal (final-edit with
						// "▶️ continues" tail) and start a new Matrix message
						// for the next tool call:
						//   (a) Task subagent — clearest "new context" boundary
						//   (b) Tools-in-segment ≥ SEGMENT_TOOL_CAP — caps the
						//       size of a single message so a 30-tool turn
						//       renders as multiple messages.
						const toolsInSegment = lines.length - segmentStartLine;
						const shouldSeal =
							SEGMENT_TOOL_CAP > 0 &&
							((toolName === "Task" && toolsInSegment > 0) ||
								toolsInSegment >= SEGMENT_TOOL_CAP);
						if (shouldSeal) {
							await this.sealCurrentSegment({
								userText: watch.userText,
								startedAt,
								stepCount,
								phase,
								currentAction,
								lines,
								plan: plan ?? undefined,
								systemInfo: systemInfo ?? undefined,
								contextUsage: contextUsage ?? undefined,
								resultMeta: resultMeta ?? undefined,
								filesTouched,
								lastEventAt,
								activeToolStartedAt,
								segmentStartLine,
							});
							// New segment starts at the line we're about to push.
							segmentStartLine = lines.length;
						}

						currentAction = line;
						// Emit with a 🔄 lifecycle prefix to show "running".
						// The matching tool_result will swap this in place
						// to ✅ on success or ❌ on error.
						const renderedLine = `🔄 ${line}`;
						const newIdx = lines.length;
						lines.push(renderedLine);

						if (block.id) {
							toolLineIndex[block.id] = newIdx;
							// #2 record start time for elapsed tag
							toolStartedAt[block.id] = Date.now();
							// #3 stash name so result handler knows whether
							// to compute diff stats
							toolNameById[block.id] = toolName;
							// #3 pre-compute diff stats from input (cheap;
							// the data we need is right here at emit time)
							const diff = computeDiffStats(toolName, block.input);
							if (diff) toolDiffById[block.id] = diff;
						}

						// Live-elapsed tail on the in-flight 🔄 line. Renderer
						// reads this to append ` · Ns` to the last 🔄 line on
						// every tick, so a long-running tool keeps visibly
						// timing instead of looking frozen.
						activeToolStartedAt = Date.now();

						// #9 track touched files for the footer
						const fp =
							typeof block.input?.file_path === "string"
								? (block.input.file_path as string)
								: undefined;
						if (fp && !filesTouchedSet.has(fp)) {
							filesTouchedSet.add(fp);
							filesTouched.push(fp);
						}

						stepCount += 1;
						appended = true;
					} else if (block.type === "text" && block.text) {
						pendingAssistantText = block.text;
						const parsedPlan = parsePlan(block.text);
						if (parsedPlan) {
							plan = parsedPlan;
							currentAction = "";
							appended = true;
							if (phase === "STARTING") phase = "PLANNING";
						} else {
							const narration = thinkingLine(block.text);
							currentAction = narration;
							lastTextNarrationIdx = lines.length;
							lines.push(`💬 ${narration}`);
							appended = true;
							// Any assistant text means the agent is actively responding —
							// transition out of STARTING so the header stops saying "🤔
							// Starting · Ns" for trivial-prompt turns that never produce
							// thinking or tool_use blocks.
							if (phase === "STARTING") phase = "RUNNING";
						}
					}
				}
			} else if (t === "claude-result") {
				sawResult = true;
				if (ev.payload?.is_error || ev.payload?.api_error_status) {
					resultIsError = true;
					const raw = ev.payload.api_error_status ?? "agent error";
					// Surface specific Anthropic 400s with a user-actionable
					// recovery hint instead of dumping the raw API error
					// string into the Failed frame. Lone-surrogate / invalid
					// JSON is the common case when a tool returned mid-emoji
					// or otherwise malformed text — only fix is a fresh
					// session, since the bad bytes live in the conversation
					// history forever.
					if (/no low surrogate|no high surrogate|invalid_request_error.*JSON/i.test(raw)) {
						resultErrorMsg =
							"Conversation context has invalid characters (lone UTF-16 surrogate from a malformed tool output). Auto-cutting and starting a fresh Sonnet session — your next message will get a clean reply.";
						// Auto-recovery directive: this error is unrecoverable
						// within the existing replica's history. Mark the
						// turn for auto-cut so the cleanup path flushes KV
						// and the next user send creates a fresh replica.
						unrecoverable = true;
					} else if (/string too long|max_tokens/i.test(raw)) {
						resultErrorMsg = `Context window full — auto-cutting and starting a fresh Sonnet session. Send your message again.`;
						unrecoverable = true;
					} else {
						resultErrorMsg = raw;
					}
				} else if (ev.payload?.result) {
					resultText = ev.payload.result;
				}
				// Capture cost + token meta for the Done header.
				const usage = (ev.payload as { usage?: { input_tokens?: number; output_tokens?: number } })?.usage ?? {};
				const cost = (ev.payload as { total_cost_usd?: number })?.total_cost_usd ?? 0;
				// #6 stop_reason for silent-truncation visibility.
				const stopReason =
					(ev.payload as { stop_reason?: string })?.stop_reason ?? undefined;
				// #8 count of permission denials for the badge.
				const denialsArr =
					(ev.payload as { permission_denials?: unknown[] })?.permission_denials;
				const denials = Array.isArray(denialsArr) ? denialsArr.length : 0;
				if (cost > 0 || usage.input_tokens || usage.output_tokens || stopReason || denials) {
					resultMeta = {
						costUsd: cost,
						inputTokens: usage.input_tokens ?? 0,
						outputTokens: usage.output_tokens ?? 0,
						stopReason,
						denials: denials || undefined,
					};
					appended = true;
				}
			} else if (t === "claude-rate_limit_event") {
				// Real Anthropic rate-limit signal: `rate_limit_info` carries
				// {status, rateLimitType, resetsAt, isUsingOverage, overageStatus}.
				//   status=allowed  → headroom remaining; just refresh resetsAt
				//   status=rejected → cap hit; surface as RATE_LIMITED phase
				//   isUsingOverage  → consuming overage tokens; surface too
				// Prior bridge code unconditionally flipped phase on every
				// event, which incorrectly painted the pane "Rate-limited"
				// during routine status checks (Anthropic emits these even
				// when fine). Now phase change is gated on actual cap-hit.
				const rli =
					(ev.payload as { rate_limit_info?: { status?: string; rateLimitType?: string; resetsAt?: number; isUsingOverage?: boolean; overageStatus?: string } } | undefined)?.rate_limit_info;
				if (rli) {
					if (rli.resetsAt && rli.rateLimitType === "five_hour") {
						rateLimitResetsAt = rli.resetsAt * 1000; // sec → ms
					}
					const capHit = rli.status === "rejected" || rli.isUsingOverage === true;
					if (capHit && phase !== "RATE_LIMITED") {
						phaseBeforeRateLimit = phase;
						phase = "RATE_LIMITED";
						appended = true;
					}
				}
			} else if (t === "claude-system") {
				// One-time projection of the system info Replicas hands us at
				// the start of a turn — model, MCP server statuses, tool count.
				// Pinned into the dim subtitle line under the phase header.
				const payload = ev.payload as {
					model?: string;
					mcp_servers?: Array<{ name?: string; status?: string }>;
					tools?: unknown[];
				};
				const mcps = payload.mcp_servers ?? [];
				const active = mcps.filter((s) => s?.status === "connected" || s?.status === "ready").length;
				systemInfo = {
					model: payload.model ?? "claude",
					mcpCount: mcps.length,
					mcpActive: active,
					toolCount: Array.isArray(payload.tools) ? payload.tools.length : 0,
				};
				appended = true;
			} else if (t === "context-usage") {
				const payload = ev.payload as { totalTokens?: number; maxTokens?: number; percentage?: number };
				if (payload.totalTokens || payload.maxTokens) {
					contextUsage = {
						totalTokens: payload.totalTokens ?? 0,
						maxTokens: payload.maxTokens ?? 0,
						pct: payload.percentage ?? 0,
					};
					appended = true;
				}
			} else if (t === "claude-user") {
				// tool_result blocks come back inside claude-user — extract +
				// project as a dimmed `↳ preview` line under the last tool call
				// so the reader sees both the call and its outcome.
				for (const block of content) {
					if (block.type === "tool_result") {
						const isErr = block.is_error === true;

						// Mutate the originating tool_use line's status prefix
						// in place: 🔄 → ✅ on success, 🔄 → ❌ on error. The
						// OpenACP "each tool ticks live" UX. We find the row by
						// tool_use_id via the toolLineIndex we built when the
						// tool_use was first projected.
						const tuId = block.tool_use_id;
						if (tuId && toolLineIndex[tuId] !== undefined) {
							const idx = toolLineIndex[tuId]!;
							if (idx >= 0 && idx < lines.length) {
								const newPrefix = isErr ? "❌ " : "✅ ";
								const before = lines[idx]!;
								if (before.startsWith("🔄 ")) {
									let after = newPrefix + before.slice("🔄 ".length);

									// #2 append elapsed time tag based on
									// when the tool_use was projected.
									const startedAt = toolStartedAt[tuId];
									if (startedAt) {
										const elapsedTag = formatToolElapsed(Date.now() - startedAt);
										if (elapsedTag) after += ` <i>(${elapsedTag})</i>`;
									}

									// #3 append diff stats on successful
									// Edit / Write / NotebookEdit results.
									if (!isErr) {
										const diff = toolDiffById[tuId];
										if (diff) after += ` <i>${diff}</i>`;
									}

									lines[idx] = after;
									appended = true;
								}
							}
							// One-shot cleanup so a duplicate or out-of-order
							// result can't re-fire on the same row.
							delete toolLineIndex[tuId];
							delete toolStartedAt[tuId];
							delete toolNameById[tuId];
							delete toolDiffById[tuId];

							// If no 🔄 lines remain, drop activeToolStartedAt
							// so the renderer stops appending the live `· Ns`
							// tail. If another 🔄 is still in-flight (parallel
							// tools), leave activeToolStartedAt pointing at the
							// most recent — renderer always targets the LAST
							// 🔄 line.
							const stillRunning = lines.some((l) => l.startsWith("🔄 "));
							if (!stillRunning) activeToolStartedAt = undefined;
						}

						const raw = block.content;
						let preview = "";
						if (typeof raw === "string") preview = raw;
						else if (Array.isArray(raw)) {
							for (const sub of raw) {
								if (sub && sub.type === "text" && typeof sub.text === "string") preview += sub.text;
							}
						}
						preview = preview.replace(/\s+/g, " ").trim();
						if (preview.length > 0) {
							const trimmed = preview.length > 100 ? preview.slice(0, 99) + "…" : preview;
							const icon = isErr ? "✗" : "↳";
							lines.push(`<i>${icon} ${escapeHtml(trimmed)}</i>`);
							appended = true;
						}
					}
				}
			}
		}

		if (!resultText && sawResult && pendingAssistantText) resultText = pendingAssistantText;

		// When a final markdown reply is coming, drop ANY trailing 💬
		// narration lines that have accumulated across ticks — the full
		// markdown reply that lands as the next message carries the same
		// content in full, so the user would otherwise see it twice (once
		// truncated as italic narration in the Done frame, once full as the
		// reply right below). Using lastTextNarrationIdx alone misses this
		// when the text and the claude-result arrive in different ticks
		// (the index is per-tick and resets to null on each alarm).
		void lastTextNarrationIdx;
		if (sawResult && !resultIsError && resultText) {
			while (lines.length > 0 && lines[lines.length - 1]!.startsWith("💬 ")) {
				lines.pop();
			}
		}

		// Audit finding #6: cap unbounded lines[] growth on thinking-
		// heavy turns. Long planning sessions push hundreds of `💬`
		// narration lines that bloat the serialized state on every alarm
		// tick (~180ms cadence). Cap at LINES_HARD_CAP entries from the
		// current segment by dropping the OLDEST `💬 …` / `↳ …` lines
		// first — tool lifecycle entries (🔄/✅/❌) and the `💬 You:`
		// steer markers are preserved because the renderer and the
		// toolLineIndex map depend on them.
		const LINES_HARD_CAP = 300;
		if (lines.length - segmentStartLine > LINES_HARD_CAP) {
			const isProtected = (l: string): boolean =>
				l.startsWith("🔄 ") || l.startsWith("✅ ") || l.startsWith("❌ ") ||
				l.startsWith("💬 <i>You:");
			let i = segmentStartLine;
			let dropped = 0;
			while (i < lines.length && lines.length - segmentStartLine > LINES_HARD_CAP) {
				if (!isProtected(lines[i]!)) {
					lines.splice(i, 1);
					dropped++;
					// Shift any toolLineIndex pointer that referenced a
					// later line down by one. Tool entries at or after i
					// stay where they are; their stored index decrements.
					for (const [id, idx] of Object.entries(toolLineIndex)) {
						if (idx > i) toolLineIndex[id] = idx - 1;
					}
				} else {
					i += 1;
				}
			}
			if (dropped > 0) console.log(`[poller] lines cap: dropped ${dropped} non-tool lines from segment`);
		}

		const writes: Record<string, unknown> = {
			lines,
			phase,
			stepCount,
			currentAction,
			lastSeenCount: events.length,
			toolLineIndex,
			toolStartedAt,
			toolNameById,
			toolDiffById,
			filesTouched,
			lastEventAt,
			segmentStartLine,
		};
		if (phaseBeforeRateLimit !== null) writes.phaseBeforeRateLimit = phaseBeforeRateLimit;
		else await this.state.storage.delete("phaseBeforeRateLimit");
		if (activeToolStartedAt !== undefined) writes.activeToolStartedAt = activeToolStartedAt;
		else await this.state.storage.delete("activeToolStartedAt");
		if (rateLimitResetsAt !== undefined) writes.rateLimitResetsAt = rateLimitResetsAt;
		if (plan) writes.plan = plan;
		if (systemInfo) writes.systemInfo = systemInfo;
		if (contextUsage) writes.contextUsage = contextUsage;
		if (resultMeta) writes.resultMeta = resultMeta;
		await this.state.storage.put(writes);

		console.log(
			`[poller] events=${events.length} fresh=${fresh.length} phase=${phase} step=${stepCount} sawResult=${sawResult}`,
		);

		await this.maybeTyping(watch);

		if (sawResult) {
			const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
			if (resultIsError) {
				await this.setTerminal(watch, {
					kind: "failed",
					durationSec: seconds,
					errorMsg: resultErrorMsg ?? "agent error",
				});
				// Auto-cut: when the error is unrecoverable (the broken
				// state is baked into the replica's chat history and no
				// follow-up prompt can fix it), flush BOTH the room: KV
				// mapping AND any per-room model: override. The next
				// user message will spawn a fresh replica with empty
				// history, and because the per-room override is gone
				// it'll land on REPLICAS_MODEL_OVERRIDE (Sonnet by
				// default in wrangler.toml) — even if the room had a
				// prior `!model opus` command stashed. Guarantees
				// "fresh + Sonnet" per Jaden's directive.
				if (unrecoverable) {
					try {
						await this.env.MAP.delete(`room:${watch.roomId}`);
						await this.env.MAP.delete(`model:${watch.roomId}`);
						console.log(`[poller] auto-cut: flushed room: + model: for ${watch.roomId} (unrecoverable; next spawn → Sonnet)`);
					} catch (e) {
						console.log(`[poller] auto-cut flush failed: ${e instanceof Error ? e.message : e}`);
					}
				}
				await this.state.storage.put("pendingCleanup", true);
				await this.state.storage.setAlarm(Date.now() + 30_000);
				return;
			}

			// Embed the final reply HTML directly in the Done frame instead
			// of sending it as a separate message. Single message per turn
			// means Beeper (and other bridges) can't drop "the second
			// message" — there is no second message. Also kills the whole
			// pendingFinalReply / retry / drain machinery: the body either
			// shows up in the Done frame's edit or it doesn't, and the edit
			// uses a stable txn id anyway so the homeserver dedupes retries.
			const resultHtml = resultText
				? markdownToHtml(resultText.slice(0, REPLY_MAX_LEN))
				: undefined;

			// #14 — accumulate session totals in KV. Each Done bumps
			// `session:${roomId}` with this turn's cost/steps; surfaces
			// in the subtitle when turns > 1. Best-effort: a failed KV
			// put doesn't block the Done frame.
			try {
				const sessKey = `session:${watch.roomId}`;
				const prior = await this.env.MAP.get<import("./render").SessionTotals>(sessKey, {
					type: "json",
				});
				const turnCost = resultMeta?.costUsd ?? 0;
				const next: import("./render").SessionTotals = {
					costUsd: (prior?.costUsd ?? 0) + turnCost,
					steps: (prior?.steps ?? 0) + stepCount,
					turns: (prior?.turns ?? 0) + 1,
				};
				await this.env.MAP.put(sessKey, JSON.stringify(next), {
					expirationTtl: 60 * 60 * 24 * 30, // 30 days
				});
				await this.state.storage.put("sessionTotals", next);
			} catch (e) {
				console.log(
					`[poller] session totals update failed: ${e instanceof Error ? e.message : e}`,
				);
			}

			// Per-org usage log. Append a {ts, cost, tok} entry on every
			// Done; the array is pruned to entries within the last 8 days
			// so it stays small and the 7d window has full data. Used by
			// the subtitle's "🪙 5h · 7d" render so the user sees rolling
			// consumption against a subscription plan instead of arbitrary
			// per-turn cost figures. Best-effort: failure doesn't block
			// the Done frame.
			try {
				const usageKey = `usage:org`;
				const priorLog = (await this.env.MAP.get<
					{ ts: number; cost: number; tok: number }[]
				>(usageKey, { type: "json" })) ?? [];
				const turnCost = resultMeta?.costUsd ?? 0;
				const turnTok =
					(resultMeta?.inputTokens ?? 0) + (resultMeta?.outputTokens ?? 0);
				const now = Date.now();
				const cutoff = now - 8 * 24 * 60 * 60 * 1000;
				const nextLog = priorLog.filter((e) => e.ts >= cutoff);
				nextLog.push({ ts: now, cost: turnCost, tok: turnTok });
				await this.env.MAP.put(usageKey, JSON.stringify(nextLog), {
					expirationTtl: 60 * 60 * 24 * 30, // 30 days
				});
			} catch (e) {
				console.log(
					`[poller] usage log update failed: ${e instanceof Error ? e.message : e}`,
				);
			}

			await this.setTerminal(watch, {
				kind: "done",
				durationSec: seconds,
				resultHtml,
			});

			// Send the agent's final reply as its OWN message right after the
			// Done frame. Per UX review: status summary (Done frame with tools
			// + totals) and the actual answer should be separate message
			// blocks so it's easy to scroll back to the answer without the
			// status clutter. Reply-to'd against the user's prompt so Beeper
			// threads it visually with the original message. Retried on 429
			// the same way terminal frames are.
			if (resultHtml) {
				await this.sendReplyAsOwnBlock(watch, resultHtml);
			}

			await this.state.storage.put("pendingCleanup", true);
			await this.state.storage.setAlarm(Date.now() + 30_000);
			return;
		}

		const lastEditAt = (await this.state.storage.get<number>("lastEditAt")) ?? 0;
		const tickerStale = Date.now() - lastEditAt >= TICKER_REFRESH_MS;

		// Always render on the ticker cadence regardless of phase. The
		// prior 3-min hard-stop for long-thinking phases froze the pane
		// at "Still planning · 3:00" and gave the user no signal the
		// agent was still working. The render layer carries a heartbeat
		// spinner that rotates per tick so the pane visibly moves on
		// every render — that's the contract we're trying to honor:
		// the status pane must never look like nothing is happening.
		if (appended || currentAction || tickerStale) {
			await this.renderAndSend();
		}
		await this.state.storage.setAlarm(Date.now() + ACTIVE_POLL_INTERVAL_MS);
	}

	private async snapshotEventCount(replicaId: string): Promise<number> {
		try {
			const r = await fetch(
				`${this.env.REPLICAS_API_BASE}/replica/${replicaId}/history?limit=1`,
				{ headers: replicasHeaders(this.env) },
			);
			if (!r.ok) return 0;
			const body = (await r.json()) as HistoryResponse;
			if (typeof body.total === "number") return body.total;
			return (body.events ?? []).length;
		} catch {
			return 0;
		}
	}

	private async loadState(): Promise<StatusState | null> {
		const snap = (await this.state.storage.get([
			"watch",
			"startedAt",
			"stepCount",
			"phase",
			"currentAction",
			"lines",
			"plan",
			"systemInfo",
			"contextUsage",
			"resultMeta",
			"filesTouched",
			"lastEventAt",
			"sessionTotals",
			"activeToolStartedAt",
			"segmentStartLine",
			"rateLimitResetsAt",
		])) as Map<string, unknown>;
		const watch = snap.get("watch") as WatchSpec | undefined;
		if (!watch) return null;
		const currentAction = (snap.get("currentAction") as string | undefined) ?? "";

		// Per-org rolling usage. Read the log from KV and bucket into 5h
		// and 7d aggregates. Computed lazily here so every render has
		// up-to-date numbers without the poller having to recompute on
		// every alarm tick.
		let usageWindows: import("./render").UsageWindows | undefined;
		try {
			const log = (await this.env.MAP.get<
				{ ts: number; cost: number; tok: number }[]
			>("usage:org", { type: "json" })) ?? [];
			const now = Date.now();
			const cutoff5h = now - 5 * 60 * 60 * 1000;
			const cutoff7d = now - 7 * 24 * 60 * 60 * 1000;
			let tok5h = 0;
			let tok7d = 0;
			let cost5h = 0;
			let cost7d = 0;
			for (const e of log) {
				if (e.ts >= cutoff7d) {
					tok7d += e.tok;
					cost7d += e.cost;
					if (e.ts >= cutoff5h) {
						tok5h += e.tok;
						cost5h += e.cost;
					}
				}
			}
			const resetsAt = snap.get("rateLimitResetsAt") as number | undefined;
			if (tok5h > 0 || tok7d > 0 || resetsAt) {
				// Compute % left against the env-configured quotas. When a
				// quota is zero/unset, leave the pct field undefined and the
				// renderer falls back to absolute tokens for that window.
				const quota5h = parseInt(this.env.USAGE_QUOTA_5H_TOK ?? "0", 10) || 0;
				const quota7d = parseInt(this.env.USAGE_QUOTA_7D_TOK ?? "0", 10) || 0;
				const pct5hLeft =
					quota5h > 0 ? Math.max(0, Math.round((1 - tok5h / quota5h) * 100)) : undefined;
				const pct7dLeft =
					quota7d > 0 ? Math.max(0, Math.round((1 - tok7d / quota7d) * 100)) : undefined;
				usageWindows = {
					tok5h,
					tok7d,
					cost5h,
					cost7d,
					pct5hLeft,
					pct7dLeft,
					resetsAt,
				};
			}
		} catch {}

		return {
			userText: watch.userText,
			startedAt: (snap.get("startedAt") as number | undefined) ?? Date.now(),
			stepCount: (snap.get("stepCount") as number | undefined) ?? 0,
			phase: (snap.get("phase") as Phase | undefined) ?? "STARTING",
			currentAction: currentAction || undefined,
			lines: (snap.get("lines") as string[] | undefined) ?? [],
			plan: (snap.get("plan") as PlanState | undefined) ?? undefined,
			systemInfo: (snap.get("systemInfo") as SystemInfo | undefined) ?? undefined,
			contextUsage: (snap.get("contextUsage") as ContextUsage | undefined) ?? undefined,
			resultMeta: (snap.get("resultMeta") as ResultMeta | undefined) ?? undefined,
			filesTouched: (snap.get("filesTouched") as string[] | undefined) ?? undefined,
			lastEventAt: (snap.get("lastEventAt") as number | undefined) ?? undefined,
			sessionTotals: (snap.get("sessionTotals") as import("./render").SessionTotals | undefined) ?? undefined,
			activeToolStartedAt: (snap.get("activeToolStartedAt") as number | undefined) ?? undefined,
			segmentStartLine: (snap.get("segmentStartLine") as number | undefined) ?? undefined,
			usageWindows,
		};
	}

	/**
	 * Send the agent's final reply as its own Matrix message, separate
	 * from the Done frame. Retried on 429 the same way terminal frames
	 * are. Reply-to'd against the user's prompt so Beeper threads it.
	 *
	 * Saved as `replyEventId` in storage so the same id is reused if a
	 * retry happens after a transient failure (no duplicate replies).
	 */
	private async sendReplyAsOwnBlock(watch: WatchSpec, html: string): Promise<void> {
		const existing = await this.state.storage.get<string>("replyEventId");
		if (existing) return; // already sent successfully on a prior pass
		const trimmed = html.slice(0, REPLY_MAX_LEN);

		// Stable txn id derived from the user's prompt id. Matrix dedupes
		// per (access_token, txn_id) — if we crash between the homeserver
		// accepting the send and us persisting `replyEventId`, the next
		// retry hits the same txn and the server returns the SAME event_id
		// instead of creating a duplicate. End-to-end idempotency for the
		// "reply is its own block" send path.
		const stableTxn = watch.startEventId ? `reply-${watch.startEventId}` : undefined;

		for (let attempt = 0; attempt < 4; attempt++) {
			try {
				const id = await sendMessage(matrixEnv(this.env), watch.roomId, trimmed, {
					replyTo: watch.startEventId,
					txnId: stableTxn,
				});
				await this.state.storage.put("replyEventId", id);
				return;
			} catch (e) {
				if (e instanceof MatrixError && e.status === 429) {
					const waitMs = Math.min(8_000, Math.max(500, e.retryAfterMs ?? 1_500));
					console.log(`[poller] reply 429 attempt ${attempt + 1}, retry in ${waitMs}ms`);
					await sleep(waitMs);
					continue;
				}
				console.log(`[poller] reply send failed: ${e instanceof Error ? e.message : e}`);
				return;
			}
		}
		console.log(`[poller] reply send exhausted retries`);
	}

	/**
	 * Pre-cleanup delivery verification. Called from the pendingCleanup
	 * alarm before tearing down the watcher state. Confirms that the
	 * Done frame edit + the reply message both landed in the room by
	 * fetching the recent timeline and checking for the stored event ids.
	 *
	 * If either is missing, attempts ONE recovery action:
	 *   - statusEventId missing → log warning (the user lost the Done
	 *     frame; can't easily recover without re-sending the whole pane).
	 *   - replyEventId missing → re-call sendReplyAsOwnBlock, which uses
	 *     the same stable txn id so Matrix dedupes if the prior send did
	 *     actually land.
	 *
	 * Returns true if both confirmed, false if anything was missing. Used
	 * for logging / future metrics, not to block cleanup.
	 */
	/**
	 * Create a fresh Replicas-side replica with the same user text the
	 * dead one had. Used by the alarmInner 404 auto-respawn path so a
	 * user whose replica TTL expired between turns doesn't see a
	 * Failed-then-retry pair.
	 *
	 * Mirrors the shape of dispatch.ts createReplica() — kept inline
	 * here so the poller doesn't import dispatch (which would create a
	 * circular reference). Cost-free duplication for a 30-line helper.
	 */
	private async respawnReplica(watch: WatchSpec, userText: string): Promise<string | null> {
		const eventId = watch.startEventId ?? "auto-respawn";
		const header = `[matrix:room=${watch.roomId}:event=${eventId}]`;
		const hint =
			"# Auto-respawned (prior replica was deleted). Continue from the user's most recent prompt.\n# Tool calls and final reply are auto-surfaced via an external poller.";
		const sanitize = (s: string): string =>
			s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
		const body = {
			name: `mx-respawn-${watch.roomId.replace(/[^a-z0-9]/gi, "").slice(0, 12)}-${Date.now()}`,
			message: sanitize(`${header}\n${hint}\n\n${userText}`),
			environment_id: this.env.REPLICAS_ENV_ID,
			source: "matrix",
			coding_agent: this.env.REPLICAS_AGENT_OVERRIDE || "claude",
			model: this.env.REPLICAS_MODEL_OVERRIDE || "claude-sonnet-4-6",
			thinking_level: this.env.REPLICAS_THINKING_OVERRIDE || "medium",
			lifecycle_policy: "delete_after_inactivity",
			auto_stop_minutes: 1440,
			metadata: { matrix_room_id: watch.roomId, matrix_event_id: eventId, auto_respawn: true },
		};
		const r = await fetch(`${this.env.REPLICAS_API_BASE}/replica`, {
			method: "POST",
			headers: replicasHeaders(this.env),
			body: JSON.stringify(body),
		});
		if (!r.ok) {
			console.log(`[poller] respawn failed: HTTP ${r.status}`);
			return null;
		}
		const json = (await r.json()) as { replica?: { id?: string }; id?: string };
		return json.replica?.id ?? json.id ?? null;
	}

	private async verifyTurnDelivered(watch: WatchSpec): Promise<boolean> {
		const statusEventId = await this.state.storage.get<string>("statusEventId");
		const replyEventId = await this.state.storage.get<string>("replyEventId");
		// Both undefined is the post-seal terminal case; nothing to verify.
		if (!statusEventId && !replyEventId) return true;
		const present = async (eventId: string): Promise<boolean> => {
			// Use /rooms/{id}/event/{eventId} for an exact-id existence
			// check — works for messages that have been edited (the
			// original still exists; /messages with limit=N might page
			// past it if the room has many edits since).
			const r = await fetch(
				`${this.env.MATRIX_HOMESERVER}/_matrix/client/v3/rooms/${encodeURIComponent(watch.roomId)}/event/${encodeURIComponent(eventId)}`,
				{ headers: { Authorization: `Bearer ${this.env.MATRIX_ACCESS_TOKEN}` } },
			);
			return r.ok;
		};
		try {
			let allOk = true;
			if (statusEventId && !(await present(statusEventId))) {
				console.log(`[poller] verify: statusEventId ${statusEventId.slice(0, 16)}… missing from room=${watch.roomId}`);
				allOk = false;
			}
			if (replyEventId && !(await present(replyEventId))) {
				console.log(`[poller] verify: replyEventId ${replyEventId.slice(0, 16)}… missing from room=${watch.roomId} — re-sending`);
				allOk = false;
				// Audit finding #4: don't just log — actually recover.
				// sendReplyAsOwnBlock uses txnId=reply-${startEventId} so
				// Matrix dedupes if the send did actually land but the
				// /event/{id} lookup raced. The reply HTML is stashed in
				// "lastResultHtml" during setTerminal for this exact case.
				const html = await this.state.storage.get<string>("lastResultHtml");
				if (html) {
					await this.state.storage.delete("replyEventId");
					await this.sendReplyAsOwnBlock(watch, html);
				}
			}
			return allOk;
		} catch (e) {
			console.log(`[poller] verify failed: ${e instanceof Error ? e.message : e}`);
			return false;
		}
	}

	/**
	 * Force a final render of the current editable segment with a
	 * "▶️ continues" tail, then clear statusEventId + bypass the throttle
	 * gates so the next renderAndSend sends a fresh message that becomes
	 * the new editable segment.
	 *
	 * Called inline from the tool_use handler when the segment-seal
	 * trigger fires (Task subagent or tools-in-segment >= cap). The
	 * caller is responsible for bumping segmentStartLine afterward.
	 */
	private async sealCurrentSegment(state: StatusState): Promise<void> {
		const watch = await this.state.storage.get<WatchSpec>("watch");
		if (!watch) return;
		const statusEventId = await this.state.storage.get<string>("statusEventId");
		// Nothing to seal if we haven't even sent the first frame yet.
		if (!statusEventId) return;
		const sealedState: StatusState = { ...state, sealing: true };
		const text = render(sealedState);
		try {
			await editMessage(matrixEnv(this.env), watch.roomId, statusEventId, text);
		} catch (e) {
			console.log(`[poller] seal final-edit failed: ${e instanceof Error ? e.message : e}`);
			// Best-effort — still start a new segment so we don't pile
			// more onto the same message.
		}
		// Forget the prior statusEventId so the next render goes through
		// the sendMessage path and creates a fresh editable message.
		// Reset edit-gate bookkeeping (lastRendered length, phase) so the
		// new segment's first render isn't suppressed by char-delta logic.
		await this.state.storage.delete([
			"statusEventId",
			"lastRendered",
			"lastRenderedLen",
			"lastEditedPhase",
			"pinned",
		]);
		console.log(`[poller] sealed segment ${statusEventId.slice(0, 12)}…, starting new`);
	}

	private async renderAndSend(state?: StatusState): Promise<void> {
		const watch = await this.state.storage.get<WatchSpec>("watch");
		if (!watch) return;
		const s = state ?? (await this.loadState());
		if (!s) return;
		const text = render(s);
		const lastRendered = await this.state.storage.get<string>("lastRendered");
		if (text === lastRendered) return;

		const lastEditAt = (await this.state.storage.get<number>("lastEditAt")) ?? 0;
		const since = Date.now() - lastEditAt;
		const statusEventId = await this.state.storage.get<string>("statusEventId");
		// Terminal edits (Done/Failed) MUST land — they're the most important
		// frame the user sees and the rolling-log freeze depends on them.
		// Ticker/tool edits get the rate limit to protect the homeserver.
		const isTerminal = s.terminal !== undefined;

		if (!isTerminal && statusEventId !== undefined) {
			// (1) Edit floor with self-tuning per-turn backoff bonus. The
			//     bonus ratchets up by BACKOFF_PER_429_MS each time the
			//     server says 429, capped at MAX_BACKOFF_BONUS_MS. Resets
			//     on /watch fresh-spawn.
			const backoffBonus = (await this.state.storage.get<number>("backoffBonusMs")) ?? 0;
			if (since < EDIT_MIN_INTERVAL_MS + backoffBonus) return;

			// (2) Honor matrix.org's per-room rate limit. When we hit 429
			//     the server hands us a retry_after_ms; respect it instead
			//     of dumb-retrying every alarm tick. Terminal renders skip
			//     the gate — the Done frame is load-bearing.
			const rlUntil = (await this.state.storage.get<number>("rateLimitedUntil")) ?? 0;
			if (Date.now() < rlUntil) return;

			// (3) Char-delta edit gate: skip when the rendered text length
			//     barely moved AND phase hasn't transitioned. Stops
			//     thinking-preview ticks (~5 chars of italic narration
			//     delta) from burning quota. Phase transitions ALWAYS edit
			//     through so the header emoji + label swap stays snappy.
			//     Heartbeat-safe: if the gate would skip but >= 2 ticker
			//     intervals have elapsed since the last edit, force the
			//     edit through so the heartbeat spinner keeps rotating
			//     (otherwise the gate kills the "never look frozen" win
			//     from the heartbeat work, since a heartbeat-only diff is
			//     0 chars by code-point length).
			const lastRenderedLen = (await this.state.storage.get<number>("lastRenderedLen")) ?? 0;
			const lastEditedPhase = await this.state.storage.get<Phase>("lastEditedPhase");
			const phaseChanged = lastEditedPhase !== undefined && lastEditedPhase !== s.phase;
			const heartbeatStale = since >= 2 * TICKER_REFRESH_MS;
			if (!phaseChanged && !heartbeatStale && Math.abs(text.length - lastRenderedLen) < CHAR_DELTA_CUTOFF) return;
		}

		await this.state.storage.put({
			lastRendered: text,
			lastEditAt: Date.now(),
			lastRenderedLen: text.length,
			lastEditedPhase: s.phase,
		});

		if (statusEventId !== undefined) {
			// Terminal edits (Done / Failed) MUST land — the embedded
			// result body lives inside this frame and the user has no
			// other path to the answer. So terminal renders retry on 429
			// inline (up to ~24s total worst case) instead of deferring
			// to the next alarm tick, which would be a cleanup wipe.
			// Non-terminal renders defer and let the next tick try.
			const maxAttempts = isTerminal ? 4 : 1;
			for (let attempt = 0; attempt < maxAttempts; attempt++) {
				try {
					await editMessage(matrixEnv(this.env), watch.roomId, statusEventId, text);
					return;
				} catch (e) {
					if (e instanceof MatrixError && e.status === 429) {
						const waitMs = Math.min(8_000, Math.max(500, e.retryAfterMs ?? 1_500));
						if (isTerminal && attempt + 1 < maxAttempts) {
							console.log(`[poller] editMessage 429 attempt ${attempt + 1} (TERMINAL), retry in ${waitMs}ms`);
							await sleep(waitMs);
							continue;
						}
						// Non-terminal: park for the next tick. Do NOT fall
						// through to sendMessage — that fragmenting fallback
						// was the source of the multi-bubble group-chat bug.
						// Also bump the per-turn self-tuning backoff bonus
						// so subsequent edits in this turn space out and the
						// chain settles instead of bouncing off the limit
						// repeatedly.
						const prevBonus = (await this.state.storage.get<number>("backoffBonusMs")) ?? 0;
						const nextBonus = Math.min(MAX_BACKOFF_BONUS_MS, prevBonus + BACKOFF_PER_429_MS);
						await this.state.storage.put({
							rateLimitedUntil: Date.now() + waitMs,
							backoffBonusMs: nextBonus,
						});
						console.log(`[poller] editMessage 429 — wait ${waitMs}ms, bonus ${prevBonus}→${nextBonus}ms`);
						return;
					}
					console.log(`[poller] editMessage failed: ${e instanceof Error ? e.message : e}`);
					break;
				}
			}
		}
		try {
			const newId = await sendMessage(matrixEnv(this.env), watch.roomId, text, {
				replyTo: watch.startEventId,
			});
			await this.state.storage.put("statusEventId", newId);
			if (!(await this.state.storage.get<boolean>("pinned"))) {
				try {
					await pin(matrixEnv(this.env), watch.roomId, newId);
					await this.state.storage.put("pinned", true);
				} catch (e) {
					console.log(`[poller] pin failed: ${e instanceof Error ? e.message : e}`);
				}
			}
		} catch (e) {
			if (e instanceof MatrixError && e.status === 429) {
				const waitMs = Math.max(1_000, e.retryAfterMs ?? 5_000);
				await this.state.storage.put("rateLimitedUntil", Date.now() + waitMs);
				console.log(`[poller] sendMessage 429 — backing off ${waitMs}ms`);
				return;
			}
			console.log(`[poller] sendMessage failed: ${e instanceof Error ? e.message : e}`);
		}
	}

	private async setTerminal(
		watch: WatchSpec,
		terminal: {
			kind: "done" | "failed";
			durationSec: number;
			errorMsg?: string;
			resultHtml?: string;
		},
	): Promise<void> {
		const s = await this.loadState();
		if (!s) return;
		s.terminal = terminal;
		s.phase = terminal.kind === "done" ? "DONE" : "FAILED";
		// Persist phase + pendingCleanup + the cleanup alarm AS A SINGLE
		// atomic write at the top, BEFORE any rendering / unpin / reaction
		// work that could throw. Prior to this, an exception in
		// renderAndSend / unpinStatus / swapReaction left phase=FAILED in
		// storage but pendingCleanup unset, and the alarm chain would
		// tick the Failed pane forever without ever entering the cleanup
		// branch (observed today on the main Jada DM).
		const atomicWrites: Record<string, unknown> = {
			phase: s.phase,
			pendingCleanup: true,
		};
		// Stash the result HTML so verifyTurnDelivered() can recover a
		// missing reply by re-sending with the stable txn id. Without
		// this, the reply HTML lives only in the transient terminal
		// object on this call's stack frame.
		if (terminal.resultHtml) atomicWrites.lastResultHtml = terminal.resultHtml;
		await this.state.storage.put(atomicWrites);
		await this.state.storage.setAlarm(Date.now() + 30_000);
		// Audit finding #7: wrap each remaining step in its own try/catch
		// so they always run independently. Without this, a thrown
		// renderAndSend left unpinStatus + swapReaction unrun — meaning
		// the user kept their 👀 ack reaction forever (no 🎉/😭) and the
		// status message stayed pinned. Now each step logs locally and
		// the rest of the cleanup still fires.
		try {
			await this.renderAndSend(s);
		} catch (e) {
			console.log(`[poller] setTerminal renderAndSend failed: ${e instanceof Error ? e.message : e}`);
		}
		try {
			await this.unpinStatus(watch);
		} catch (e) {
			console.log(`[poller] setTerminal unpinStatus failed: ${e instanceof Error ? e.message : e}`);
		}
		if (watch.startEventId) {
			try {
				await this.swapReaction(watch, terminal.kind === "done" ? "🎉" : "😭");
			} catch (e) {
				console.log(`[poller] setTerminal swapReaction failed: ${e instanceof Error ? e.message : e}`);
			}
		}
	}

	private async swapReaction(watch: WatchSpec, emoji: string): Promise<void> {
		if (!watch.startEventId) return;
		const prior = await this.state.storage.get<string>("reactionEventId");
		if (prior) {
			// Redact gets the same retry treatment as react — both go
			// through the rate-limited /rooms/{room}/send/* endpoints, and
			// if the redact dies the user sees stacked emojis (the old
			// 👀 plus the new 🎉) instead of a clean transition.
			for (let attempt = 0; attempt < 4; attempt++) {
				try {
					await redact(matrixEnv(this.env), watch.roomId, prior, "phase change");
					break;
				} catch (e) {
					if (e instanceof MatrixError && e.status === 429) {
						const waitMs = Math.min(8_000, Math.max(500, e.retryAfterMs ?? 1_500));
						console.log(`[poller] redact 429 attempt ${attempt + 1}, retry in ${waitMs}ms`);
						await sleep(waitMs);
						continue;
					}
					console.log(`[poller] redact failed: ${e instanceof Error ? e.message : e}`);
					break;
				}
			}
		}
		// Reactions are the user-facing "I see you / I'm done" signal —
		// they MUST land. Retry on 429 honoring the homeserver's
		// retry_after_ms hint, up to 4 attempts (~20s total worst case).
		// The 30s cleanup alarm gives us comfortable runway.
		for (let attempt = 0; attempt < 4; attempt++) {
			try {
				const id = await react(matrixEnv(this.env), watch.roomId, watch.startEventId, emoji);
				if (id) await this.state.storage.put("reactionEventId", id);
				return;
			} catch (e) {
				if (e instanceof MatrixError && e.status === 429) {
					const waitMs = Math.min(8_000, Math.max(500, e.retryAfterMs ?? 1_500));
					console.log(`[poller] react ${emoji} 429 attempt ${attempt + 1}, retry in ${waitMs}ms`);
					await sleep(waitMs);
					continue;
				}
				console.log(`[poller] react failed: ${e instanceof Error ? e.message : e}`);
				return;
			}
		}
		console.log(`[poller] react ${emoji} still 429 after 4 attempts; giving up`);
	}

	private async unpinStatus(watch: WatchSpec): Promise<void> {
		const eventId = await this.state.storage.get<string>("statusEventId");
		if (!eventId) return;
		try {
			await unpin(matrixEnv(this.env), watch.roomId, eventId);
		} catch {}
	}

	private async maybeTyping(watch: WatchSpec): Promise<void> {
		const last = (await this.state.storage.get<number>("lastTypingAt")) ?? 0;
		if (Date.now() - last < TYPING_INTERVAL_MS) return;
		try {
			await typing(matrixEnv(this.env), watch.roomId, true);
			await this.state.storage.put("lastTypingAt", Date.now());
		} catch {}
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// #3 — compute "(+12 −3)" stats from a tool_use input. Done at emit
// time (cheap) and stashed in toolDiffById for use when the result lands.
// Returns "" when the tool has no diffable shape.
function computeDiffStats(toolName: string, input: Record<string, unknown> | undefined): string {
	if (!input) return "";
	const linesOf = (s: unknown): number =>
		typeof s === "string" ? s.split("\n").length : 0;

	if (toolName === "Edit" || toolName === "NotebookEdit") {
		const before = linesOf(input.old_string);
		const after = linesOf(input.new_string);
		// Edit can be additive, removal, or replacement. We surface net
		// add/remove from line-count comparison (cheap approximation;
		// fine for the "at a glance" UX).
		const added = Math.max(0, after - before);
		const removed = Math.max(0, before - after);
		if (added === 0 && removed === 0) return "";
		const parts: string[] = [];
		if (added > 0) parts.push(`+${added}`);
		if (removed > 0) parts.push(`−${removed}`);
		return `(${parts.join(" ")})`;
	}
	if (toolName === "Write") {
		const n = linesOf(input.content);
		if (n === 0) return "";
		return `(+${n})`;
	}
	return "";
}

function replicasHeaders(env: Env): HeadersInit {
	return {
		Authorization: `Bearer ${env.REPLICAS_API_KEY}`,
		"Replicas-Org-Id": env.REPLICAS_ORG_ID,
	};
}

function matrixEnv(env: Env): {
	MATRIX_HOMESERVER: string;
	MATRIX_ACCESS_TOKEN: string;
	MATRIX_USER_ID: string;
} {
	return {
		MATRIX_HOMESERVER: env.MATRIX_HOMESERVER,
		MATRIX_ACCESS_TOKEN: env.MATRIX_ACCESS_TOKEN,
		MATRIX_USER_ID: env.MATRIX_USER_ID,
	};
}
