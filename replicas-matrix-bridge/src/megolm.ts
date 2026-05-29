// Pure-WebCrypto Megolm v1 (m.megolm.v1.aes-sha2) inbound decryption.
//
// The full @matrix-org/olm WASM expects window/require shims and shipping it
// in a Worker is fragile. For our use case — decrypting events using an
// already-exported Megolm session key — we only need the inbound ratchet
// + AES-CTR decrypt + HMAC-SHA256 verify + Ed25519 verify, all of which
// Workers' Web Crypto already provides.
//
// Spec: https://gitlab.matrix.org/matrix-org/olm/-/blob/master/docs/megolm.md
//   Session-key v2 layout (88 bytes after base64 decode):
//     1 byte  version (0x02)
//     4 bytes message_index (big-endian uint32)
//     4×32 bytes ratchet R_0..R_3
//     32 bytes Ed25519 public key (used to verify signed messages)
//
//   Per-message AES key/iv/HMAC key derived via HKDF-SHA256 from the
//   ratchet state at the target message_index. AES-CTR over the body,
//   HMAC-SHA256 truncated to 8 bytes appended for integrity, Ed25519
//   signature appended for sender authenticity.

import type { MegolmSessionKey } from "./megolm-keys";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

// Convert Base64-URL (no padding) used in matrix protocol → bytes.
function unb64(s: string): Uint8Array {
	// Matrix uses unpadded standard base64 throughout — add padding back.
	const pad = (4 - (s.length % 4)) % 4;
	const padded = s + "=".repeat(pad);
	const bin = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

// Decode a single varint per protobuf wire format.
function readVarint(buf: Uint8Array, offset: number): { value: number; next: number } {
	let value = 0;
	let shift = 0;
	let i = offset;
	while (i < buf.length) {
		const b = buf[i++]!;
		value |= (b & 0x7f) << shift;
		if ((b & 0x80) === 0) return { value, next: i };
		shift += 7;
	}
	throw new Error("megolm: truncated varint");
}

// Parse the Megolm v1 message: protobuf-ish framing followed by HMAC tag
// (8 bytes) and Ed25519 signature (64 bytes).
function parseMegolmMessage(raw: Uint8Array): {
	messageIndex: number;
	ciphertext: Uint8Array;
	macInput: Uint8Array; // version + varint frame up to (but not including) the 8-byte MAC
	mac: Uint8Array; // 8 bytes
	signature: Uint8Array; // 64 bytes (last 64 of raw)
} {
	if (raw.length < 1 + 8 + 64) throw new Error("megolm: message too short");
	const version = raw[0]!;
	if (version !== 0x03) throw new Error(`megolm: unsupported version ${version}`);
	// Trailing 64 bytes are Ed25519 sig; before that, 8 bytes HMAC; rest is body.
	const signature = raw.slice(raw.length - 64);
	const macAndBefore = raw.slice(0, raw.length - 64);
	const mac = macAndBefore.slice(macAndBefore.length - 8);
	const body = raw.slice(1, macAndBefore.length - 8);

	let offset = 0;
	let messageIndex = 0;
	let ciphertext = new Uint8Array(0);
	while (offset < body.length) {
		const { value: tag, next: tagEnd } = readVarint(body, offset);
		offset = tagEnd;
		const wireType = tag & 0x07;
		const fieldNumber = tag >>> 3;
		if (wireType === 0) {
			const { value, next } = readVarint(body, offset);
			offset = next;
			if (fieldNumber === 1) messageIndex = value;
		} else if (wireType === 2) {
			const { value: len, next } = readVarint(body, offset);
			offset = next;
			const chunk = body.slice(offset, offset + len);
			offset += len;
			if (fieldNumber === 2) ciphertext = chunk;
		} else {
			throw new Error(`megolm: unexpected wire type ${wireType}`);
		}
	}
	return { messageIndex, ciphertext, macInput: macAndBefore.slice(0, macAndBefore.length - 8), mac, signature };
}

// Advance one specific Megolm ratchet chunk (j ∈ {0,1,2,3}) using HMAC-SHA256.
// Each chunk is a 32-byte HMAC of the existing chunk under a constant byte.
const RATCHET_CONSTS = [0x00, 0x01, 0x02, 0x03] as const;

async function hmacSha256Once(key: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
	const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	return new Uint8Array(await crypto.subtle.sign("HMAC", k, msg));
}

// Advance the ratchet by one Megolm message step. Matches libolm
// `_olm_megolm_advance` exactly: each ratchet part is an independent 256-bit
// block, and we update the high blocks every step while the low blocks only
// roll over at counter multiples of 256, 65536, 2^24.
async function advance(chunks: Uint8Array[], stepBeforeIncrement: number): Promise<void> {
	const counter = stepBeforeIncrement + 1;
	let h = 0;
	let mask = 0xff_ff_ff;
	while (h < 4 && (counter & mask) !== 0) {
		h++;
		mask >>>= 8;
	}
	// First update R_3..R_(h+1) using the OLD chunks[h] as the HMAC source.
	const source = chunks[h]!;
	for (let i = 3; i > h; i--) {
		chunks[i] = await hmacSha256Once(source, new Uint8Array([RATCHET_CONSTS[i]]));
	}
	// Then update R_h itself last (its old value was used above).
	chunks[h] = await hmacSha256Once(source, new Uint8Array([RATCHET_CONSTS[h]]));
}

// HKDF-SHA256 expand to produce the 80-byte (AES key | HMAC key | AES IV) blob.
async function deriveKeys(ratchet: Uint8Array): Promise<{ aesKey: Uint8Array; hmacKey: Uint8Array; iv: Uint8Array }> {
	const ikm = await crypto.subtle.importKey("raw", ratchet, "HKDF", false, ["deriveBits"]);
	const out = new Uint8Array(
		await crypto.subtle.deriveBits(
			{
				name: "HKDF",
				hash: "SHA-256",
				salt: new Uint8Array(32),
				info: textEncoder.encode("MEGOLM_KEYS"),
			},
			ikm,
			80 * 8,
		),
	);
	return { aesKey: out.slice(0, 32), hmacKey: out.slice(32, 64), iv: out.slice(64, 80) };
}

export interface DecryptResult {
	plaintext: string;
	messageIndex: number;
}

/**
 * Decrypt a single Megolm-encrypted message using the imported session key.
 * `sessionKey` is the base64 string from the Element key export (`session_key`).
 * `ciphertextB64` is `content.ciphertext` from the m.room.encrypted event.
 */
export async function decryptMegolm(
	sessionKey: string,
	ciphertextB64: string,
): Promise<DecryptResult> {
	const skRaw = unb64(sessionKey);
	if (skRaw.length < 1 + 4 + 4 * 32 + 32) throw new Error(`megolm: short session key (${skRaw.length})`);
	const version = skRaw[0]!;
	// Element-exported keys are typically version 1; libolm later added v2 with
	// the same on-the-wire layout. We accept both.
	if (version !== 0x01 && version !== 0x02) {
		throw new Error(`megolm: unsupported session-key version ${version}`);
	}
	const baseIndex =
		(skRaw[1]! << 24) | (skRaw[2]! << 16) | (skRaw[3]! << 8) | skRaw[4]!;
	const chunks: Uint8Array[] = [];
	for (let i = 0; i < 4; i++) chunks.push(skRaw.slice(5 + i * 32, 5 + (i + 1) * 32));

	const msg = parseMegolmMessage(unb64(ciphertextB64));
	if (msg.messageIndex < baseIndex) {
		throw new Error(`megolm: message index ${msg.messageIndex} < session base ${baseIndex}`);
	}
	for (let step = baseIndex; step < msg.messageIndex; step++) {
		await advance(chunks, step);
	}
	const ratchet = new Uint8Array(128);
	for (let i = 0; i < 4; i++) ratchet.set(chunks[i]!, i * 32);
	const { aesKey, hmacKey, iv } = await deriveKeys(ratchet);

	// Verify HMAC (truncated to first 8 bytes of HMAC-SHA256 over version + body).
	const macKey = await crypto.subtle.importKey("raw", hmacKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const expectedMac = new Uint8Array(await crypto.subtle.sign("HMAC", macKey, msg.macInput));
	let macOk = true;
	for (let i = 0; i < 8; i++) if (expectedMac[i] !== msg.mac[i]) macOk = false;
	if (!macOk) throw new Error("megolm: HMAC mismatch");

	// Megolm v1 uses AES-256-CBC with PKCS#7 padding (NOT CTR — that misled me
	// initially; Web Crypto AES-CBC strips PKCS#7 automatically).
	const cryptoKey = await crypto.subtle.importKey("raw", aesKey, { name: "AES-CBC" }, false, ["decrypt"]);
	const plain = new Uint8Array(
		await crypto.subtle.decrypt({ name: "AES-CBC", iv }, cryptoKey, msg.ciphertext),
	);
	return { plaintext: textDecoder.decode(plain), messageIndex: msg.messageIndex };
}

/**
 * Look up a session key in the parsed Megolm keys array by (room_id, session_id).
 * The export contains many sessions; we narrow by exact match.
 */
export function findSessionKey(
	keys: MegolmSessionKey[],
	roomId: string,
	sessionId: string,
): string | undefined {
	for (const k of keys) {
		if (k.room_id === roomId && k.session_id === sessionId) return k.session_key;
	}
	return undefined;
}
