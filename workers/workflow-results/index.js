// Workflow Results Callback Worker
// Stores GitHub Actions workflow outputs for Claude to query

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    // POST /result - Store workflow result
    if (request.method === 'POST' && path === '/result') {
      try {
        const body = await request.json();
        const { run_id, workflow, host, command, output, status, exit_code } = body;
        
        if (!run_id) {
          return new Response(JSON.stringify({ error: 'run_id required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const result = {
          run_id,
          workflow: workflow || 'unknown',
          host: host || null,
          command: command || null,
          output: output || '',
          status: status || 'unknown',
          exit_code: exit_code ?? null,
          timestamp: new Date().toISOString()
        };

        // Store in KV with 24h TTL
        await env.WORKFLOW_RESULTS.put(`run:${run_id}`, JSON.stringify(result), {
          expirationTtl: 86400
        });

        // Also store as latest for quick access
        await env.WORKFLOW_RESULTS.put('latest', JSON.stringify(result), {
          expirationTtl: 3600
        });

        // Store in recent list (last 20)
        const recentKey = 'recent_runs';
        const recentData = await env.WORKFLOW_RESULTS.get(recentKey);
        let recent = recentData ? JSON.parse(recentData) : [];
        recent.unshift({ run_id, workflow, status, timestamp: result.timestamp });
        recent = recent.slice(0, 20);
        await env.WORKFLOW_RESULTS.put(recentKey, JSON.stringify(recent), {
          expirationTtl: 86400
        });

        return new Response(JSON.stringify({ success: true, run_id }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // GET /result/:run_id - Get specific result
    if (request.method === 'GET' && path.startsWith('/result/')) {
      const run_id = path.split('/result/')[1];
      const data = await env.WORKFLOW_RESULTS.get(`run:${run_id}`);
      
      if (!data) {
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      return new Response(data, {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // GET /latest - Get most recent result
    if (request.method === 'GET' && path === '/latest') {
      const data = await env.WORKFLOW_RESULTS.get('latest');
      
      if (!data) {
        return new Response(JSON.stringify({ error: 'No results yet' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      return new Response(data, {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // GET /recent - Get recent runs list
    if (request.method === 'GET' && path === '/recent') {
      const data = await env.WORKFLOW_RESULTS.get('recent_runs');
      
      return new Response(data || '[]', {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // GET /health - Health check
    if (path === '/health' || path === '/') {
      return new Response(JSON.stringify({ 
        status: 'ok', 
        service: 'workflow-results',
        timestamp: new Date().toISOString()
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
};
