// Cloudflare Worker that fronts the Pantalaimon container.
//
// Pantalaimon is a Matrix E2EE proxy — it terminates encryption so the
// rest of the bridge can keep speaking plain Matrix Client-Server API.
// The container runs Pantalaimon on :8008 against matrix-client.matrix.org;
// this Worker just proxies every request through to the single shared
// container instance (DO-routed via env.PAN).
//
// Caveats:
//   - The container's /data is ephemeral. Pantalaimon's crypto store and
//     access tokens regenerate on container restart, so the bridge must
//     re-login (POST /_matrix/client/v3/login with the matrix.org password)
//     and re-save the returned token whenever the container cold-starts.
//   - max_instances = 1 because Pantalaimon is single-tenant per device.

import { Container, getContainer } from "@cloudflare/containers";

export class PantalaimonContainer extends Container {
	defaultPort = 8008;
	// Keep the container hot — Pantalaimon's in-memory Olm/Megolm sessions
	// are expensive to rebuild, and we want decryption latency to stay low.
	sleepAfter = "1h";

	override async fetch(request: Request): Promise<Response> {
		// Cold-start CF Container provisioning can take 30-60s on first boot
		// while the Firecracker VM gets scheduled. The library's default port
		// wait is too short for Pantalaimon (Python startup + matrix.org TLS
		// handshake), so bump the timeout.
		await this.startAndWaitForPorts({
			ports: [8008],
			cancellationOptions: {
				instanceGetTimeoutMS: 60_000,
				portReadyTimeoutMS: 30_000,
				waitInterval: 1000,
			},
		});
		return this.containerFetch(request);
	}

	override onError(error: unknown): Response {
		return new Response(
			`pantalaimon container error: ${error instanceof Error ? error.message : String(error)}`,
			{ status: 502 },
		);
	}
}

export interface Env {
	PAN: DurableObjectNamespace<PantalaimonContainer>;
}

export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		const url = new URL(req.url);

		if (url.pathname === "/health") {
			return new Response("ok", { status: 200 });
		}

		// All Matrix CS API paths get proxied through the container.
		const c = getContainer(env.PAN, "default");
		return c.fetch(req);
	},
} satisfies ExportedHandler<Env>;
