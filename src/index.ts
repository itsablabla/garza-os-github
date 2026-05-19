import { Container } from "@cloudflare/containers";

export class DroidContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "10m";

  get envVars() {
    const env = this.env as Env;
    return {
      FACTORY_API_KEY: env.FACTORY_API_KEY,
      DROID_API_KEY: env.DROID_API_KEY,
    };
  }
}

interface Env {
  FACTORY_API_KEY: string;
  DROID_API_KEY: string;
  DROID_CONTAINER: DurableObjectNamespace<DroidContainer>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname !== "/run" || request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    // Auth
    const auth = request.headers.get("Authorization");
    if (auth !== `Bearer ${env.DROID_API_KEY}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Route to container (singleton instance)
    const id = env.DROID_CONTAINER.idFromName("singleton");
    const stub = env.DROID_CONTAINER.get(id);
    return stub.fetch(request);
  },
};
