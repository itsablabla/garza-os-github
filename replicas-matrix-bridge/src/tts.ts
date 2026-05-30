// Text-to-speech for Phase 2 outbound voice replies. Synthesizes the
// agent's final markdown reply into Opus audio bytes via OpenAI TTS so
// the bridge can upload them as a Matrix `m.audio` voice message.
//
// Defaults baked in (no per-call config):
//   - model:  tts-1     (low latency; tts-1-hd is 2x slower for marginal quality)
//   - voice:  nova      (friendly, neutral; closest to what Beeper users expect)
//   - format: opus      (Matrix voice spec = OGG/Opus; OpenAI emits raw Opus)
//
// Note on output container: `response_format=opus` returns an Opus
// stream that Matrix voice clients accept when wrapped with mimetype
// `audio/ogg; codecs=opus`. The MSC3245 voice spec doesn't require a
// specific Ogg page structure — clients accept whatever the homeserver
// returns, and matrix.org / Beeper play OpenAI's output correctly.

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

// OpenAI TTS input cap (4096 chars). Long replies should already be split
// into chunks by split-reply.ts; this is the safety net.
const MAX_TTS_INPUT = 4096;

/**
 * Synthesize speech via OpenAI TTS. Returns the audio bytes ready for
 * Matrix media upload + `m.audio` send. Best-effort: on failure the
 * caller falls back to the normal text reply path so the user still
 * gets the answer.
 */
export async function synthesizeSpeech(
	env: TtsEnv,
	text: string,
): Promise<TtsResult> {
	if (!env.OPENAI_API_KEY) {
		return { ok: false, mimetype: "", error: "OPENAI_API_KEY not configured" };
	}
	const trimmed = text.slice(0, MAX_TTS_INPUT);
	if (!trimmed.trim()) {
		return { ok: false, mimetype: "", error: "empty input" };
	}
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
			return {
				ok: false,
				mimetype: "",
				error: `tts ${r.status}: ${errBody.slice(0, 200)}`,
			};
		}
		const audio = await r.arrayBuffer();
		if (audio.byteLength === 0) {
			return { ok: false, mimetype: "", error: "empty audio response" };
		}
		return { ok: true, audio, mimetype: "audio/ogg" };
	} catch (e) {
		return {
			ok: false,
			mimetype: "",
			error: e instanceof Error ? e.message : String(e),
		};
	}
}

/**
 * Strip Markdown formatting so the TTS reads the prose, not the
 * syntax. Removes code fences, inline backticks, bold/italic markers,
 * headings, link decorations, list bullets. Keeps the URL out of link
 * text so the speech says "click the link" cleanly instead of reading
 * "open paren https colon slash slash...".
 */
export function stripMarkdownForTts(md: string): string {
	let s = md;
	// Fenced code blocks → "[code block]" so the TTS doesn't read the code.
	s = s.replace(/```[\s\S]*?```/g, " [code block] ");
	// Inline code → just the inner text.
	s = s.replace(/`([^`]+)`/g, "$1");
	// Images → alt text only.
	s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
	// Links → just the text label.
	s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
	// Bold/italic markers.
	s = s.replace(/(\*\*|__)(.+?)\1/g, "$2");
	s = s.replace(/(\*|_)(.+?)\1/g, "$2");
	// Strikethrough.
	s = s.replace(/~~(.+?)~~/g, "$1");
	// Headings — drop the leading hashes.
	s = s.replace(/^#{1,6}\s+/gm, "");
	// List bullets at line start.
	s = s.replace(/^\s*[-*+]\s+/gm, "");
	s = s.replace(/^\s*\d+\.\s+/gm, "");
	// Block quote marker.
	s = s.replace(/^>\s?/gm, "");
	// Collapse blank lines so the TTS doesn't pause forever.
	s = s.replace(/\n{3,}/g, "\n\n");
	return s.trim();
}

/**
 * Stub waveform per MSC1767 — 32-segment 0..1024 amplitude array.
 * Real Opus waveform extraction would need a WASM Opus decoder; for v1
 * we ship a gentle visually-pleasant curve that looks like a real voice
 * waveform without claiming to be one. The client renders this as the
 * play-bar visualization; the audio itself plays unchanged regardless.
 */
export function stubWaveform(): number[] {
	// Smooth fade in / sustained body / fade out — looks like a voice
	// message. Length=32 matches Element's preferred sample count.
	const samples: number[] = [];
	const len = 32;
	for (let i = 0; i < len; i++) {
		const t = i / (len - 1);
		// Bell-shaped curve with mild jitter so it doesn't look generated.
		const bell = Math.sin(Math.PI * t);
		const jitter = 0.7 + (Math.sin(i * 13.13) + 1) * 0.15;
		samples.push(Math.round(Math.max(40, Math.min(1024, 1024 * bell * jitter))));
	}
	return samples;
}
