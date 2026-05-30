import { describe, expect, it } from "vitest";
import { parseMxc, mxcDownloadUrl, decryptMatrixAttachment, type EncryptedFile } from "./media-fetch";

describe("parseMxc", () => {
	it("parses a normal mxc URL", () => {
		expect(parseMxc("mxc://matrix.org/abcDEF123")).toEqual({
			server: "matrix.org",
			mediaId: "abcDEF123",
		});
	});
	it("returns null on malformed input", () => {
		expect(parseMxc("https://x.com/y")).toBeNull();
		expect(parseMxc("mxc://only-server")).toBeNull();
		expect(parseMxc("")).toBeNull();
	});
});

describe("mxcDownloadUrl", () => {
	it("builds the legacy /_matrix/media/v3/download URL", () => {
		const url = mxcDownloadUrl(
			"https://matrix-client.matrix.org",
			"beeper.com",
			"abc123",
		);
		expect(url).toBe(
			"https://matrix-client.matrix.org/_matrix/media/v3/download/beeper.com/abc123",
		);
	});
	it("strips trailing slash on homeserver", () => {
		const url = mxcDownloadUrl(
			"https://matrix-client.matrix.org/",
			"s",
			"m",
		);
		expect(url).not.toContain(".org//");
	});
});

describe("decryptMatrixAttachment", () => {
	it("returns null on hash mismatch", async () => {
		const ct = new TextEncoder().encode("not the right ciphertext").buffer as ArrayBuffer;
		const file: EncryptedFile = {
			url: "mxc://x/y",
			key: { kty: "oct", k: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }, // 32 bytes of 0
			iv: "AAAAAAAAAAAAAAAAAAAAAA", // 16 bytes of 0 (base64)
			hashes: { sha256: "nope-bad-hash" },
		};
		const plain = await decryptMatrixAttachment(ct, file);
		expect(plain).toBeNull();
	});

	it("decrypts a known-vector AES-CTR ciphertext when hash matches", async () => {
		// Build a real round-trip: encrypt "hello voice" → set hash → decrypt.
		const key = new Uint8Array(32); // all zeros
		const iv = new Uint8Array(16); // all zeros
		const cryptoKey = await crypto.subtle.importKey(
			"raw",
			key,
			{ name: "AES-CTR", length: 256 },
			false,
			["encrypt", "decrypt"],
		);
		const plaintextBytes = new TextEncoder().encode("hello voice");
		const ct = await crypto.subtle.encrypt(
			{ name: "AES-CTR", counter: iv, length: 64 },
			cryptoKey,
			plaintextBytes,
		);
		// SHA-256 of the ciphertext (base64, no padding).
		const hash = await crypto.subtle.digest("SHA-256", ct);
		const hashBytes = new Uint8Array(hash);
		let hashB64 = "";
		for (let i = 0; i < hashBytes.length; i++) hashB64 += String.fromCharCode(hashBytes[i]!);
		hashB64 = btoa(hashB64);

		const file: EncryptedFile = {
			url: "mxc://x/y",
			// Matrix uses base64url for key.k and iv (no padding).
			key: { kty: "oct", k: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
			iv: "AAAAAAAAAAAAAAAAAAAAAA",
			hashes: { sha256: hashB64 },
		};
		const plain = await decryptMatrixAttachment(ct, file);
		expect(plain).not.toBeNull();
		const got = new TextDecoder().decode(new Uint8Array(plain!));
		expect(got).toBe("hello voice");
	});
});
