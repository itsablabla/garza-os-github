import { describe, expect, it } from "vitest";
import { sanitizeForJson, prefixWithRoutingHeader } from "./dispatch";

describe("sanitizeForJson", () => {
	it("passes valid surrogate pairs through unchanged", () => {
		// 🎉 is U+1F389 — encoded as surrogate pair D83C DF89
		const s = "🎉 done";
		expect(sanitizeForJson(s)).toBe(s);
	});

	it("replaces a lone high surrogate with U+FFFD", () => {
		// 0xD83C alone is a lone high surrogate (the second half of 🎉
		// dropped); should be replaced with the standard replacement char.
		const lone = String.fromCharCode(0xd83c);
		const out = sanitizeForJson(`prefix ${lone} suffix`);
		expect(out).toBe("prefix \uFFFD suffix");
	});

	it("replaces a lone low surrogate with U+FFFD", () => {
		const lone = String.fromCharCode(0xdf89);
		const out = sanitizeForJson(`prefix ${lone} suffix`);
		expect(out).toBe("prefix \uFFFD suffix");
	});

	it("survives a string with mixed valid + invalid surrogates", () => {
		// Valid 🎉 + lone high + valid ✅ + lone low + plain ASCII.
		const mixed = `🎉${String.fromCharCode(0xd83c)}✅${String.fromCharCode(0xdf89)}done`;
		const out = sanitizeForJson(mixed);
		expect(out).toBe("🎉\uFFFD✅\uFFFDdone");
	});

	it("does not mutate plain ASCII", () => {
		expect(sanitizeForJson("hello world 123 !@#")).toBe("hello world 123 !@#");
	});
});

describe("prefixWithRoutingHeader", () => {
	it("emits the routing header + hint + sanitized body", () => {
		const out = prefixWithRoutingHeader("!room:beeper.com", "$event123", "hello 🎉");
		expect(out).toContain("[matrix:room=!room:beeper.com:event=$event123]");
		expect(out).toContain("hello 🎉");
	});

	it("sanitizes lone surrogates in the user body before sending", () => {
		const out = prefixWithRoutingHeader("!r", "$e", `bad${String.fromCharCode(0xd83c)}data`);
		expect(out).toContain("bad\uFFFDdata");
		// Code-unit scan: no lone high surrogate anywhere in the output.
		let hasLone = false;
		for (let i = 0; i < out.length; i++) {
			const c = out.charCodeAt(i);
			if (c >= 0xd800 && c <= 0xdbff) {
				const next = out.charCodeAt(i + 1);
				if (!(next >= 0xdc00 && next <= 0xdfff)) hasLone = true;
			}
		}
		expect(hasLone).toBe(false);
	});
});
