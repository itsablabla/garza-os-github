// Large-tool-output archiver — when a tool result exceeds the
// rolling-log preview cap (100 chars), persist the full bytes to R2 so
// the Done frame can surface a `📎 View full output` link instead of
// dropping the rest of the content on the floor.
//
// Keying: `<sha256(content)>/<basename>`. Sha-based dedupes identical
// outputs across rooms / sessions; basename is the tool's most likely
// filename hint so a casual click in the browser sees a meaningful
// name in the title bar. Public-read R2 bucket (configured in
// wrangler.toml) so the URL works without auth headers.

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
 * SHA-256 of the input, hex-encoded. Used as the R2 key prefix for
 * dedupe across rooms.
 */
async function sha256Hex(s: string): Promise<string> {
	const buf = new TextEncoder().encode(s);
	const hash = await crypto.subtle.digest("SHA-256", buf as BufferSource);
	const bytes = new Uint8Array(hash);
	let hex = "";
	for (let i = 0; i < bytes.length; i++) {
		hex += bytes[i]!.toString(16).padStart(2, "0");
	}
	return hex;
}

/**
 * Best-effort archive of a tool result. Returns the public r2.dev URL
 * on success, undefined on failure (caller falls through to inline
 * truncation). Idempotent — re-archiving identical content is a
 * no-op put.
 */
export async function archiveLargeOutput(
	env: ArchiveEnv,
	content: string,
	suggestedBasename = "output.txt",
): Promise<string | undefined> {
	if (!env.OUTPUT_ARCHIVE) return undefined;
	if (content.length < ARCHIVE_THRESHOLD_BYTES) return undefined;
	try {
		const hex = await sha256Hex(content);
		// Strip path separators from the basename so an attacker can't
		// climb the key namespace via `../`. The hash prefix is the
		// trust anchor; basename is purely cosmetic.
		const cleanBase = suggestedBasename
			.replace(/[^a-zA-Z0-9._-]/g, "_")
			.slice(0, 80) || "output.txt";
		const key = `${hex}/${cleanBase}`;
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
		return `${base}.out.txt`;
	}
	if (toolName === "Bash") {
		const cmd = typeof input?.command === "string" ? (input.command as string).trim() : "";
		const firstWord = cmd.split(/\s+/)[0] ?? "bash";
		return `${firstWord.replace(/[^a-zA-Z0-9._-]/g, "_") || "bash"}.out.txt`;
	}
	return `${toolName.replace(/[^a-zA-Z0-9._-]/g, "_") || "tool"}-output.txt`;
}
