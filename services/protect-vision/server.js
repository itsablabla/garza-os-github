import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import https from 'https';
import { EventEmitter } from 'events';

// ============== CONFIGURATION ==============
const CONFIG = {
  // Server
  port: process.env.PORT || 3847,
  
  // UniFi Protect NVR
  nvr: {
    host: '192.168.10.49',
    username: 'jaden',
    password: 'mezzec-fizWo4-kisweq'
  },
  
  // Anthropic API
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  
  // Cache settings
  snapshotCacheTTL: 5000,      // 5 seconds
  authRefreshInterval: 3600000, // 1 hour (tokens last 2 hours)
  
  // Analysis defaults
  defaultAnalysisPrompt: `Analyze this security camera image. Describe:
1. People present (count, general description, activities)
2. Any unusual activity or security concerns
3. Time of day estimate based on lighting
4. Notable objects or changes from a typical scene
Be concise but thorough.`
};

// ============== NVR CLIENT ==============
class NVRClient extends EventEmitter {
  constructor(config) {
    super();
    this.host = config.host;
    this.username = config.username;
    this.password = config.password;
    this.token = null;
    this.csrfToken = null;
    this.tokenExpiry = null;
    this.cameras = new Map();
    this.snapshotCache = new Map();
  }

  async request(path, options = {}) {
    const url = `https://${this.host}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
    
    if (this.token) {
      headers['Cookie'] = `TOKEN=${this.token}`;
    }
    if (this.csrfToken) {
      headers['X-CSRF-Token'] = this.csrfToken;
    }

    return new Promise((resolve, reject) => {
      const req = https.request(url, {
        method: options.method || 'GET',
        headers,
        rejectUnauthorized: false // Self-signed cert
      }, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body,
            json: () => {
              try { return JSON.parse(body.toString()); }
              catch { return null; }
            }
          });
        });
      });
      
      req.on('error', reject);
      if (options.body) req.write(options.body);
      req.end();
    });
  }

  async authenticate() {
    console.log('[NVR] Authenticating...');
    
    const res = await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: this.username,
        password: this.password
      })
    });

    if (res.status !== 200) {
      throw new Error(`Authentication failed: ${res.status}`);
    }

    // Extract token from Set-Cookie header
    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
      const tokenMatch = setCookie.find(c => c.startsWith('TOKEN='));
      if (tokenMatch) {
        this.token = tokenMatch.split('=')[1].split(';')[0];
      }
    }

    // Extract CSRF token
    this.csrfToken = res.headers['x-csrf-token'] || res.headers['x-updated-csrf-token'];
    
    // Set expiry (2 hours from now, refresh at 1 hour)
    this.tokenExpiry = Date.now() + CONFIG.authRefreshInterval;
    
    console.log('[NVR] Authenticated successfully');
    this.emit('authenticated');
    return true;
  }

  async ensureAuth() {
    if (!this.token || Date.now() > this.tokenExpiry) {
      await this.authenticate();
    }
  }

  async getCameras(forceRefresh = false) {
    await this.ensureAuth();
    
    if (this.cameras.size > 0 && !forceRefresh) {
      return Array.from(this.cameras.values());
    }

    const res = await this.request('/proxy/protect/api/cameras');
    if (res.status !== 200) {
      throw new Error(`Failed to get cameras: ${res.status}`);
    }

    const cameras = res.json();
    this.cameras.clear();
    for (const cam of cameras) {
      this.cameras.set(cam.id, cam);
    }
    
    console.log(`[NVR] Loaded ${cameras.length} cameras`);
    return cameras;
  }

  async getSnapshot(cameraId, width = 640) {
    await this.ensureAuth();
    
    // Check cache
    const cacheKey = `${cameraId}-${width}`;
    const cached = this.snapshotCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CONFIG.snapshotCacheTTL) {
      return cached.data;
    }

    const res = await this.request(
      `/proxy/protect/api/cameras/${cameraId}/snapshot?w=${width}`
    );

    if (res.status !== 200) {
      throw new Error(`Failed to get snapshot: ${res.status}`);
    }

    // Cache it
    this.snapshotCache.set(cacheKey, {
      data: res.body,
      timestamp: Date.now()
    });

    return res.body;
  }

  async getEvents(limit = 20, types = ['motion', 'smartDetectZone', 'ring']) {
    await this.ensureAuth();
    
    const typeParam = types.join(',');
    const res = await this.request(
      `/proxy/protect/api/events?limit=${limit}&types=${typeParam}`
    );

    if (res.status !== 200) {
      throw new Error(`Failed to get events: ${res.status}`);
    }

    return res.json();
  }
}

// ============== AI ANALYZER ==============
class VisionAnalyzer {
  constructor(apiKey) {
    this.client = new Anthropic({ apiKey });
  }

  async analyzeImage(imageBuffer, prompt = CONFIG.defaultAnalysisPrompt, options = {}) {
    const base64 = imageBuffer.toString('base64');
    const mediaType = 'image/jpeg';

    const response = await this.client.messages.create({
      model: options.model || 'claude-sonnet-4-20250514',
      max_tokens: options.maxTokens || 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64
            }
          },
          {
            type: 'text',
            text: prompt
          }
        ]
      }]
    });

    return response.content[0].text;
  }

  async compareImages(image1Buffer, image2Buffer, prompt) {
    const base64_1 = image1Buffer.toString('base64');
    const base64_2 = image2Buffer.toString('base64');

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: base64_1 }
          },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: base64_2 }
          },
          {
            type: 'text',
            text: prompt || 'Compare these two security camera images. What has changed between them? Note any new people, objects, or movement.'
          }
        ]
      }]
    });

    return response.content[0].text;
  }
}

// ============== EXPRESS SERVER ==============
const app = express();
app.use(express.json());

const nvr = new NVRClient(CONFIG.nvr);
const analyzer = CONFIG.anthropicApiKey ? new VisionAnalyzer(CONFIG.anthropicApiKey) : null;

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    authenticated: !!nvr.token,
    camerasLoaded: nvr.cameras.size,
    aiEnabled: !!analyzer,
    uptime: process.uptime()
  });
});

// List cameras
app.get('/cameras', async (req, res) => {
  try {
    const cameras = await nvr.getCameras(req.query.refresh === 'true');
    res.json(cameras);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get camera by ID
app.get('/cameras/:id', async (req, res) => {
  try {
    await nvr.getCameras();
    const camera = nvr.cameras.get(req.params.id);
    if (!camera) {
      return res.status(404).json({ error: 'Camera not found' });
    }
    res.json(camera);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get snapshot (raw image)
app.get('/cameras/:id/snapshot', async (req, res) => {
  try {
    const width = parseInt(req.query.width) || 640;
    const snapshot = await nvr.getSnapshot(req.params.id, width);
    res.set('Content-Type', 'image/jpeg');
    res.send(snapshot);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get snapshot as base64
app.get('/cameras/:id/snapshot/base64', async (req, res) => {
  try {
    const width = parseInt(req.query.width) || 640;
    const snapshot = await nvr.getSnapshot(req.params.id, width);
    res.json({
      cameraId: req.params.id,
      width,
      base64: snapshot.toString('base64'),
      mimeType: 'image/jpeg',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Analyze snapshot with AI
app.post('/cameras/:id/analyze', async (req, res) => {
  if (!analyzer) {
    return res.status(503).json({ error: 'AI analyzer not configured. Set ANTHROPIC_API_KEY.' });
  }

  try {
    const width = parseInt(req.query.width) || 1280;
    const snapshot = await nvr.getSnapshot(req.params.id, width);
    
    const prompt = req.body.prompt || CONFIG.defaultAnalysisPrompt;
    const analysis = await analyzer.analyzeImage(snapshot, prompt, {
      model: req.body.model,
      maxTokens: req.body.maxTokens
    });

    // Get camera info
    await nvr.getCameras();
    const camera = nvr.cameras.get(req.params.id);

    res.json({
      cameraId: req.params.id,
      cameraName: camera?.name || 'Unknown',
      analysis,
      timestamp: new Date().toISOString(),
      prompt
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Analyze all connected cameras
app.post('/analyze/all', async (req, res) => {
  if (!analyzer) {
    return res.status(503).json({ error: 'AI analyzer not configured.' });
  }

  try {
    const cameras = await nvr.getCameras();
    const connected = cameras.filter(c => c.state === 'CONNECTED');
    const prompt = req.body.prompt || 'Briefly describe what you see in this camera view. One sentence.';
    
    const results = await Promise.allSettled(
      connected.map(async (cam) => {
        const snapshot = await nvr.getSnapshot(cam.id, 640);
        const analysis = await analyzer.analyzeImage(snapshot, prompt);
        return {
          cameraId: cam.id,
          cameraName: cam.name,
          analysis
        };
      })
    );

    res.json({
      timestamp: new Date().toISOString(),
      cameras: results.map((r, i) => 
        r.status === 'fulfilled' ? r.value : { 
          cameraId: connected[i].id, 
          cameraName: connected[i].name, 
          error: r.reason?.message 
        }
      )
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get recent events
app.get('/events', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const events = await nvr.getEvents(limit);
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// MCP-style tool endpoints
app.post('/mcp/snapshot', async (req, res) => {
  try {
    const { camera_id, camera_name, width = 640 } = req.body;
    
    // Find camera by name if ID not provided
    let cameraId = camera_id;
    if (!cameraId && camera_name) {
      const cameras = await nvr.getCameras();
      const cam = cameras.find(c => 
        c.name.toLowerCase().includes(camera_name.toLowerCase())
      );
      if (cam) cameraId = cam.id;
    }

    if (!cameraId) {
      return res.status(400).json({ error: 'Camera not found' });
    }

    const snapshot = await nvr.getSnapshot(cameraId, width);
    const camera = nvr.cameras.get(cameraId);

    res.json({
      success: true,
      camera: {
        id: cameraId,
        name: camera?.name
      },
      image: {
        base64: snapshot.toString('base64'),
        mimeType: 'image/jpeg',
        width
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/mcp/analyze', async (req, res) => {
  if (!analyzer) {
    return res.status(503).json({ error: 'AI not configured' });
  }

  try {
    const { camera_id, camera_name, prompt, width = 1280 } = req.body;
    
    let cameraId = camera_id;
    if (!cameraId && camera_name) {
      const cameras = await nvr.getCameras();
      const cam = cameras.find(c => 
        c.name.toLowerCase().includes(camera_name.toLowerCase())
      );
      if (cam) cameraId = cam.id;
    }

    if (!cameraId) {
      return res.status(400).json({ error: 'Camera not found' });
    }

    const snapshot = await nvr.getSnapshot(cameraId, width);
    const analysis = await analyzer.analyzeImage(snapshot, prompt);
    const camera = nvr.cameras.get(cameraId);

    res.json({
      success: true,
      camera: {
        id: cameraId,
        name: camera?.name
      },
      analysis,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============== STARTUP ==============
async function start() {
  console.log('='.repeat(50));
  console.log('  Protect Vision Server');
  console.log('='.repeat(50));
  
  // Initial auth
  try {
    await nvr.authenticate();
    await nvr.getCameras();
  } catch (error) {
    console.error('[STARTUP] Failed to connect to NVR:', error.message);
  }

  // Periodic auth refresh
  setInterval(async () => {
    try {
      await nvr.authenticate();
    } catch (error) {
      console.error('[AUTH] Refresh failed:', error.message);
    }
  }, CONFIG.authRefreshInterval);

  // Start server
  app.listen(CONFIG.port, () => {
    console.log(`[SERVER] Running on http://localhost:${CONFIG.port}`);
    console.log(`[SERVER] AI Analysis: ${analyzer ? 'ENABLED' : 'DISABLED (set ANTHROPIC_API_KEY)'}`);
    console.log('');
    console.log('Endpoints:');
    console.log('  GET  /health              - Server status');
    console.log('  GET  /cameras             - List all cameras');
    console.log('  GET  /cameras/:id/snapshot - Get camera image');
    console.log('  POST /cameras/:id/analyze  - AI analysis of camera');
    console.log('  POST /analyze/all          - AI analysis of all cameras');
    console.log('  POST /mcp/snapshot         - MCP-compatible snapshot');
    console.log('  POST /mcp/analyze          - MCP-compatible analysis');
    console.log('='.repeat(50));
  });
}

start();
