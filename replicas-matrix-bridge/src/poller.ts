import type { Env } from "./index";
import { markdownToTelegramHtml as markdownToHtml } from "./markdown";
import { editMessage, react, redact, sendMessage, typing, unpin, pin } from "./matrix";
import {
	escapeHtml,
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
const EDIT_MIN_INTERVAL_MS = 500;
const TICKER_REFRESH_MS = 1500;
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
			// Late-arriving dispatch-side 👀 reaction id. Stored here so the
			// terminal swapReaction can redact it instead of stacking emojis.
			const body = (await req.json()) as { ackReactionId?: string };
			if (body.ackReactionId) {
				await this.state.storage.put("reactionEventId", body.ackReactionId);
			}
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
		const statusEventId = await this.state.storage.get<string>("statusEventId");
		const pendingCleanup = await this.state.storage.get<boolean>("pendingCleanup");
		console.log(
			`[poller] /watch arrived replica=${body.replicaId} ev=${body.startEventId} prior_replicaId=${prior?.replicaId ?? "none"} statusEventId=${statusEventId ?? "none"} pendingCleanup=${pendingCleanup ?? "false"}`,
		);
		if (
			prior &&
			prior.replicaId === body.replicaId &&
			statusEventId !== undefined &&
			!pendingCleanup
		) {
			const lines = (await this.state.storage.get<string[]>("lines")) ?? [];
			if (body.userText) {
				const escaped = body.userText
					.replace(/&/g, "&amp;")
					.replace(/</g, "&lt;")
					.replace(/>/g, "&gt;")
					.slice(0, 200);
				lines.push(`💬 <i>You: ${escaped}</i>`);
			}
			const steerWrites: Record<string, unknown> = { watch: body, lines, lastRendered: "" };
			// Re-point reactionEventId at the NEW prompt's 👀 so terminal
			// places the final emoji on whatever message the user just sent
			// (and redacts that 👀, not the prior phase emoji).
			if (body.ackReactionId) steerWrites.reactionEventId = body.ackReactionId;
			await this.state.storage.put(steerWrites);
			console.log(`[poller] /watch steer replica=${body.replicaId} ev=${body.startEventId}`);
			await this.renderAndSend();
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
		// Seed reactionEventId with the dispatch-side 👀 so the first
		// swapReaction (terminal) redacts it. Without this the 👀 hangs
		// around forever next to the 🎉.
		if (body.ackReactionId) seed.reactionEventId = body.ackReactionId;
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
			await this.state.storage.deleteAll();
			return;
		}

		const pendingCleanup = snap.get("pendingCleanup") as boolean | undefined;
		if (pendingCleanup) {
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
		let systemInfo = (await this.state.storage.get<import("./render").SystemInfo>("systemInfo")) ?? null;
		let contextUsage = (await this.state.storage.get<import("./render").ContextUsage>("contextUsage")) ?? null;
		let resultMeta = (await this.state.storage.get<import("./render").ResultMeta>("resultMeta")) ?? null;

		let sawResult = false;
		let resultText: string | null = null;
		let resultIsError = false;
		let resultErrorMsg: string | null = null;
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
			if (t === "claude-assistant") {
				for (const block of content) {
					if (block.type === "thinking" && block.thinking) {
						currentAction = thinkingLine(block.thinking);
						if (phase === "STARTING") phase = "PLANNING";
					} else if (block.type === "tool_use") {
						const cmd =
							typeof block.input?.command === "string" ? (block.input.command as string) : undefined;
						phase = phaseFor(block.name ?? "tool", cmd);
						const line = formatToolUseLine(
							block.name ?? "tool",
							(block.input ?? {}) as Record<string, unknown>,
						);
						currentAction = line;
						lines.push(line);
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
					resultErrorMsg = ev.payload.api_error_status ?? "agent error";
				} else if (ev.payload?.result) {
					resultText = ev.payload.result;
				}
				// Capture cost + token meta for the Done header.
				const usage = (ev.payload as { usage?: { input_tokens?: number; output_tokens?: number } })?.usage ?? {};
				const cost = (ev.payload as { total_cost_usd?: number })?.total_cost_usd ?? 0;
				if (cost > 0 || usage.input_tokens || usage.output_tokens) {
					resultMeta = {
						costUsd: cost,
						inputTokens: usage.input_tokens ?? 0,
						outputTokens: usage.output_tokens ?? 0,
					};
					appended = true;
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
							const isErr = block.is_error === true;
							const icon = isErr ? "✗" : "↳";
							lines.push(`<i>${icon} ${escapeHtml(trimmed)}</i>`);
							appended = true;
						}
					}
				}
			}
		}

		if (!resultText && sawResult && pendingAssistantText) resultText = pendingAssistantText;

		// If we're about to send a final markdown reply AND the rolling log
		// already has other lines (tool-call lines from earlier in the turn),
		// drop the trailing 💬 narration — otherwise the Done frame would
		// duplicate the response (once truncated as italic narration, once in
		// full as the markdown reply below). When there are NO other lines
		// (text-only turn) keep the narration so the Done frame isn't empty.
		if (
			sawResult &&
			!resultIsError &&
			resultText &&
			lastTextNarrationIdx !== null &&
			lines.length > 1
		) {
			lines.splice(lastTextNarrationIdx, 1);
		}

		const writes: Record<string, unknown> = {
			lines,
			phase,
			stepCount,
			currentAction,
			lastSeenCount: events.length,
		};
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
				await this.state.storage.put("pendingCleanup", true);
				await this.state.storage.setAlarm(Date.now() + 30_000);
				return;
			}

			// Persist the final reply text so subsequent alarm ticks can
			// retry the send if this one fails — long turns occasionally drop
			// the message mid-Promise.all, leaving the room with a Done frame
			// but no answer. The cleanup alarm waits 30s, giving us many
			// retry windows before storage gets wiped.
			if (resultText) await this.state.storage.put("pendingFinalReply", resultText);

			await this.setTerminal(watch, { kind: "done", durationSec: seconds });

			await this.flushFinalReply(watch);

			// Only mark for cleanup once the reply is confirmed delivered.
			const stillPending = await this.state.storage.get<string>("pendingFinalReply");
			if (!stillPending) {
				await this.state.storage.put("pendingCleanup", true);
				await this.state.storage.setAlarm(Date.now() + 30_000);
			} else {
				// Retry next alarm — short cadence so the user doesn't wait.
				await this.state.storage.setAlarm(Date.now() + 2_000);
			}
			return;
		}

		// Even when no fresh claude-result is in this batch, a previous tick
		// might have set sawResult but failed the send. Drain pendingFinalReply
		// on every alarm tick so the retry actually fires.
		const pendingReply = await this.state.storage.get<string>("pendingFinalReply");
		if (pendingReply) {
			await this.flushFinalReply(watch);
		}

		const lastEditAt = (await this.state.storage.get<number>("lastEditAt")) ?? 0;
		const tickerStale = Date.now() - lastEditAt >= TICKER_REFRESH_MS;
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
		])) as Map<string, unknown>;
		const watch = snap.get("watch") as WatchSpec | undefined;
		if (!watch) return null;
		const currentAction = (snap.get("currentAction") as string | undefined) ?? "";
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
		};
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
		if (!isTerminal && statusEventId !== undefined && since < EDIT_MIN_INTERVAL_MS) return;

		await this.state.storage.put({ lastRendered: text, lastEditAt: Date.now() });

		if (statusEventId !== undefined) {
			try {
				await editMessage(matrixEnv(this.env), watch.roomId, statusEventId, text);
				return;
			} catch (e) {
				console.log(`[poller] editMessage failed: ${e instanceof Error ? e.message : e}`);
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
			console.log(`[poller] sendMessage failed: ${e instanceof Error ? e.message : e}`);
		}
	}

	private async setTerminal(
		watch: WatchSpec,
		terminal: { kind: "done" | "failed"; durationSec: number; errorMsg?: string },
	): Promise<void> {
		const s = await this.loadState();
		if (!s) return;
		s.terminal = terminal;
		s.phase = terminal.kind === "done" ? "DONE" : "FAILED";
		await this.state.storage.put("phase", s.phase);
		await this.renderAndSend(s);
		await this.unpinStatus(watch);
		if (watch.startEventId) {
			await this.swapReaction(watch, terminal.kind === "done" ? "🎉" : "😭");
		}
	}

	private async sendFinalReply(watch: WatchSpec, text: string): Promise<boolean> {
		const html = markdownToHtml(text.slice(0, REPLY_MAX_LEN));
		try {
			await sendMessage(matrixEnv(this.env), watch.roomId, html);
			return true;
		} catch (e) {
			console.log(`[poller] sendFinalReply failed: ${e instanceof Error ? e.message : e}`);
			return false;
		}
	}

	// Drain the pendingFinalReply slot: try sending, clear on success.
	// Called from both the sawResult branch (initial attempt) and from
	// every subsequent alarm tick that finds the slot still set (retries).
	private async flushFinalReply(watch: WatchSpec): Promise<void> {
		const pending = await this.state.storage.get<string>("pendingFinalReply");
		if (!pending) return;
		const ok = await this.sendFinalReply(watch, pending);
		if (ok) {
			await this.state.storage.delete("pendingFinalReply");
			console.log(`[poller] pendingFinalReply flushed (len=${pending.length})`);
		} else {
			console.log(`[poller] pendingFinalReply retry will fire next alarm`);
		}
	}

	private async swapReaction(watch: WatchSpec, emoji: string): Promise<void> {
		if (!watch.startEventId) return;
		const prior = await this.state.storage.get<string>("reactionEventId");
		if (prior) {
			try {
				await redact(matrixEnv(this.env), watch.roomId, prior, "phase change");
			} catch {}
		}
		try {
			const id = await react(matrixEnv(this.env), watch.roomId, watch.startEventId, emoji);
			if (id) await this.state.storage.put("reactionEventId", id);
		} catch (e) {
			console.log(`[poller] react failed: ${e instanceof Error ? e.message : e}`);
		}
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
