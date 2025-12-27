/**
 * Cloudflare Worker Template: Basic API
 * 
 * Usage:
 * 1. Copy to new worker directory
 * 2. Update wrangler.toml with name
 * 3. Add any secrets: wrangler secret put API_KEY
 * 4. Deploy: wrangler deploy
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check
    if (path === '/health') {
      return Response.json({ status: 'ok', timestamp: new Date().toISOString() }, { headers: corsHeaders });
    }

    // API routes
    if (path === '/api/endpoint' && request.method === 'POST') {
      try {
        const body = await request.json();
        
        // Your logic here
        const result = {
          received: body,
          processed: true
        };

        return Response.json(result, { headers: corsHeaders });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 400, headers: corsHeaders });
      }
    }

    // 404 for unknown routes
    return Response.json({ error: 'Not found' }, { status: 404, headers: corsHeaders });
  },

  // Optional: Scheduled handler for cron triggers
  async scheduled(event, env, ctx) {
    console.log('Cron triggered at:', new Date().toISOString());
    // Your scheduled logic here
  }
};
