// Matrix Secure Server-Side Storage (SSSS) — `m.secret_storage.v1.aes-hmac-sha2`.
// Decrypts cross-signing private keys (and any other SSSS-stored secret)
// using the user's recovery key. The result is the raw secret bytes.
//
// Spec: https://spec.matrix.org/v1.11/client-server-api/#msecret_storagev1aes-hmac-sha2
// Recovery key format: https://spec.matrix.org/v1.11/client-server-api/#mmegolm_backupv1curve25519-aes-sha2 (same prefix)

const SSSS_VERSION_PREFIX = new Uint8Array([0x8b, 0x01]);
const ZERO_SALT = new Uint8Array(32);

// Base58 alphabet (Bitcoin / Matrix common). Same as bitcoin's check encoding.
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(s: string): Uint8Array {
	const stripped = s.replace(/\s+/g, "");
	let result = 0n;
	for (const ch of stripped) {
		const idx = B58.indexOf(ch);
		if (idx < 0) throw new Error(`recovery: bad base58 char ${JSON.stringify(ch)}`);
		result = result * 58n + BigInt(idx);
	}
	// Count leading "1"s which are leading zeros in the decoded output.
	let leadingZeros = 0;
	for (const ch of stripped) {
		if (ch === "1") leadingZeros++;
		else break;
	}
	const bytes: number[] = [];
	while (result > 0n) {
		bytes.push(Number(result & 0xffn));
		result >>= 8n;
	}
	bytes.reverse();
	const out = new Uint8Array(leadingZeros + bytes.length);
	out.set(bytes, leadingZeros);
	return out;
}

/** Decode a Matrix recovery key into its 32-byte secret seed. */
export function decodeRecoveryKey(recoveryKey: string): Uint8Array {
	const decoded = base58Decode(recoveryKey);
	if (decoded.length !== 35) {
		throw new Error(`recovery: expected 35 bytes, got ${decoded.length}`);
	}
	if (decoded[0] !== SSSS_VERSION_PREFIX[0] || decoded[1] !== SSSS_VERSION_PREFIX[1]) {
		throw new Error(`recovery: bad version prefix`);
	}
	// XOR-parity check: all bytes XORed should be zero.
	let parity = 0;
	for (const b of decoded) parity ^= b;
	if (parity !== 0) throw new Error("recovery: parity byte mismatch");
	return decoded.slice(2, 34);
}

async function hkdfBytes(ikm: Uint8Array, info: string, length: number): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
	return new Uint8Array(
		await crypto.subtle.deriveBits(
			{ name: "HKDF", hash: "SHA-256", salt: ZERO_SALT, info: new TextEncoder().encode(info) },
			key,
			length * 8,
		),
	);
}

function b64decode(s: string): Uint8Array {
	const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/=]/g, ""));
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

function b64encode(bytes: Uint8Array): string {
	let s = "";
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s);
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
	const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

async function aesCtr(key: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array> {
	const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "AES-CTR" }, false, ["encrypt", "decrypt"]);
	// Matrix SSSS uses AES-CTR with a 16-byte IV but with the top bit of the
	// upper-half cleared (it treats the lower 64 bits as the counter). Web
	// Crypto's `length: 64` matches.
	return new Uint8Array(
		await crypto.subtle.decrypt({ name: "AES-CTR", counter: iv, length: 64 }, k, ciphertext),
	);
}

/**
 * Verify the recovery key matches the SSSS key configuration stored in
 * account_data `m.secret_storage.key.<keyId>`. Returns true on match.
 */
export async function verifyRecoveryKey(seed: Uint8Array, config: { iv: string; mac: string }): Promise<boolean> {
	const km = await hkdfBytes(seed, "", 64);
	const aes = km.slice(0, 32);
	const hmac = km.slice(32, 64);
	const iv = b64decode(config.iv);
	// Encrypt a 32-byte zero block with AES-CTR using the derived key + iv.
	// Then HMAC the resulting ciphertext and compare with stored mac.
	const cipherK = await crypto.subtle.importKey("raw", aes as BufferSource, { name: "AES-CTR" }, false, ["encrypt"]);
	const zeros = new Uint8Array(32);
	const encrypted = new Uint8Array(
		await crypto.subtle.encrypt({ name: "AES-CTR", counter: iv, length: 64 }, cipherK, zeros),
	);
	const mac = await hmacSha256(hmac, encrypted);
	const want = b64decode(config.mac);
	if (mac.length !== want.length) return false;
	let ok = 0;
	for (let i = 0; i < mac.length; i++) ok |= mac[i] ^ want[i];
	return ok === 0;
}

/**
 * Decrypt a single SSSS-encrypted secret. The plaintext is the raw secret
 * bytes (typically a 32-byte ed25519 seed, base64-encoded in some flows).
 */
export async function decryptSecret(
	seed: Uint8Array,
	secretName: string,
	encrypted: { iv: string; ciphertext: string; mac: string },
): Promise<Uint8Array> {
	const km = await hkdfBytes(seed, secretName, 64);
	const aesKey = km.slice(0, 32);
	const hmacKey = km.slice(32, 64);
	const ct = b64decode(encrypted.ciphertext);
	// Verify HMAC over the ciphertext.
	const macComputed = await hmacSha256(hmacKey, ct);
	const macWant = b64decode(encrypted.mac);
	let ok = 0;
	for (let i = 0; i < macComputed.length; i++) ok |= macComputed[i] ^ macWant[i];
	if (ok !== 0) throw new Error(`ssss: bad MAC for secret ${secretName}`);
	const iv = b64decode(encrypted.iv);
	return await aesCtr(aesKey, iv, ct);
}

export { b64decode as ssssB64Decode, b64encode as ssssB64Encode };
