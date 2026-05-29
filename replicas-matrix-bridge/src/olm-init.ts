// Cloudflare-Workers-compatible bootstrap for the @matrix-org/olm WASM
// blob. The shipped olm.js does emscripten-style env detection that fails
// in Workers (`module.exports` ReferenceError, no `window`, no fetch of
// olm.wasm via URL). We work around it by:
//
//   1. Stubbing `globalThis.window` with the Web Crypto getRandomValues
//      so the browser branch runs and the RNG works.
//   2. Pre-loading the wasm as a `WebAssembly.Module` via wrangler's
//      `CompiledWasm` rule and handing it to Olm via the
//      `instantiateWasm` callback (no fetch, no XHR).
//
// After init this module exports the Olm namespace.

// @ts-expect-error — wrangler resolves `*.wasm` imports to WebAssembly.Module
import wasmModule from "./olm.wasm";
import type * as OlmTypes from "@matrix-org/olm";

type OlmRuntime = typeof OlmTypes & { init: () => Promise<void>; get_library_version: () => unknown };

let cached: Promise<OlmRuntime> | null = null;

function installShims(): void {
	const g = globalThis as unknown as Record<string, unknown>;
	if (typeof g.window === "undefined") {
		g.window = {
			crypto: {
				getRandomValues: (buf: Uint8Array) => crypto.getRandomValues(buf),
			},
			location: { href: "" },
		};
	}
	// Some emscripten branches probe `document`; make it benign.
	if (typeof g.document === "undefined") {
		g.document = { currentScript: null };
	}
	// Pass our wasm preloader via Olm's documented OLM_OPTIONS escape hatch.
	g.OLM_OPTIONS = {
		instantiateWasm: (
			imports: WebAssembly.Imports,
			callback: (instance: WebAssembly.Instance) => void,
		) => {
			(async () => {
				const instance = await WebAssembly.instantiate(wasmModule as WebAssembly.Module, imports);
				callback(instance);
			})();
			return {};
		},
	};
}

export async function getOlm(): Promise<OlmRuntime> {
	if (cached) return cached;
	cached = (async () => {
		installShims();
		// Dynamic import so the shims land before olm.js evaluates the env
		// detection at module top-level. The package uses `export as namespace
		// Olm` so the runtime value is on the module's default-ish slot.
		const mod = (await import("@matrix-org/olm")) as unknown as { default?: OlmRuntime } & OlmRuntime;
		const Olm = (mod.default ?? mod) as OlmRuntime;
		await Olm.init();
		return Olm;
	})();
	return cached;
}
