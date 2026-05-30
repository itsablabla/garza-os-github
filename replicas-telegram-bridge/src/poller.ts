import type { Env } from "./index";
import { markdownToTelegramHtml } from "./markdown";
import { splitMarkdownReply } from "./split-reply";
import { stripMarkdownForTts, synthesizeSpeech } from "./tts";
import {
	escapeHtml,
	formatToolUseLine,
	parsePlan,
	phaseFor,
	phaseToReactionEmoji,
	render,
	thinkingLine,
	type ContextUsage,
	type Phase,
	type PlanState,
	type ResultMeta,
	type StatusState,
	type SystemInfo,
} from "./render";

interface WatchSpec {
	replicaId: string;
	chatId: number;
	threadId?: number;
	startMessageId?: number;
	userText?: string;
	// Pre-sent "🤔 Starting · 0s" message id. Dispatch fires the initial
	// frame in parallel with the Replicas spawn so the user sees activity
	// before the POST roundtrip lands; the DO adopts this id as its
	// statusMessageId so subsequent renders edit instead of sending fresh.
	initialStatusMessageId?: number;
	// Phase 2 voice — mirror mode. When the user's prompt was itself a
	// voice message (handleVoiceMessage transcribed it), the bot's reply
	// ships as voice too via OpenAI TTS + Telegram sendVoice.
	replyAsVoice?: boolean;
}

interface HistoryEvent {
	type?: string;
	payload?: {
		message?: { content?: ContentBlock[] };
		result?: string;
		subtype?: string;
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
// After this much silence, slow-poll cadence kicks in to save cost
// while the agent thinks.
const SLOW_POLL_THRESHOLD_MS = 10 * 60 * 1000;
const SLOW_POLL_INTERVAL_MS = 30_000;
// Hard idle timeout — final orphan detector. Original 30 min cut off
// real claude-result silence during long thinking phases. 6 hours is
// generous enough for long thinking + waiting-on-user, still reaps
// truly abandoned watchers.
const IDLE_TIMEOUT_MS = 6 * 60 * 60 * 1000;
// Telegram permits ~1 editMessageText per chat per second; we leave a small
// margin so a burst of polls coalesces into at most one edit per ~900ms.
const EDIT_MIN_INTERVAL_MS = 500;
// Even without new events, refresh the rendered status if at least this
// long has passed so the ⏱ ticker stays live.
const TICKER_REFRESH_MS = 1500;
const CHAT_ACTION_INTERVAL_MS = 4000;
const REPLY_MAX_LEN = 4000;
const DASHBOARD_BASE = "https://www.replicas.dev/dashboard?workspaceId=";

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
		if (req.method === "POST" && url.pathname === "/ack") {
			const body = (await req.json()) as { initialStatusMessageId?: number };
			if (typeof body.initialStatusMessageId === "number") {
				const existing = await this.state.storage.get<number>("statusMessageId");
				if (existing === undefined) {
					await this.state.storage.put("statusMessageId", body.initialStatusMessageId);
				}
			}
			return new Response("ok");
		}
		if (req.method === "POST" && url.pathname === "/cancel") {
			return this.handleCancel();
		}
		if (req.method === "POST" && url.pathname === "/stop") {
			await this.state.storage.deleteAlarm();
			await this.state.storage.deleteAll();
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
			prior.startMessageId !== undefined &&
			prior.startMessageId === body.startMessageId
		) {
			console.log(`[poller] /watch dedupe replica=${body.replicaId} msg=${body.startMessageId}`);
			return new Response("ok");
		}

		// Steering: a new message arrived while the previous turn is still
		// running (status frame is open, no terminal yet). Don't reset state
		// — just update the watch spec, drop a 💬 You: line into the rolling
		// log so the user sees their steer landed, and let the existing alarm
		// chain pick up the agent's response to the new input.
		// Race-guard: between setTerminal (phase=DONE, 🎉 placed on the
		// user's prompt) and pendingCleanup being set (only happens after
		// flushFinalReply finishes), a follow-up that lands in the window
		// would otherwise fall into steering and inherit the previous
		// turn's "🎉 Done · Ns" header on a fresh turn — premature done
		// emoji on the new prompt. Phase=DONE/FAILED closes the gate
		// immediately even before pendingCleanup commits.
		const statusMessageId = await this.state.storage.get<number>("statusMessageId");
		const pendingCleanup = await this.state.storage.get<boolean>("pendingCleanup");
		const priorPhase = await this.state.storage.get<Phase>("phase");
		const isPostTerminal = priorPhase === "DONE" || priorPhase === "FAILED";
		if (
			prior &&
			prior.replicaId === body.replicaId &&
			statusMessageId !== undefined &&
			!pendingCleanup &&
			!isPostTerminal
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
			await this.state.storage.put({ watch: body, lines, lastRendered: "" });
			console.log(`[poller] /watch steer replica=${body.replicaId} msg=${body.startMessageId}`);
			await this.renderAndSend();
			return new Response("ok");
		}

		// Run the baseline snapshot in parallel with the storage reset.
		const baselineP = this.snapshotEventCount(body.replicaId);
		await this.state.storage.delete([
			"statusMessageId",
			"pendingCleanup",
			"lastRendered",
			"pinned",
			"lastChatActionAt",
			"lastEditAt",
			"plan",
			"persistedAssistantText",
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
		// Adopt the pre-sent Starting frame as our statusMessageId so the
		// poller edits it on the next render instead of sending fresh.
		if (typeof body.initialStatusMessageId === "number") {
			seed.statusMessageId = body.initialStatusMessageId;
		}
		await this.state.storage.put(seed);
		console.log(`[poller] /watch replica=${body.replicaId} baseline=${baseline}`);

		// Render initial frame + schedule first poll in parallel. (Worker
		// already set the 👀 reaction before calling /watch, so don't repeat
		// it here.)
		await Promise.all([
			this.renderAndSend(),
			this.state.storage.setAlarm(Date.now() + FIRST_POLL_DELAY_MS),
		]);
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
		// One batched read of every key we'll touch this tick — saves ~50ms
		// vs. the previous pattern of awaiting 6+ individual storage.get()s.
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
		const lastFreshAt =
			(await this.state.storage.get<number>("lastFreshAt")) ?? startedAt;
		const idleMs = Date.now() - lastFreshAt;
		if (idleMs > IDLE_TIMEOUT_MS) {
			// Idle timeout. Wall-clock cap removed; treats "no new
			// /history events for IDLE_TIMEOUT_MS" as stuck. Cancel
			// upstream replica + flush KV.
			try {
				await fetch(`${this.env.REPLICAS_API_BASE}/replica/${watch.replicaId}`, {
					method: "DELETE",
					headers: replicasHeaders(this.env),
				});
				console.log(`[poller] idle-timeout: deleted upstream replica ${watch.replicaId}`);
			} catch (e) {
				console.log(`[poller] idle-timeout: replica delete failed: ${e instanceof Error ? e.message : e}`);
			}
			try {
				const chatKey = `chat:${watch.chatId}:thread:${watch.threadId ?? "main"}`;
				await this.env.MAP.delete(chatKey);
			} catch (e) {
				console.log(`[poller] idle-timeout: KV cleanup failed: ${e instanceof Error ? e.message : e}`);
			}
			await this.state.storage.deleteAll();
			return;
		}

		const pendingCleanup = snap.get("pendingCleanup") as boolean | undefined;
		if (pendingCleanup) {
			await this.unpin(watch);
			await this.state.storage.deleteAll();
			return;
		}

		const lastSeenCount = (snap.get("lastSeenCount") as number | undefined) ?? 0;
		// Kick off the /history fetch immediately — we'll continue prepping
		// local state in parallel while the network call is in flight.
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
		// Stamp lastFreshAt whenever new events arrive so the idle
		// timeout above measures actual silence.
		if (fresh.length > 0) {
			await this.state.storage.put("lastFreshAt", Date.now());
		}

		const lines = (snap.get("lines") as string[] | undefined) ?? [];
		let phase = (snap.get("phase") as Phase | undefined) ?? "STARTING";
		let stepCount = (snap.get("stepCount") as number | undefined) ?? 0;
		let currentAction = (snap.get("currentAction") as string | undefined) ?? "";
		let plan = (snap.get("plan") as PlanState | undefined) ?? null;
		let systemInfo = (await this.state.storage.get<SystemInfo>("systemInfo")) ?? null;
		let contextUsage = (await this.state.storage.get<ContextUsage>("contextUsage")) ?? null;
		let resultMeta = (await this.state.storage.get<ResultMeta>("resultMeta")) ?? null;

		let sawResult = false;
		let resultText: string | null = null;
		// Persisted across ticks: last claude-assistant text block. Used as
		// fallback when claude-result lands in a later tick with no
		// payload.result. Matrix bridge had the same race; both fixed.
		const persistedAssistantText =
			(await this.state.storage.get<string>("persistedAssistantText")) ?? null;
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
						const cmd = typeof block.input?.command === "string" ? (block.input.command as string) : undefined;
						phase = phaseFor(block.name ?? "tool", cmd);
						const line = formatToolUseLine(block.name ?? "tool", (block.input ?? {}) as Record<string, unknown>);
						currentAction = line;
						lines.push(line);
						stepCount += 1;
						appended = true;
					} else if (block.type === "text" && block.text) {
						pendingAssistantText = block.text;
						// The agent sometimes emits a structured "Plan (X/N)"
						// block with ~item~ strikethrough on done steps. That
						// shouldn't go through the truncated italic narration
						// path — capture it as a dedicated plan block instead.
						// Ported from matrix bridge: only accept Plan(d/t)
						// headers BEFORE any tool calls and before any prior
						// plan has been parsed. Prevents a confused or
						// adversarial agent from overwriting in-progress view
						// by emitting mid-turn fake completion.
						const planEligible = stepCount === 0 && plan === null;
						const parsedPlan = planEligible ? parsePlan(block.text) : null;
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

		// Fallback: prefer this tick's local text, then persisted-across-tick
		// text. Catches the race where the final assistant text and the
		// claude-result land in separate alarm intervals.
		if (!resultText && sawResult) {
			resultText = pendingAssistantText ?? persistedAssistantText;
		}

		// When a final markdown reply is coming, drop ANY trailing 💬
		// narration lines that have accumulated across ticks — the full
		// markdown reply that lands as the next message carries the same
		// content in full. Using lastTextNarrationIdx alone misses this
		// when the text and claude-result arrive in different ticks (the
		// index is per-tick and resets to null on each alarm).
		void lastTextNarrationIdx;
		if (sawResult && !resultIsError && resultText) {
			while (lines.length > 0 && lines[lines.length - 1]!.startsWith("💬 ")) {
				lines.pop();
			}
		}

		// Ported from matrix bridge: cap unbounded lines[] growth on
		// thinking-heavy turns. Long planning sessions push hundreds of
		// `💬` narration lines that bloat the serialized state on every
		// alarm tick. Cap at LINES_HARD_CAP entries by dropping OLDEST
		// non-protected lines first; tool lifecycle markers stay.
		const LINES_HARD_CAP = 300;
		if (lines.length > LINES_HARD_CAP) {
			const isProtected = (l: string): boolean =>
				l.startsWith("🔄 ") || l.startsWith("✅ ") || l.startsWith("❌ ") ||
				l.startsWith("💬 <i>You:");
			let i = 0;
			let dropped = 0;
			while (i < lines.length && lines.length > LINES_HARD_CAP) {
				if (!isProtected(lines[i]!)) {
					lines.splice(i, 1);
					dropped++;
				} else {
					i += 1;
				}
			}
			if (dropped > 0) console.log(`[poller] lines cap: dropped ${dropped} non-tool lines`);
		}

		// Batched write of all mutated fields + lastSeenCount.
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
		// Persist latest assistant text across ticks for the cross-tick
		// race fix described above.
		if (pendingAssistantText) writes.persistedAssistantText = pendingAssistantText;
		await this.state.storage.put(writes);

		console.log(
			`[poller] events=${events.length} fresh=${fresh.length} phase=${phase} step=${stepCount} sawResult=${sawResult}`,
		);

		// Keep typing animation alive while we poll.
		await this.maybeChatAction(watch, phase);

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

			// Persist the final reply so subsequent ticks can retry on send
			// failure (long turns occasionally drop the message mid-Promise.all
			// and leave the user with a Done frame but no answer).
			if (resultText) await this.state.storage.put("pendingFinalReply", resultText);

			await this.setTerminal(watch, { kind: "done", durationSec: seconds });

			await this.flushFinalReply(watch);

			const stillPending = await this.state.storage.get<string>("pendingFinalReply");
			if (!stillPending) {
				await this.state.storage.put("pendingCleanup", true);
				await this.state.storage.setAlarm(Date.now() + 30_000);
			} else {
				await this.state.storage.setAlarm(Date.now() + 2_000);
			}
			return;
		}

		// Drain pendingFinalReply on every tick — first attempt may have lost
		// the message, retries until Telegram accepts. This branch is
		// SELF-TERMINATING: once the drain succeeds we transition straight
		// to the 30s cleanup alarm; while it's still failing we retry every
		// 2s. We must NOT fall through to the active-poll ticker below
		// because that would (a) keep re-editing the Done frame with an
		// ever-increasing elapsed time and (b) reset the alarm to 180ms,
		// canceling the proper cleanup transition entirely.
		const pendingReply = await this.state.storage.get<string>("pendingFinalReply");
		if (pendingReply) {
			await this.flushFinalReply(watch);
			const stillPending = await this.state.storage.get<string>("pendingFinalReply");
			if (stillPending) {
				await this.state.storage.setAlarm(Date.now() + 2_000);
			} else {
				await this.state.storage.put("pendingCleanup", true);
				await this.state.storage.setAlarm(Date.now() + 30_000);
			}
			return;
		}

		// Render conditions:
		// - Anything was appended
		// - currentAction changed (thinking preview updated)
		// - Or the ticker is stale (force a refresh so ⏱ stays alive)
		const lastEditAt = (await this.state.storage.get<number>("lastEditAt")) ?? 0;
		const tickerStale = Date.now() - lastEditAt >= TICKER_REFRESH_MS;
		if (appended || currentAction || tickerStale) {
			await this.renderAndSend();
		}
		// Slow-poll after SLOW_POLL_THRESHOLD_MS of silence — saves
		// cost during agent thinking phases without giving up the watch.
		const lastFreshSeen =
			(await this.state.storage.get<number>("lastFreshAt")) ?? startedAt;
		const idleSoFar = Date.now() - lastFreshSeen;
		const nextDelay =
			idleSoFar > SLOW_POLL_THRESHOLD_MS ? SLOW_POLL_INTERVAL_MS : ACTIVE_POLL_INTERVAL_MS;
		await this.state.storage.setAlarm(Date.now() + nextDelay);
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

		// Telegram rate guard: don't edit the same message more than once per
		// ~900ms. If we're inside the window, leave the state intact so the
		// next alarm picks up the freshest version (including the ticker tick).
		// Terminal edits (Done/Failed) bypass — they MUST land, since the
		// rolling-log freeze depends on them and there's no follow-up tick.
		const lastEditAt = (await this.state.storage.get<number>("lastEditAt")) ?? 0;
		const since = Date.now() - lastEditAt;
		const messageId = await this.state.storage.get<number>("statusMessageId");
		const isTerminal = s.terminal !== undefined;
		if (!isTerminal && messageId !== undefined && since < EDIT_MIN_INTERVAL_MS) return;

		await this.state.storage.put({ lastRendered: text, lastEditAt: Date.now() });

		const replyMarkup = inlineKeyboard(watch.replicaId, !!s.terminal);

		if (messageId !== undefined) {
			const ok = await this.editStatus(watch, messageId, text, replyMarkup);
			if (ok) return;
		}
		const newId = await this.sendStatus(watch, text, replyMarkup);
		if (newId !== null) {
			await this.state.storage.put("statusMessageId", newId);
			if (!(await this.state.storage.get<boolean>("pinned"))) {
				await this.pin(watch, newId);
				await this.state.storage.put("pinned", true);
			}
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
		await this.unpin(watch);
		if (watch.startMessageId !== undefined) {
			await this.setReaction(watch, terminal.kind === "done" ? "🎉" : "😭", true);
		}
	}

	private async sendReply(watch: WatchSpec, text: string): Promise<boolean> {
		try {
			// Phase 2 mirror mode: when the user prompt was a voice msg,
			// synthesize the reply with TTS and ship via sendVoice
			// instead of text. Falls back to text on TTS failure so the
			// user always gets the answer.
			if (watch.replyAsVoice) {
				const ok = await this.sendVoiceReply(watch, text);
				if (ok) return true;
				console.log(`[poller] voice reply failed — falling back to text`);
			}
			// OpenACP-style: split the reply markdown on natural
			// boundaries (paragraphs, headings, code blocks, lists)
			// instead of slicing mid-sentence at REPLY_MAX_LEN. Each
			// chunk lands as its own chat message so the user reads
			// the answer as a conversation. The REPLY_MAX_LEN safety
			// net stays — if a single chunk is still too long for
			// Telegram (rare oversize code block), we hard-cut to the
			// limit and fire it solo.
			const chunks = splitMarkdownReply(text, { maxChars: REPLY_MAX_LEN - 200 });
			let first = true;
			for (const chunk of chunks) {
				if (!first) await sleep(800);
				first = false;
				let piece = chunk;
				if (piece.length > REPLY_MAX_LEN) piece = piece.slice(0, REPLY_MAX_LEN);
				await this.sendFormattedReplyChunk(watch, piece);
			}
			return true;
		} catch (e) {
			console.log(`[poller] sendReply failed: ${e instanceof Error ? e.message : e}`);
			return false;
		}
	}

	/**
	 * Phase 2 outbound TTS for Telegram. Synthesize the reply via OpenAI
	 * TTS, ship to Telegram as a voice message via sendVoice. Returns
	 * true on success; false (caller falls back to text) otherwise.
	 *
	 * Telegram's sendVoice accepts OGG/Opus directly — same format
	 * OpenAI TTS emits. No transcoding needed.
	 */
	private async sendVoiceReply(watch: WatchSpec, replyMarkdown: string): Promise<boolean> {
		try {
			const spoken = stripMarkdownForTts(replyMarkdown);
			if (!spoken) return false;
			const tts = await synthesizeSpeech({ OPENAI_API_KEY: this.env.OPENAI_API_KEY }, spoken);
			if (!tts.ok || !tts.audio) {
				console.log(`[poller] TTS failed: ${tts.error}`);
				return false;
			}
			const form = new FormData();
			form.append("chat_id", String(watch.chatId));
			if (watch.threadId !== undefined) form.append("message_thread_id", String(watch.threadId));
			if (watch.startMessageId !== undefined) {
				form.append("reply_parameters", JSON.stringify({ message_id: watch.startMessageId }));
			}
			form.append("voice", new Blob([tts.audio], { type: "audio/ogg" }), "voice.ogg");
			const r = await fetch(`${this.env.TG_API_BASE}/bot${this.env.TG_TOKEN}/sendVoice`, {
				method: "POST",
				body: form,
			});
			if (!r.ok) {
				const errBody = await r.text();
				console.log(`[poller] sendVoice failed: ${r.status} ${errBody.slice(0, 200)}`);
				return false;
			}
			console.log(`[poller] voice reply shipped chat=${watch.chatId}`);
			return true;
		} catch (e) {
			console.log(`[poller] sendVoiceReply threw: ${e instanceof Error ? e.message : e}`);
			return false;
		}
	}

	// Drain pendingFinalReply: retry on every alarm tick until Telegram
	// accepts. Delete-after-success is crash-safe — if the worker dies
	// mid-send the slot survives and the next alarm tick retries.
	private async flushFinalReply(watch: WatchSpec): Promise<void> {
		const pending = await this.state.storage.get<string>("pendingFinalReply");
		if (!pending) return;
		const ok = await this.sendReply(watch, pending);
		if (ok) {
			await this.state.storage.delete("pendingFinalReply");
			console.log(`[poller] pendingFinalReply flushed (len=${pending.length})`);
		} else {
			console.log(`[poller] pendingFinalReply retry will fire next alarm`);
		}
	}

	private async sendFormattedReplyChunk(watch: WatchSpec, piece: string): Promise<void> {
		const html = markdownToTelegramHtml(piece);
		const params = new URLSearchParams();
		params.set("chat_id", String(watch.chatId));
		if (watch.threadId !== undefined) params.set("message_thread_id", String(watch.threadId));
		params.set("text", html);
		params.set("parse_mode", "HTML");
		const r = await this.tgCall("sendMessage", params);
		const t = await r.text();
		if (t.includes('"ok":true')) return;
		console.log(`[poller] sendReply HTML failed, retry plain: ${t.slice(0, 200)}`);
		const fallback = new URLSearchParams();
		fallback.set("chat_id", String(watch.chatId));
		if (watch.threadId !== undefined) fallback.set("message_thread_id", String(watch.threadId));
		fallback.set("text", piece);
		await this.tgCall("sendMessage", fallback);
	}

	private async editStatus(
		watch: WatchSpec,
		mid: number,
		text: string,
		replyMarkup: string,
	): Promise<boolean> {
		const params = new URLSearchParams();
		params.set("chat_id", String(watch.chatId));
		params.set("message_id", String(mid));
		params.set("text", text);
		params.set("parse_mode", "HTML");
		params.set("reply_markup", replyMarkup);
		const r = await this.tgCall("editMessageText", params);
		const t = await r.text();
		if (t.includes('"ok":true')) return true;
		if (t.includes("message is not modified")) return true;
		console.log(`[poller] editMessageText failed: ${t.slice(0, 200)}`);
		return false;
	}

	private async sendStatus(watch: WatchSpec, text: string, replyMarkup: string): Promise<number | null> {
		const params = new URLSearchParams();
		params.set("chat_id", String(watch.chatId));
		if (watch.threadId !== undefined) params.set("message_thread_id", String(watch.threadId));
		if (watch.startMessageId !== undefined) {
			params.set("reply_parameters", JSON.stringify({ message_id: watch.startMessageId, allow_sending_without_reply: true }));
		}
		params.set("text", text);
		params.set("parse_mode", "HTML");
		params.set("reply_markup", replyMarkup);
		params.set("disable_notification", "true");
		const r = await this.tgCall("sendMessage", params);
		const t = await r.text();
		const m = t.match(/"message_id"\s*:\s*(\d+)/);
		if (!m) console.log(`[poller] sendStatus failed: ${t.slice(0, 200)}`);
		return m ? parseInt(m[1]!, 10) : null;
	}

	private async setReaction(watch: WatchSpec, emoji: string, isBig: boolean): Promise<void> {
		if (watch.startMessageId === undefined) return;
		const params = new URLSearchParams();
		params.set("chat_id", String(watch.chatId));
		params.set("message_id", String(watch.startMessageId));
		params.set("reaction", JSON.stringify([{ type: "emoji", emoji }]));
		if (isBig) params.set("is_big", "true");
		await this.tgCall("setMessageReaction", params).catch(() => {});
	}

	private async pin(watch: WatchSpec, messageId: number): Promise<void> {
		const params = new URLSearchParams();
		params.set("chat_id", String(watch.chatId));
		params.set("message_id", String(messageId));
		params.set("disable_notification", "true");
		await this.tgCall("pinChatMessage", params).catch(() => {});
	}

	private async unpin(watch: WatchSpec): Promise<void> {
		const messageId = await this.state.storage.get<number>("statusMessageId");
		if (messageId === undefined) return;
		const params = new URLSearchParams();
		params.set("chat_id", String(watch.chatId));
		params.set("message_id", String(messageId));
		await this.tgCall("unpinChatMessage", params).catch(() => {});
	}

	private async maybeChatAction(watch: WatchSpec, phase: Phase): Promise<void> {
		const last = (await this.state.storage.get<number>("lastChatActionAt")) ?? 0;
		if (Date.now() - last < CHAT_ACTION_INTERVAL_MS) return;
		const action = chatActionFor(phase);
		const params = new URLSearchParams();
		params.set("chat_id", String(watch.chatId));
		params.set("action", action);
		await this.tgCall("sendChatAction", params).catch(() => {});
		await this.state.storage.put("lastChatActionAt", Date.now());
	}

	private async tgCall(method: string, params: URLSearchParams): Promise<Response> {
		return fetch(`${this.env.TG_API_BASE}/bot${this.env.TG_TOKEN}/${method}`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: params.toString(),
		});
	}
}

function replicasHeaders(env: Env): HeadersInit {
	return {
		Authorization: `Bearer ${env.REPLICAS_API_KEY}`,
		"Replicas-Org-Id": env.REPLICAS_ORG_ID,
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((res) => setTimeout(res, ms));
}

function chatActionFor(phase: Phase): string {
	switch (phase) {
		case "EDITING":
			return "upload_document";
		case "SHIPPING":
			return "upload_document";
		default:
			return "typing";
	}
}

function inlineKeyboard(replicaId: string, terminal: boolean): string {
	const dashboardUrl = `${DASHBOARD_BASE}${replicaId}`;
	if (terminal) {
		return JSON.stringify({
			inline_keyboard: [
				[
					{ text: "📜 Open log", url: dashboardUrl },
				],
			],
		});
	}
	return JSON.stringify({
		inline_keyboard: [
			[
				{ text: "✋ Cancel", callback_data: `c:${replicaId.slice(0, 36)}` },
				{ text: "📜 Open log", url: dashboardUrl },
			],
		],
	});
}

// Re-export so tests can pin the public surface.
export { inlineKeyboard, chatActionFor };
// Used by phaseToReactionEmoji import in tests.
export { phaseToReactionEmoji };
