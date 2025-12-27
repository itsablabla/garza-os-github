// GARZA OS Log Aggregator
// Cloudflare Worker that collects and queries logs from all services

const SERVICES = {
  'garza-home-mcp': 'https://garza-home-mcp.fly.dev',
  'lrlab-mcp': 'https://lrlab-mcp.fly.dev',
  'garza-ears': 'https://garza-ears.fly.dev',
  'cf-mcp': 'https://mcp-cf.garzahive.com',
  'n8n-mcp': 'https://n8n-mcp.garzahive.com',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    // Auth check
    const apiKey = request.headers.get('X-API-Key');
    if (apiKey !== env.API_KEY) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // Routes
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/logs' && request.method === 'POST') {
      return await handleLogIngestion(request, env, cors);
    }

    if (url.pathname === '/logs' && request.method === 'GET') {
      return await handleLogQuery(url, env, cors);
    }

    if (url.pathname === '/logs/search' && request.method === 'GET') {
      return await handleLogSearch(url, env, cors);
    }

    if (url.pathname === '/status') {
      return await handleStatus(env, cors);
    }

    return new Response(JSON.stringify({ 
      error: 'Not found',
      endpoints: ['/health', '/logs', '/logs/search', '/status']
    }), {
      status: 404,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  },

  async scheduled(event, env, ctx) {
    // Cron job to collect logs from all services
    ctx.waitUntil(collectAllLogs(env));
  },
};

async function handleLogIngestion(request, env, cors) {
  try {
    const body = await request.json();
    const { service, level, message, metadata } = body;

    if (!service || !message) {
      return new Response(JSON.stringify({ error: 'service and message required' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const logEntry = {
      id: crypto.randomUUID(),
      service,
      level: level || 'info',
      message,
      metadata: metadata || {},
      timestamp: new Date().toISOString(),
    };

    // Store in D1
    await env.DB.prepare(`
      INSERT INTO logs (id, service, level, message, metadata, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      logEntry.id,
      logEntry.service,
      logEntry.level,
      logEntry.message,
      JSON.stringify(logEntry.metadata),
      logEntry.timestamp
    ).run();

    return new Response(JSON.stringify({ success: true, id: logEntry.id }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
}

async function handleLogQuery(url, env, cors) {
  try {
    const service = url.searchParams.get('service');
    const level = url.searchParams.get('level');
    const limit = parseInt(url.searchParams.get('limit') || '100');
    const since = url.searchParams.get('since'); // ISO timestamp

    let query = 'SELECT * FROM logs WHERE 1=1';
    const params = [];

    if (service) {
      query += ' AND service = ?';
      params.push(service);
    }

    if (level) {
      query += ' AND level = ?';
      params.push(level);
    }

    if (since) {
      query += ' AND timestamp > ?';
      params.push(since);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const result = await env.DB.prepare(query).bind(...params).all();

    return new Response(JSON.stringify({
      logs: result.results.map(r => ({
        ...r,
        metadata: JSON.parse(r.metadata || '{}'),
      })),
      count: result.results.length,
    }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
}

async function handleLogSearch(url, env, cors) {
  try {
    const q = url.searchParams.get('q');
    const limit = parseInt(url.searchParams.get('limit') || '50');

    if (!q) {
      return new Response(JSON.stringify({ error: 'q parameter required' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const result = await env.DB.prepare(`
      SELECT * FROM logs 
      WHERE message LIKE ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    `).bind(`%${q}%`, limit).all();

    return new Response(JSON.stringify({
      logs: result.results.map(r => ({
        ...r,
        metadata: JSON.parse(r.metadata || '{}'),
      })),
      count: result.results.length,
      query: q,
    }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
}

async function handleStatus(env, cors) {
  try {
    // Get log counts by service
    const counts = await env.DB.prepare(`
      SELECT service, level, COUNT(*) as count 
      FROM logs 
      WHERE timestamp > datetime('now', '-24 hours')
      GROUP BY service, level
    `).all();

    // Check service health
    const health = {};
    for (const [name, url] of Object.entries(SERVICES)) {
      try {
        const res = await fetch(`${url}/health`, { 
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });
        health[name] = res.ok ? 'healthy' : `error:${res.status}`;
      } catch (e) {
        health[name] = 'unreachable';
      }
    }

    return new Response(JSON.stringify({
      logCounts: counts.results,
      serviceHealth: health,
      timestamp: new Date().toISOString(),
    }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
}

async function collectAllLogs(env) {
  // This would poll each service for recent logs
  // For now, services push logs to this aggregator
  console.log('Log collection triggered at', new Date().toISOString());
}
