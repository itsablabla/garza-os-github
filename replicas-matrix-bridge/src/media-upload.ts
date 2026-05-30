// Matrix media upload — mirrors the Phase 1 decrypt path for outbound
// audio. Two modes:
//   1. Unencrypted upload: POST /_matrix/media/v3/upload → mxc:// URI.
//   2. E2EE upload: AES-256-CTR encrypt with a fresh random key + iv,
//      sha256 the CIPHERTEXT, upload ciphertext to media, return the
//      EncryptedFile block to put in content.file.

export interface MediaUploadEnv {
	MATRIX_HOMESERVER: string;
	MATRIX_ACCESS_TOKEN: string;
}

export interface EncryptedFileOut {
	url: string;
	key: { kty: "oct"; k: string; alg: "A256CTR"; key_ops: ["encrypt", "decrypt"]; ext: true };
	iv: string;
	hashes: { sha256: string };
	v: "v2";
}

/**
 * Upload raw bytes to the homeserver. Returns the mxc:// URI on success,
 * null on failure. Used for the unencrypted-room path.
 */
export async function uploadMxc(
	env: MediaUploadEnv,
	bytes: ArrayBuffer,
	mimetype: string,
	filename?: string,
): Promise<string | null> {
	const homeserver = env.MATRIX_HOMESERVER.replace(/\/$/, "");
	const url = filename
		? `${homeserver}/_matrix/media/v3/upload?filename=${encodeURIComponent(filename)}`
		: `${homeserver}/_matrix/media/v3/upload`;
	const r = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.MATRIX_ACCESS_TOKEN}`,
			"Content-Type": mimetype,
		},
		body: bytes,
	});
	if (!r.ok) return null;
	const j = (await r.json()) as { content_uri?: string };
	return j.content_uri ?? null;
}

/**
 * Encrypt + upload an attachment for E2EE rooms per the spec. Returns
 * the EncryptedFile block ready to plug into `m.audio` `content.file`.
 * The outer `content.url` should be left absent (or duplicate the
 * inner url for legacy-client compatibility).
 */
export async function uploadEncryptedAttachment(
	env: MediaUploadEnv,
	plaintext: ArrayBuffer,
): Promise<EncryptedFileOut | null> {
	// Fresh random 32-byte AES key + 16-byte IV. AES-CTR per spec.
	const keyBytes = crypto.getRandomValues(new Uint8Array(32));
	const ivBytes = crypto.getRandomValues(new Uint8Array(16));
	let cryptoKey: CryptoKey;
	try {
		cryptoKey = await crypto.subtle.importKey(
			"raw",
			keyBytes as BufferSource,
			{ name: "AES-CTR", length: 256 },
			false,
			["encrypt"],
		);
	} catch {
		return null;
	}
	let ciphertext: ArrayBuffer;
	try {
		ciphertext = await crypto.subtle.encrypt(
			{ name: "AES-CTR", counter: ivBytes as BufferSource, length: 64 },
			cryptoKey,
			plaintext,
		);
	} catch {
		return null;
	}
	// Hash the CIPHERTEXT — verifier in fetchVoiceAudio checks this.
	const hashBuf = await crypto.subtle.digest("SHA-256", ciphertext);
	const hashBytes = new Uint8Array(hashBuf);
	const hashB64 = base64Encode(hashBytes).replace(/=+$/, "");

	// Upload the ciphertext as application/octet-stream so the
	// homeserver doesn't try to interpret it.
	const mxc = await uploadMxc(env, ciphertext, "application/octet-stream");
	if (!mxc) return null;

	return {
		url: mxc,
		key: {
			kty: "oct",
			k: base64UrlEncode(keyBytes),
			alg: "A256CTR",
			key_ops: ["encrypt", "decrypt"],
			ext: true,
		},
		iv: base64UrlEncode(ivBytes),
		hashes: { sha256: hashB64 },
		v: "v2",
	};
}

function base64Encode(bytes: Uint8Array): string {
	let s = "";
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
	return btoa(s);
}

function base64UrlEncode(bytes: Uint8Array): string {
	return base64Encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
