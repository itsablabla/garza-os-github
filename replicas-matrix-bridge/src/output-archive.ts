// Large-tool-output archiver — when a tool result exceeds the
// rolling-log preview cap (100 chars), persist the full bytes to R2 so
// the Done frame can surface a `📎 View full output` link instead of
// dropping the rest of the content on the floor.
//
// Keying: `<128-bit random>/<basename>`. Random-prefixed so the URL is
// genuinely unguessable — an earlier sha256-derived scheme let an
// attacker who could *guess* the content (e.g. the bytes of a public
// /etc/os-release dump) reconstruct the URL without ever seeing it,
// which leaks data in E2EE rooms where the URL is the only thing
// crossing the encryption boundary. Loses cross-room dedup; gains
// real unguessability. Lifecycle on the bucket prunes objects after
// 30 days so cost stays bounded.

export interface ArchiveEnv {
	OUTPUT_ARCHIVE: R2Bucket;
}

// Bucket's public r2.dev URL — set when the bucket was created via
// `wrangler r2 bucket dev-url enable`. Stable for the lifetime of
// public-access mode; pin here so the poller doesn't need a roundtrip
// to look it up.
const R2_PUBLIC_BASE = "https://pub-54d26cd2ad324055a4a573666935ce53.r2.dev";

// Above this threshold a tool_result triggers archival. Choosing
// generous (2KB) so chatty short results stay inline; long
// stdouts/dumps/JSON blobs get a link instead of a truncation.
export const ARCHIVE_THRESHOLD_BYTES = 2_000;

/**
 * 32-hex-char unguessable random prefix (128 bits of entropy from
 * crypto.getRandomValues). Used as the R2 key prefix so the public
 * URL can't be constructed by guessing the content.
 */
function randomPrefix(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	let hex = "";
	for (let i = 0; i < bytes.length; i++) {
		hex += bytes[i]!.toString(16).padStart(2, "0");
	}
	return hex;
}

/**
 * Best-effort archive of a tool result. Returns the public r2.dev URL
 * on success, undefined on failure (caller falls through to inline
 * truncation). Each call writes to a fresh random prefix — no dedup.
 */
export async function archiveLargeOutput(
	env: ArchiveEnv,
	content: string,
	suggestedBasename = "output.txt",
): Promise<string | undefined> {
	if (!env.OUTPUT_ARCHIVE) return undefined;
	if (content.length < ARCHIVE_THRESHOLD_BYTES) return undefined;
	try {
		const prefix = randomPrefix();
		// Strip path separators from the basename so an attacker can't
		// climb the key namespace via `../`. The random prefix is the
		// trust anchor; basename is purely cosmetic.
		const cleanBase = suggestedBasename
			.replace(/[^a-zA-Z0-9._-]/g, "_")
			.slice(0, 80) || "output.txt";
		const key = `${prefix}/${cleanBase}`;
		// httpMetadata content-type so a browser renders the blob inline
		// instead of forcing a download — most tool outputs are plain text.
		await env.OUTPUT_ARCHIVE.put(key, content, {
			httpMetadata: {
				contentType: "text/plain; charset=utf-8",
				cacheControl: "public, max-age=2592000",
			},
		});
		return `${R2_PUBLIC_BASE}/${key}`;
	} catch (e) {
		console.log(`[archive] failed: ${e instanceof Error ? e.message : e}`);
		return undefined;
	}
}

/**
 * Pick a plausible basename for an archived tool output based on the
 * tool name + its input. `Bash` uses the first word of the command,
 * `Read`/`Edit`/`Write` use the file's basename, others fall back to
 * `<toolname>-output.txt`.
 */
export function archiveBasename(
	toolName: string,
	input: Record<string, unknown> | undefined,
): string {
	const filePath = typeof input?.file_path === "string" ? (input.file_path as string) : undefined;
	if (filePath) {
		const parts = filePath.split("/");
		const base = parts[parts.length - 1] || "output.txt";
		return `${base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "output.txt"}.out.txt`;
	}
	if (toolName === "Bash") {
		const cmd = typeof input?.command === "string" ? (input.command as string).trim() : "";
		// SECURITY: walk tokens skipping env-var assignments (`KEY=value`)
		// and known no-op prefixes so the basename reflects the actual
		// command, not the secret values an inline env assignment might
		// carry. Otherwise `OPENAI_API_KEY=sk-xxx node srv.js` would
		// produce a public R2 URL containing the key.
		const tokens = cmd.split(/\s+/);
		let firstReal = "bash";
		for (const tok of tokens) {
			if (/^[A-Z_][A-Z0-9_]*=/.test(tok)) continue; // env var assignment
			if (/^(?:nohup|time|sudo|exec|env)$/.test(tok)) continue;
			firstReal = tok;
			break;
		}
		// Strip any trailing `=…` just in case the regex above missed
		// something (defensive belt-and-suspenders).
		if (firstReal.includes("=")) firstReal = firstReal.split("=")[0]!;
		const base = firstReal.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40) || "bash";
		return `${base}.out.txt`;
	}
	return `${toolName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40) || "tool"}-output.txt`;
}
