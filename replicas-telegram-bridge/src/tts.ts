// Phase 2 outbound TTS for the Telegram bridge. Same OpenAI Whisper
// stack as the matrix bridge — model=tts-1, voice=nova, format=opus.
// Result audio is shipped to Telegram via `sendVoice` (OGG/Opus is the
// native format TG expects for voice messages).

export interface TtsEnv {
	OPENAI_API_KEY?: string;
}

export interface TtsResult {
	ok: boolean;
	audio?: ArrayBuffer;
	mimetype: string;
	error?: string;
}

const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";
const MAX_TTS_INPUT = 4096;

export async function synthesizeSpeech(env: TtsEnv, text: string): Promise<TtsResult> {
	if (!env.OPENAI_API_KEY) {
		return { ok: false, mimetype: "", error: "OPENAI_API_KEY not configured" };
	}
	const trimmed = text.slice(0, MAX_TTS_INPUT);
	if (!trimmed.trim()) return { ok: false, mimetype: "", error: "empty input" };
	try {
		const r = await fetch(OPENAI_TTS_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.OPENAI_API_KEY}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: "tts-1",
				voice: "nova",
				input: trimmed,
				response_format: "opus",
			}),
		});
		if (!r.ok) {
			const errBody = await r.text();
			return { ok: false, mimetype: "", error: `tts ${r.status}: ${errBody.slice(0, 200)}` };
		}
		const audio = await r.arrayBuffer();
		if (audio.byteLength === 0) {
			return { ok: false, mimetype: "", error: "empty audio response" };
		}
		return { ok: true, audio, mimetype: "audio/ogg" };
	} catch (e) {
		return { ok: false, mimetype: "", error: e instanceof Error ? e.message : String(e) };
	}
}

export function stripMarkdownForTts(md: string): string {
	let s = md;
	s = s.replace(/```[\s\S]*?```/g, " [code block] ");
	s = s.replace(/`([^`]+)`/g, "$1");
	s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
	s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
	s = s.replace(/(\*\*|__)(.+?)\1/g, "$2");
	s = s.replace(/(\*|_)(.+?)\1/g, "$2");
	s = s.replace(/~~(.+?)~~/g, "$1");
	s = s.replace(/^#{1,6}\s+/gm, "");
	s = s.replace(/^\s*[-*+]\s+/gm, "");
	s = s.replace(/^\s*\d+\.\s+/gm, "");
	s = s.replace(/^>\s?/gm, "");
	s = s.replace(/\n{3,}/g, "\n\n");
	return s.trim();
}
