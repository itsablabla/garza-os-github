const http = require('http');
const https = require('https');

const NVR_HOST = '192.168.10.49';
const NVR_USER = 'jaden';
const NVR_PASS = 'mezzec-fizWo4-kisweq';
const PORT = 7878;
const API_KEY = process.env.PROTECT_PROXY_KEY || 'protect-proxy-secret-key';

let authToken = null;
let csrfToken = null;
let tokenExpiry = 0;

// Disable SSL verification for self-signed cert
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function authenticate() {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ username: NVR_USER, password: NVR_PASS });
    
    const req = https.request({
      hostname: NVR_HOST,
      port: 443,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          // Extract token from Set-Cookie header
          const cookies = res.headers['set-cookie'] || [];
          for (const cookie of cookies) {
            const match = cookie.match(/TOKEN=([^;]+)/);
            if (match) {
              authToken = match[1];
            }
          }
          csrfToken = res.headers['x-csrf-token'] || res.headers['x-updated-csrf-token'];
          tokenExpiry = Date.now() + (2 * 60 * 60 * 1000); // 2 hours
          console.log('[AUTH] Authenticated successfully');
          resolve(true);
        } else {
          reject(new Error(`Auth failed: ${res.statusCode}`));
        }
      });
    });
    
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function ensureAuth() {
  if (!authToken || Date.now() > tokenExpiry - 60000) {
    await authenticate();
  }
}

async function getSnapshot(cameraId, width = 640) {
  await ensureAuth();
  
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: NVR_HOST,
      port: 443,
      path: `/proxy/protect/api/cameras/${cameraId}/snapshot?w=${width}`,
      method: 'GET',
      headers: {
        'Cookie': `TOKEN=${authToken}`,
        'X-CSRF-Token': csrfToken
      }
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (res.statusCode === 200 && buffer.length > 0) {
          resolve({ data: buffer, contentType: res.headers['content-type'] || 'image/jpeg' });
        } else {
          reject(new Error(`Snapshot failed: ${res.statusCode}, size: ${buffer.length}`));
        }
      });
    });
    
    req.on('error', reject);
    req.end();
  });
}

async function listCameras() {
  await ensureAuth();
  
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: NVR_HOST,
      port: 443,
      path: '/proxy/protect/api/cameras',
      method: 'GET',
      headers: {
        'Cookie': `TOKEN=${authToken}`,
        'X-CSRF-Token': csrfToken
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`List cameras failed: ${res.statusCode}`));
        }
      });
    });
    
    req.on('error', reject);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  // Check API key
  const authHeader = req.headers['x-api-key'] || req.headers['authorization'];
  if (authHeader !== API_KEY && authHeader !== `Bearer ${API_KEY}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  
  try {
    // GET /health
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', authenticated: !!authToken }));
      return;
    }
    
    // GET /cameras
    if (url.pathname === '/cameras') {
      const cameras = await listCameras();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cameras));
      return;
    }
    
    // GET /snapshot/:cameraId
    const snapshotMatch = url.pathname.match(/^\/snapshot\/([a-f0-9]+)$/);
    if (snapshotMatch) {
      const cameraId = snapshotMatch[1];
      const width = parseInt(url.searchParams.get('w') || '640');
      const format = url.searchParams.get('format') || 'binary';
      
      console.log(`[SNAPSHOT] Camera: ${cameraId}, width: ${width}`);
      const { data, contentType } = await getSnapshot(cameraId, width);
      
      if (format === 'base64') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          image: data.toString('base64'),
          contentType,
          size: data.length
        }));
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      }
      return;
    }
    
    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    
  } catch (err) {
    console.error('[ERROR]', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[PROTECT-PROXY] Running on http://127.0.0.1:${PORT}`);
  console.log(`[PROTECT-PROXY] Endpoints:`);
  console.log(`  GET /health`);
  console.log(`  GET /cameras`);
  console.log(`  GET /snapshot/:cameraId?w=640&format=binary|base64`);
});
