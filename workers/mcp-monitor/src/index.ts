/**
 * GARZA OS - MCP Health Monitor v2.0 (Self-Healing)
 * Monitors all MCP connections, auto-heals Fly.io apps, alerts via Pushcut
 */

export interface Env {
  MCP_STATE: KVNamespace;
  PUSHCUT_WEBHOOK: string;
  FLY_API_TOKEN: string;
}

interface MCPServer {
  name: string;
  url: string;
  healthEndpoint: string;
  critical: boolean;
  flyApp?: string; // Fly.io app name for auto-healing
  acceptedStatuses?: number[]; // Additional status codes to accept as "healthy"
}

const MCP_SERVERS: MCPServer[] = [
  {
    name: "Garza Home MCP",
    url: "https://garza-home-mcp.fly.dev",
    healthEndpoint: "/health",
    critical: true,
    flyApp: "garza-home-mcp"
  },
  {
    name: "Last Rock Dev MCP",
    url: "https://lrlab-mcp.fly.dev",
    healthEndpoint: "/health",
    critical: true,
    flyApp: "lrlab-mcp"
  },
  {
    name: "CF MCP",
    url: "https://mcp-cf.garzahive.com",
    healthEndpoint: "/health",
    critical: false
  },
  {
    name: "Garza Hive MCP",
    url: "https://mcp.garzahive.com",
    healthEndpoint: "/health",
    critical: false
  },
  {
    name: "Beeper MCP",
    url: "https://beeper-mcp.garzahive.com",
    healthEndpoint: "/v0/mcp",
    critical: true,
    acceptedStatuses: [405] // SSE endpoint returns 405 on GET, but means server is up
  },
  {
    name: "SSH Backup MCP",
    url: "https://ssh-backup.garzahive.com",
    healthEndpoint: "/health",
    critical: false
  },
  {
    name: "SSH Backup 2 MCP",
    url: "https://ssh-backup2.garzahive.com",
    healthEndpoint: "/health",
    critical: false
  }
];

interface ServerState {
  status: "up" | "down";
  lastCheck: string;
  consecutiveFailures: number;
  lastAlertSent?: string;
  lastHealAttempt?: string;
  healAttempts: number;
}

async function checkServer(server: MCPServer): Promise<{ healthy: boolean; latency?: number; error?: string }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(server.url + server.healthEndpoint, {
      method: "GET",
      signal: controller.signal,
      headers: { 
        "User-Agent": "GARZA-OS-Monitor/2.0",
        "Accept": "text/event-stream, application/json, */*"
      }
    });
    
    clearTimeout(timeout);
    const latency = Date.now() - start;
    
    // Check if status is 2xx OR in the server's accepted statuses list
    const isAccepted = (response.status >= 200 && response.status < 300) ||
                       (server.acceptedStatuses?.includes(response.status));
    
    if (isAccepted) {
      return { healthy: true, latency };
    }
    return { healthy: false, error: "HTTP " + response.status };
  } catch (err) {
    const latency = Date.now() - start;
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    if (errorMsg.includes("abort")) {
      return { healthy: false, error: "Timeout (" + latency + "ms)" };
    }
    return { healthy: false, error: errorMsg };
  }
}

async function restartFlyApp(appName: string, token: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Get machines for the app
    const machinesRes = await fetch(
      "https://api.machines.dev/v1/apps/" + appName + "/machines",
      {
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json"
        }
      }
    );
    
    if (!machinesRes.ok) {
      return { success: false, error: "Failed to get machines: HTTP " + machinesRes.status };
    }
    
    const machines = await machinesRes.json() as Array<{ id: string; state: string }>;
    
    if (!machines || machines.length === 0) {
      return { success: false, error: "No machines found" };
    }
    
    // Restart each machine
    for (const machine of machines) {
      const restartRes = await fetch(
        "https://api.machines.dev/v1/apps/" + appName + "/machines/" + machine.id + "/restart",
        {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json"
          }
        }
      );
      
      if (!restartRes.ok) {
        return { success: false, error: "Restart failed for " + machine.id + ": HTTP " + restartRes.status };
      }
    }
    
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

async function sendPushcutAlert(env: Env, title: string, text: string, isTimeSensitive: boolean = true) {
  if (!env.PUSHCUT_WEBHOOK) {
    console.log("No PUSHCUT_WEBHOOK configured, skipping alert");
    return;
  }
  try {
    await fetch(env.PUSHCUT_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        text,
        isTimeSensitive,
        sound: isTimeSensitive ? "vibes" : undefined
      })
    });
    console.log("Alert sent: " + title);
  } catch (err) {
    console.error("Failed to send Pushcut alert:", err);
  }
}

async function runHealthCheck(env: Env): Promise<Response> {
  const results: { 
    server: string; 
    status: string; 
    latency?: number; 
    error?: string;
    healed?: boolean;
    healError?: string;
  }[] = [];
  const alerts: string[] = [];
  const recoveries: string[] = [];
  const healed: string[] = [];
  
  for (const server of MCP_SERVERS) {
    const stateKey = "mcp:" + server.name;
    const previousStateRaw = await env.MCP_STATE.get(stateKey);
    const previousState: ServerState = previousStateRaw 
      ? JSON.parse(previousStateRaw) 
      : { status: "up", lastCheck: new Date().toISOString(), consecutiveFailures: 0, healAttempts: 0 };
    
    let check = await checkServer(server);
    
    const newState: ServerState = {
      status: check.healthy ? "up" : "down",
      lastCheck: new Date().toISOString(),
      consecutiveFailures: check.healthy ? 0 : previousState.consecutiveFailures + 1,
      lastAlertSent: previousState.lastAlertSent,
      lastHealAttempt: previousState.lastHealAttempt,
      healAttempts: check.healthy ? 0 : previousState.healAttempts
    };
    
    const result: typeof results[0] = {
      server: server.name,
      status: check.healthy ? "UP" : "DOWN",
      latency: check.latency,
      error: check.error
    };
    
    // Self-healing logic for Fly.io apps
    if (!check.healthy && server.flyApp && env.FLY_API_TOKEN) {
      const hoursSinceLastHeal = previousState.lastHealAttempt 
        ? (Date.now() - new Date(previousState.lastHealAttempt).getTime()) / (1000 * 60 * 60)
        : Infinity;
      
      // Attempt healing after 1 failure, max once per 10 minutes
      if (newState.consecutiveFailures >= 1 && (hoursSinceLastHeal >= 0.167 || !previousState.lastHealAttempt)) {
        console.log("Attempting to heal " + server.name + " (app: " + server.flyApp + ")");
        
        const healResult = await restartFlyApp(server.flyApp, env.FLY_API_TOKEN);
        newState.lastHealAttempt = new Date().toISOString();
        newState.healAttempts = previousState.healAttempts + 1;
        
        if (healResult.success) {
          result.healed = true;
          healed.push(server.name);
          
          // Wait 45 seconds for app to come back up
          await new Promise(resolve => setTimeout(resolve, 45000));
          
          // Recheck health
          const recheck = await checkServer(server);
          if (recheck.healthy) {
            check = recheck;
            newState.status = "up";
            newState.consecutiveFailures = 0;
            newState.healAttempts = 0;
            result.status = "UP (healed)";
            result.latency = recheck.latency;
            result.error = undefined;
            console.log(server.name + " healed successfully!");
          } else {
            result.status = "DOWN (heal attempted)";
            result.healError = "Still down after restart";
            console.log(server.name + " still down after restart");
          }
        } else {
          result.healed = false;
          result.healError = healResult.error;
          console.log("Heal failed for " + server.name + ": " + healResult.error);
        }
      }
    }
    
    results.push(result);
    
    // Alert logic - only alert if still down after heal attempts (or non-healable server)
    if (!check.healthy && newState.consecutiveFailures >= 2) {
      // For healable servers, only alert after 2+ failed heal attempts
      // For non-healable servers, alert after 2 consecutive failures
      const shouldAlert = server.flyApp 
        ? newState.healAttempts >= 2 
        : true;
      
      if (shouldAlert) {
        const hoursSinceLastAlert = previousState.lastAlertSent 
          ? (Date.now() - new Date(previousState.lastAlertSent).getTime()) / (1000 * 60 * 60)
          : Infinity;
        
        if (hoursSinceLastAlert >= 1 || previousState.status === "up") {
          const alertMsg = server.flyApp 
            ? server.name + ": " + check.error + " (heal failed " + newState.healAttempts + "x)"
            : server.name + ": " + check.error;
          alerts.push(alertMsg);
          newState.lastAlertSent = new Date().toISOString();
        }
      }
    }
    
    // Recovery notification
    if (check.healthy && previousState.status === "down" && previousState.consecutiveFailures >= 2) {
      recoveries.push(server.name);
    }
    
    await env.MCP_STATE.put(stateKey, JSON.stringify(newState), { expirationTtl: 86400 });
  }
  
  // Send alerts
  if (alerts.length > 0) {
    await sendPushcutAlert(env, "MCP Server Down", alerts.join("\n"), true);
  }
  
  if (recoveries.length > 0) {
    await sendPushcutAlert(env, "MCP Server Recovered", recoveries.join(", ") + " back online", false);
  }
  
  if (healed.length > 0 && alerts.length === 0) {
    // Only notify about auto-heals if everything is now healthy
    await sendPushcutAlert(env, "MCP Auto-Healed", healed.join(", ") + " restarted successfully", false);
  }
  
  return new Response(JSON.stringify({
    timestamp: new Date().toISOString(),
    version: "2.0-selfhealing",
    results,
    summary: {
      total: results.length,
      healthy: results.filter(r => r.status.includes("UP")).length,
      down: results.filter(r => r.status.includes("DOWN")).length,
      healed: healed.length
    },
    alertsSent: alerts.length,
    recoveriesSent: recoveries.length
  }, null, 2), {
    headers: { "Content-Type": "application/json" }
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname === "/check" || url.pathname === "/") {
      return runHealthCheck(env);
    }
    
    if (url.pathname === "/status") {
      const states: Record<string, ServerState> = {};
      for (const server of MCP_SERVERS) {
        const state = await env.MCP_STATE.get("mcp:" + server.name);
        states[server.name] = state ? JSON.parse(state) : { status: "unknown", healAttempts: 0 };
      }
      return new Response(JSON.stringify(states, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    if (url.pathname === "/heal" && url.searchParams.get("app")) {
      const appName = url.searchParams.get("app")!;
      if (!env.FLY_API_TOKEN) {
        return new Response(JSON.stringify({ error: "FLY_API_TOKEN not configured" }), { status: 500 });
      }
      const result = await restartFlyApp(appName, env.FLY_API_TOKEN);
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    return new Response("GARZA OS MCP Monitor v2.0 (Self-Healing)\n\nEndpoints:\n  /check - Run health check\n  /status - View current status\n  /heal?app=name - Manually restart Fly app", {
      headers: { "Content-Type": "text/plain" }
    });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runHealthCheck(env));
  }
};
