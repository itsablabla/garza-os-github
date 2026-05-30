// Voice-message transcription via OpenAI Whisper API.
//
// Phase 1 (inbound): the listener spots m.audio + msc3245.voice events,
// downloads the audio (decrypting E2EE if needed), POSTs to Whisper, and
// dispatches the transcript as plain text to the existing Replicas
// pipeline. The agent sees `🎤 (voice 4s) <transcript>` as the prompt
// so it can adjust its reply style if it wants.
//
// Provider abstraction is intentionally tiny — one function with a
// stable shape so we can swap to Deepgram, ElevenLabs STT, or
// Replicas-mediated transcription later without touching call sites.

export interface TranscribeEnv {
	OPENAI_API_KEY?: string;
}

export interface TranscribeResult {
	ok: boolean;
	text: string;
	durationMs?: number;
	provider: "openai-whisper" | "none";
	error?: string;
}

const OPENAI_WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";

// Whisper supports OGG/Opus directly (the Matrix voice-msg format) plus
// mp3/wav/m4a/webm/flac. Max 25MB request body. Beeper voice messages
// are OGG/Opus and typically <100KB per minute of audio.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/**
 * Transcribe a voice-message audio blob via OpenAI Whisper. Returns the
 * raw transcript text on success, or an error result the caller can log
 * + surface to the user.
 *
 * Costs ~$0.006/min as of 2026-05. Single round-trip, ~1-3s p50 for a
 * 10s clip on a warm CF Worker.
 */
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
			error: `audio too large (${audio.byteLength} bytes > ${MAX_AUDIO_BYTES})`,
		};
	}

	const form = new FormData();
	form.append("file", new Blob([audio], { type: mimetype }), filename);
	form.append("model", "whisper-1");
	form.append("response_format", "json");
	// Leave language unset so Whisper auto-detects.

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

/**
 * Format a voice-message duration (in ms) as the human label used in
 * the dispatched prompt header: "🎤 (voice 4s) <transcript>". Sub-
 * minute clips show seconds; >1 min shows "Nm Ss".
 */
export function formatVoiceDuration(durationMs: number): string {
	const sec = Math.max(0, Math.round(durationMs / 1000));
	if (sec < 60) return `${sec}s`;
	const m = Math.floor(sec / 60);
	const s = sec % 60;
	return s > 0 ? `${m}m ${s}s` : `${m}m`;
}
