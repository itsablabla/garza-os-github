// Voice-message transcription for the Telegram bridge — mirror of the
// matrix bridge's transcribe.ts. Same OpenAI Whisper API + same shape
// so a future provider abstraction can be lifted to a shared package.
//
// Trigger: TG sends voice messages as `message.voice` (OGG/Opus) and
// non-voice audio uploads as `message.audio` (MP3/M4A). We transcribe
// voice only; non-voice audio is passed through unchanged.

export interface TranscribeEnv {
	OPENAI_API_KEY?: string;
}

export interface TranscribeResult {
	ok: boolean;
	text: string;
	provider: "openai-whisper" | "none";
	error?: string;
}

const OPENAI_WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export async function transcribeAudio(
	env: TranscribeEnv,
	audio: ArrayBuffer,
	filename: string,
	mimetype: string,
): Promise<TranscribeResult> {
	if (!env.OPENAI_API_KEY) {
		return { ok: false, text: "", provider: "none", error: "OPENAI_API_KEY not configured" };
	}
	if (audio.byteLength > MAX_AUDIO_BYTES) {
		return {
			ok: false,
			text: "",
			provider: "openai-whisper",
			error: `audio too large (${audio.byteLength} bytes)`,
		};
	}

	const form = new FormData();
	form.append("file", new Blob([audio], { type: mimetype }), filename);
	form.append("model", "whisper-1");
	form.append("response_format", "json");

	try {
		const r = await fetch(OPENAI_WHISPER_URL, {
			method: "POST",
			headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
			body: form,
		});
		if (!r.ok) {
			const errBody = await r.text();
			return {
				ok: false,
				text: "",
				provider: "openai-whisper",
				error: `whisper ${r.status}: ${errBody.slice(0, 200)}`,
			};
		}
		const j = (await r.json()) as { text?: string };
		const text = (j.text ?? "").trim();
		if (!text) {
			return { ok: false, text: "", provider: "openai-whisper", error: "empty transcript" };
		}
		return { ok: true, text, provider: "openai-whisper" };
	} catch (e) {
		return {
			ok: false,
			text: "",
			provider: "openai-whisper",
			error: e instanceof Error ? e.message : String(e),
		};
	}
}

export function formatVoiceDuration(durationSec: number): string {
	const sec = Math.max(0, Math.round(durationSec));
	if (sec < 60) return `${sec}s`;
	const m = Math.floor(sec / 60);
	const s = sec % 60;
	return s > 0 ? `${m}m ${s}s` : `${m}m`;
}
