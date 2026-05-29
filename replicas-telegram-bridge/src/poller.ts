import type { Env } from "./index";

interface WatchSpec {
	replicaId: string;
	chatId: number;
	threadId?: number;
	startMessageId?: number;
}

interface HistoryEvent {
	type?: string;
	payload?: {
		message?: {
			content?: ContentBlock[];
		};
		result?: string;
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
}

const FIRST_POLL_DELAY_MS = 1500;
const ACTIVE_POLL_INTERVAL_MS = 2000;
const BACKOFF_POLL_INTERVAL_MS = 6000;
const MAX_WATCH_DURATION_MS = 30 * 60 * 1000; // give up after 30 min
const STATUS_MAX_LEN = 200;
const REPLY_MAX_LEN = 4000;

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
			const body = (await req.json()) as WatchSpec;
			await this.state.storage.put("watch", body);
			await this.state.storage.put("lastSeenCount", 0);
			await this.state.storage.put("lastStatusText", "");
			await this.state.storage.put("startedAt", Date.now());
			await this.state.storage.delete("statusMessageId");
			await this.state.storage.setAlarm(Date.now() + FIRST_POLL_DELAY_MS);
			return new Response("ok");
		}
		if (req.method === "POST" && url.pathname === "/stop") {
			await this.state.storage.deleteAlarm();
			await this.state.storage.deleteAll();
			return new Response("ok");
		}
		return new Response("not found", { status: 404 });
	}

	async alarm(): Promise<void> {
		try {
			await this.alarmInner();
		} catch (e) {
			console.error("[poller] alarm threw", e instanceof Error ? e.message : String(e));
			// Re-arm after backoff so we don't get stuck.
			try {
				await this.state.storage.setAlarm(Date.now() + BACKOFF_POLL_INTERVAL_MS);
			} catch {
				// give up
			}
		}
	}

	private async alarmInner(): Promise<void> {
		const watch = await this.state.storage.get<WatchSpec>("watch");
		if (!watch) {
			console.log("[poller] no watch — exiting alarm");
			return;
		}

		const startedAt = (await this.state.storage.get<number>("startedAt")) ?? Date.now();
		if (Date.now() - startedAt > MAX_WATCH_DURATION_MS) {
			console.log("[poller] watch exceeded max duration");
			await this.state.storage.deleteAll();
			return;
		}

		const lastSeenCount = (await this.state.storage.get<number>("lastSeenCount")) ?? 0;

		const r = await fetch(
			`${this.env.REPLICAS_API_BASE}/replica/${watch.replicaId}/history?limit=200&include=content&verbose=1`,
			{
				headers: {
					Authorization: `Bearer ${this.env.REPLICAS_API_KEY}`,
					"Replicas-Org-Id": this.env.REPLICAS_ORG_ID,
				},
			},
		);

		if (!r.ok) {
			console.log(`[poller] /history ${r.status}; replicaId=${watch.replicaId}`);
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
		let newStatus: string | null = null;
		let finalReply: string | null = null;
		let sawResult = false;
		let pendingAssistantText: string | null = null;

		for (const ev of fresh) {
			const t = ev.type ?? "";
			const blocks = ev.payload?.message?.content ?? [];

			if (t === "claude-assistant") {
				for (const block of blocks) {
					if (block.type === "thinking" && block.thinking) {
						newStatus = "🤔 " + truncate(block.thinking, STATUS_MAX_LEN);
					} else if (block.type === "tool_use") {
						newStatus = formatToolUse(block);
					} else if (block.type === "text" && block.text) {
						pendingAssistantText = block.text;
					}
				}
			} else if (t === "claude-result") {
				sawResult = true;
				if (ev.payload?.result) finalReply = ev.payload.result;
			}
		}

		if (!finalReply && sawResult && pendingAssistantText) {
			finalReply = pendingAssistantText;
		}

		console.log(
			`[poller] events=${events.length} fresh=${fresh.length} newStatus=${newStatus ? "yes" : "no"} sawResult=${sawResult}`,
		);

		if (newStatus) {
			const prev = (await this.state.storage.get<string>("lastStatusText")) ?? "";
			if (newStatus !== prev) {
				await this.upsertStatus(watch, newStatus);
				await this.state.storage.put("lastStatusText", newStatus);
			}
		}

		await this.state.storage.put("lastSeenCount", events.length);

		if (sawResult) {
			if (finalReply) {
				console.log(`[poller] sending final reply (${finalReply.length} chars)`);
				await this.sendReply(watch, finalReply);
			}
			// keep state around briefly in case follow-up arrives, then clean
			await this.state.storage.setAlarm(Date.now() + 30_000);
			await this.state.storage.put("pendingCleanup", true);
			return;
		}

		const pendingCleanup = await this.state.storage.get<boolean>("pendingCleanup");
		if (pendingCleanup) {
			await this.state.storage.deleteAll();
			return;
		}

		await this.state.storage.setAlarm(Date.now() + ACTIVE_POLL_INTERVAL_MS);
	}

	private async upsertStatus(watch: WatchSpec, text: string): Promise<void> {
		const mid = await this.state.storage.get<number>("statusMessageId");
		if (mid !== undefined) {
			const ok = await this.editStatusMessage(watch, mid, text);
			if (ok) return;
		}
		const newMid = await this.sendStatusMessage(watch, text);
		if (newMid !== null) await this.state.storage.put("statusMessageId", newMid);
	}

	private async editStatusMessage(watch: WatchSpec, mid: number, text: string): Promise<boolean> {
		const params = new URLSearchParams();
		params.set("chat_id", String(watch.chatId));
		params.set("message_id", String(mid));
		params.set("text", text);
		const r = await this.tgCall("editMessageText", params);
		const t = await r.text();
		if (t.includes('"ok":true')) return true;
		if (t.includes("message is not modified")) return true;
		console.log(`[poller] editMessageText failed: ${t.slice(0, 200)}`);
		return false;
	}

	private async sendStatusMessage(watch: WatchSpec, text: string): Promise<number | null> {
		const params = new URLSearchParams();
		params.set("chat_id", String(watch.chatId));
		if (watch.threadId !== undefined) params.set("message_thread_id", String(watch.threadId));
		params.set("text", text);
		const r = await this.tgCall("sendMessage", params);
		const t = await r.text();
		const m = t.match(/"message_id"\s*:\s*(\d+)/);
		if (!m) console.log(`[poller] sendStatusMessage failed: ${t.slice(0, 200)}`);
		return m ? parseInt(m[1]!, 10) : null;
	}

	private async sendReply(watch: WatchSpec, text: string): Promise<void> {
		let body = text;
		while (body.length > 0) {
			const piece = body.slice(0, REPLY_MAX_LEN);
			body = body.slice(REPLY_MAX_LEN);
			const params = new URLSearchParams();
			params.set("chat_id", String(watch.chatId));
			if (watch.threadId !== undefined) params.set("message_thread_id", String(watch.threadId));
			params.set("text", piece);
			const r = await this.tgCall("sendMessage", params);
			const t = await r.text();
			if (!t.includes('"ok":true')) {
				console.log(`[poller] sendReply failed: ${t.slice(0, 200)}`);
			}
			if (body.length > 0) await new Promise((res) => setTimeout(res, 1100));
		}
	}

	private async tgCall(method: string, params: URLSearchParams): Promise<Response> {
		return fetch(`${this.env.TG_API_BASE}/bot${this.env.TG_TOKEN}/${method}`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: params.toString(),
		});
	}
}

function truncate(s: string, n: number): string {
	if (s.length <= n) return s;
	return s.slice(0, n - 1) + "…";
}

function formatToolUse(block: ContentBlock): string {
	const name = block.name ?? "tool";
	const input = (block.input ?? {}) as Record<string, string | undefined>;
	switch (name) {
		case "Bash":
			return "🔧 $ " + truncate(input.command ?? "", STATUS_MAX_LEN);
		case "Read":
			return "📖 " + truncate(input.file_path ?? "", STATUS_MAX_LEN);
		case "Write":
			return "📝 write " + truncate(input.file_path ?? "", STATUS_MAX_LEN);
		case "Edit":
			return "✏️ edit " + truncate(input.file_path ?? "", STATUS_MAX_LEN);
		case "Grep":
			return "🔍 grep " + truncate(input.pattern ?? "", STATUS_MAX_LEN);
		case "Glob":
			return "🔍 glob " + truncate(input.pattern ?? "", STATUS_MAX_LEN);
		case "WebFetch":
		case "WebSearch":
			return "🌐 " + truncate(input.url ?? input.query ?? "", STATUS_MAX_LEN);
		default:
			if (name.startsWith("mcp__")) {
				return "🧰 " + truncate(name.replace(/^mcp__/, ""), STATUS_MAX_LEN);
			}
			return "🔧 " + truncate(name, STATUS_MAX_LEN);
	}
}
