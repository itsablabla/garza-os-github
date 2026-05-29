// Schema of a single entry in the Element key-export JSON array. The full
// list is parsed from MATRIX_MEGOLM_KEYS_JSON at worker boot.

export interface MegolmSessionKey {
	algorithm: "m.megolm.v1.aes-sha2";
	room_id: string;
	session_id: string;
	session_key: string; // base64 — feeds InboundGroupSession.import_session() / decryptMegolm()
	sender_key: string; // base64 Curve25519
	sender_claimed_keys?: { ed25519?: string };
	forwarding_curve25519_key_chain?: string[];
}

export function parseKeyExport(json: string | undefined): MegolmSessionKey[] {
	if (!json) return [];
	try {
		const arr = JSON.parse(json) as unknown;
		if (!Array.isArray(arr)) return [];
		return arr.filter(
			(k): k is MegolmSessionKey =>
				typeof k === "object" &&
				k !== null &&
				(k as { algorithm?: unknown }).algorithm === "m.megolm.v1.aes-sha2" &&
				typeof (k as { room_id?: unknown }).room_id === "string" &&
				typeof (k as { session_id?: unknown }).session_id === "string" &&
				typeof (k as { session_key?: unknown }).session_key === "string",
		);
	} catch {
		return [];
	}
}
