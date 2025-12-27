// Garza Health Monitor Worker
// Checks health of compute endpoints every 5 minutes

const ENDPOINTS = [
  { name: "mac-commander", url: "https://desktopcommander.garzahive.com/mcp", key: "30e198cf037ffd6accc4aa739e6d9b448e23aa67cd4070503eb06c0acb5235be" },
  { name: "do-commander", url: "https://do-commander.garzahive.com/health", key: "30e198cf037ffd6accc4aa739e6d9b448e23aa67cd4070503eb06c0acb5235be" },
  { name: "chrome-control", url: "https://control-chrome.garzahive.com/mcp", key: "30e198cf037ffd6accc4aa739e6d9b448e23aa67cd4070503eb06c0acb5235be" },
];

async function checkEndpoint(endpoint) {
  const start = Date.now();
  try {
    const res = await fetch(endpoint.url + "?key=" + endpoint.key, { 
      method: "GET",
      headers: { "x-api-key": endpoint.key }
    });
    const latency = Date.now() - start;
    return { name: endpoint.name, status: res.ok ? "healthy" : "unhealthy", code: res.status, latency };
  } catch (e) {
    return { name: endpoint.name, status: "down", error: e.message, latency: Date.now() - start };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      const results = await Promise.all(ENDPOINTS.map(checkEndpoint));
      const allHealthy = results.every(r => r.status === "healthy");
      return new Response(JSON.stringify({ ok: allHealthy, endpoints: results, timestamp: new Date().toISOString() }, null, 2), {
        headers: { "Content-Type": "application/json" },
        status: allHealthy ? 200 : 503
      });
    }
    return new Response("Garza Health Monitor - GET /health for status", { status: 200 });
  },
  
  async scheduled(event, env, ctx) {
    const results = await Promise.all(ENDPOINTS.map(checkEndpoint));
    const unhealthy = results.filter(r => r.status !== "healthy");
    
    // Store in KV
    if (env.GARZA_STATE) {
      await env.GARZA_STATE.put("health_status", JSON.stringify({ results, timestamp: new Date().toISOString() }));
      if (unhealthy.length > 0) {
        await env.GARZA_STATE.put("health_alerts", JSON.stringify({ unhealthy, timestamp: new Date().toISOString() }));
      }
    }
    
    console.log("Health check completed:", JSON.stringify(results));
  }
};
