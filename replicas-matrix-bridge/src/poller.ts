import type { Env } from "./index";
import { markdownToTelegramHtml as markdownToHtml } from "./markdown";
import { editMessage, react, redact, sendMessage, typing, unpin, pin } from "./matrix";
import {
	formatToolUseLine,
	parsePlan,
	phaseFor,
	render,
	thinkingLine,
	type Phase,
	type PlanState,
	type StatusState,
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
}

interface HistoryResponse {
	events?: HistoryEvent[];
	total?: number;
}

const FIRST_POLL_DELAY_MS = 150;
const ACTIVE_POLL_INTERVAL_MS = 300;
const BACKOFF_POLL_INTERVAL_MS = 3000;
const MAX_WATCH_DURATION_MS = 30 * 60 * 1000;
const EDIT_MIN_INTERVAL_MS = 900;
const TICKER_REFRESH_MS = 2000;
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
			await this.state.storage.put({ watch: body, lines, lastRendered: "" });
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
		await this.state.storage.put({
			watch: body,
			lastSeenCount: baseline,
			lines: [],
			stepCount: 0,
			phase: "STARTING",
			currentAction: "",
			startedAt: Date.now(),
		});
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

		let sawResult = false;
		let resultText: string | null = null;
		let resultIsError = false;
		let resultErrorMsg: string | null = null;
		let pendingAssistantText: string | null = null;
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
						} else {
							const narration = thinkingLine(block.text);
							currentAction = narration;
							lines.push(`💬 ${narration}`);
							appended = true;
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
			}
		}

		if (!resultText && sawResult && pendingAssistantText) resultText = pendingAssistantText;

		const writes: Record<string, unknown> = {
			lines,
			phase,
			stepCount,
			currentAction,
			lastSeenCount: events.length,
		};
		if (plan) writes.plan = plan;
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
			} else {
				const replyP = resultText ? this.sendFinalReply(watch, resultText) : Promise.resolve();
				await Promise.all([
					this.setTerminal(watch, { kind: "done", durationSec: seconds }),
					replyP,
				]);
			}
			await this.state.storage.put("pendingCleanup", true);
			await this.state.storage.setAlarm(Date.now() + 30_000);
			return;
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
		if (statusEventId !== undefined && since < EDIT_MIN_INTERVAL_MS) return;

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

	private async sendFinalReply(watch: WatchSpec, text: string): Promise<void> {
		const html = markdownToHtml(text.slice(0, REPLY_MAX_LEN));
		try {
			await sendMessage(matrixEnv(this.env), watch.roomId, html);
		} catch (e) {
			console.log(`[poller] sendFinalReply failed: ${e instanceof Error ? e.message : e}`);
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
