import type { Env } from "./index";
import { markdownToTelegramHtml } from "./markdown";
import {
	formatToolUseLine,
	parsePlan,
	phaseFor,
	phaseToReactionEmoji,
	render,
	thinkingLine,
	type Phase,
	type PlanState,
	type StatusState,
} from "./render";

interface WatchSpec {
	replicaId: string;
	chatId: number;
	threadId?: number;
	startMessageId?: number;
	userText?: string;
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
}

interface HistoryResponse {
	events?: HistoryEvent[];
	total?: number;
}

const FIRST_POLL_DELAY_MS = 150;
const ACTIVE_POLL_INTERVAL_MS = 300;
const BACKOFF_POLL_INTERVAL_MS = 3000;
const MAX_WATCH_DURATION_MS = 30 * 60 * 1000;
// Telegram permits ~1 editMessageText per chat per second; we leave a small
// margin so a burst of polls coalesces into at most one edit per ~900ms.
const EDIT_MIN_INTERVAL_MS = 900;
// Even without new events, refresh the rendered status if at least this
// long has passed so the ⏱ ticker stays live.
const TICKER_REFRESH_MS = 2000;
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
		if (Date.now() - startedAt > MAX_WATCH_DURATION_MS) {
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

		// Batched write of all mutated fields + lastSeenCount.
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

		// Keep typing animation alive while we poll.
		await this.maybeChatAction(watch, phase);

		if (sawResult) {
			const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
			// Fire terminal status update and the final reply in parallel — no
			// reason to serialize the two Telegram calls.
			if (resultIsError) {
				await this.setTerminal(watch, {
					kind: "failed",
					durationSec: seconds,
					errorMsg: resultErrorMsg ?? "agent error",
				});
			} else {
				const replyPromise = resultText ? this.sendReply(watch, resultText) : Promise.resolve();
				await Promise.all([
					this.setTerminal(watch, { kind: "done", durationSec: seconds }),
					replyPromise,
				]);
			}
			await this.state.storage.put("pendingCleanup", true);
			await this.state.storage.setAlarm(Date.now() + 30_000);
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

		// Telegram rate guard: don't edit the same message more than once per
		// ~900ms. If we're inside the window, leave the state intact so the
		// next alarm picks up the freshest version (including the ticker tick).
		const lastEditAt = (await this.state.storage.get<number>("lastEditAt")) ?? 0;
		const since = Date.now() - lastEditAt;
		const messageId = await this.state.storage.get<number>("statusMessageId");
		if (messageId !== undefined && since < EDIT_MIN_INTERVAL_MS) return;

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

	private async sendReply(watch: WatchSpec, text: string): Promise<void> {
		let body = text;
		let first = true;
		while (body.length > 0) {
			if (!first) await sleep(1100);
			first = false;
			const piece = body.slice(0, REPLY_MAX_LEN);
			body = body.slice(REPLY_MAX_LEN);
			await this.sendFormattedReplyChunk(watch, piece);
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
