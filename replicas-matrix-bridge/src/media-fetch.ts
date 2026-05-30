// Matrix media download — handles both unencrypted mxc:// URLs (download
// straight from the homeserver) and E2EE-wrapped media files (download
// ciphertext, AES-256-CTR decrypt with the per-file key in content.file).
//
// Used by the listener's voice-message path to fetch + decrypt the
// audio body before handing to Whisper. Same machinery would handle
// other m.audio / m.image / m.video media if we later care.

export interface MediaFetchEnv {
	MATRIX_HOMESERVER: string;
	MATRIX_ACCESS_TOKEN: string;
}

/**
 * Matrix EncryptedFile block per
 * https://spec.matrix.org/v1.11/client-server-api/#sending-encrypted-attachments
 */
export interface EncryptedFile {
	url: string;
	key: { kty: string; k: string; alg?: string };
	iv: string;
	hashes: { sha256: string };
	v?: string;
}

/**
 * Decode a mxc://server/mediaId URL into its parts. Returns null on
 * malformed input.
 */
export function parseMxc(mxc: string): { server: string; mediaId: string } | null {
	const m = /^mxc:\/\/([^/]+)\/(.+)$/.exec(mxc);
	if (!m) return null;
	return { server: m[1]!, mediaId: m[2]! };
}

/**
 * Build the /_matrix/media/v3/download URL for a parsed mxc. Used for
 * unencrypted attachments where the homeserver streams the file directly.
 * (Authenticated downloads on Matrix 1.11 use /_matrix/client/v1/media —
 * matrix.org / Beeper still accept the v3 path; we'll switch if a
 * homeserver returns 404.)
 */
export function mxcDownloadUrl(homeserver: string, server: string, mediaId: string): string {
	return `${homeserver.replace(/\/$/, "")}/_matrix/media/v3/download/${encodeURIComponent(server)}/${encodeURIComponent(mediaId)}`;
}

/**
 * Download an mxc:// resource as a raw ArrayBuffer. Returns the buffer
 * + the response content-type header so the caller can hand the right
 * mimetype to the transcription provider.
 *
 * Falls back from the authenticated `/_matrix/client/v1/media/download/`
 * (Matrix 1.11+) to the legacy unauthenticated `/_matrix/media/v3/`
 * endpoint, since matrix.org and Beeper still serve from both.
 */
export async function downloadMxc(
	env: MediaFetchEnv,
	mxc: string,
): Promise<{ body: ArrayBuffer; mimetype: string } | null> {
	const parsed = parseMxc(mxc);
	if (!parsed) return null;

	const homeserver = env.MATRIX_HOMESERVER.replace(/\/$/, "");

	// Try authenticated media first (Matrix 1.11+).
	const authUrl = `${homeserver}/_matrix/client/v1/media/download/${encodeURIComponent(parsed.server)}/${encodeURIComponent(parsed.mediaId)}`;
	let r = await fetch(authUrl, {
		headers: { Authorization: `Bearer ${env.MATRIX_ACCESS_TOKEN}` },
	});
	if (!r.ok && r.status === 404) {
		// Fall back to legacy media endpoint.
		const legacyUrl = mxcDownloadUrl(homeserver, parsed.server, parsed.mediaId);
		r = await fetch(legacyUrl);
	}
	if (!r.ok) return null;

	const body = await r.arrayBuffer();
	const mimetype = r.headers.get("content-type") ?? "application/octet-stream";
	return { body, mimetype };
}

/**
 * Decrypt a Matrix encrypted attachment per the spec:
 *   - AES-256-CTR over the ciphertext using key.k (base64url, 32 bytes)
 *   - IV is base64-encoded 16 bytes, used as the CTR counter init
 *   - hashes.sha256 verifies the ORIGINAL ciphertext (not the plaintext)
 *
 * Returns the decrypted plaintext bytes, or null on hash mismatch /
 * decode failure (caller should treat as fatal for that attachment).
 */
export async function decryptMatrixAttachment(
	ciphertext: ArrayBuffer,
	file: EncryptedFile,
): Promise<ArrayBuffer | null> {
	// Hash check first — verifies we got the same bytes the sender
	// signed. Per spec, the hash covers the CIPHERTEXT.
	const expectedHashB64 = file.hashes?.sha256;
	if (!expectedHashB64) return null;
	const actualHash = await crypto.subtle.digest("SHA-256", ciphertext);
	const actualHashB64 = base64Encode(new Uint8Array(actualHash));
	if (!constantTimeEq(actualHashB64, expectedHashB64) && !constantTimeEq(actualHashB64.replace(/=+$/, ""), expectedHashB64.replace(/=+$/, ""))) {
		console.log(`[media-fetch] sha256 mismatch — got ${actualHashB64} expected ${expectedHashB64}`);
		return null;
	}

	const keyBytes = base64UrlDecode(file.key.k);
	if (keyBytes.length !== 32) {
		console.log(`[media-fetch] bad key length: ${keyBytes.length}`);
		return null;
	}
	const ivBytes = base64UrlDecode(file.iv);
	if (ivBytes.length !== 16) {
		console.log(`[media-fetch] bad iv length: ${ivBytes.length}`);
		return null;
	}

	try {
		const cryptoKey = await crypto.subtle.importKey(
			"raw",
			keyBytes as BufferSource,
			{ name: "AES-CTR", length: 256 },
			false,
			["decrypt"],
		);
		const plaintext = await crypto.subtle.decrypt(
			{ name: "AES-CTR", counter: ivBytes as BufferSource, length: 64 },
			cryptoKey,
			ciphertext,
		);
		return plaintext;
	} catch (e) {
		console.log(`[media-fetch] AES-CTR decrypt failed: ${e instanceof Error ? e.message : e}`);
		return null;
	}
}

/**
 * Fetch and (if needed) decrypt a Matrix voice attachment in one call.
 * Pass the m.audio content's `url` for plain rooms or its `file` block
 * for E2EE rooms. Returns the decoded audio bytes ready for upload to
 * a transcription provider.
 */
export async function fetchVoiceAudio(
	env: MediaFetchEnv,
	mxcOrFile: { url?: string; file?: EncryptedFile },
): Promise<{ body: ArrayBuffer; mimetype: string } | null> {
	// Encrypted path takes precedence — when content.file is present the
	// outer content.url is just a hint for legacy clients.
	if (mxcOrFile.file?.url) {
		const ct = await downloadMxc(env, mxcOrFile.file.url);
		if (!ct) return null;
		const plaintext = await decryptMatrixAttachment(ct.body, mxcOrFile.file);
		if (!plaintext) return null;
		// Decrypted payload's mimetype isn't in the EncryptedFile block —
		// the outer content.info.mimetype is the source of truth. Caller
		// supplies it; default to OGG since that's the voice-msg standard.
		return { body: plaintext, mimetype: "audio/ogg" };
	}
	if (mxcOrFile.url) {
		return downloadMxc(env, mxcOrFile.url);
	}
	return null;
}

// Helpers — Workers crypto.subtle quirks + base64 round-trips.

function base64Encode(bytes: Uint8Array): string {
	let s = "";
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
	return btoa(s);
}

function base64UrlDecode(s: string): Uint8Array {
	let std = s.replace(/-/g, "+").replace(/_/g, "/");
	while (std.length % 4 !== 0) std += "=";
	const bin = atob(std);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

function constantTimeEq(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}
