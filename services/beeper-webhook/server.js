const http = require('http');

const BEEPER_API = 'http://localhost:23373';
const BEEPER_TOKEN = '3a48068b-e6df-4d9c-b39b-0e41979edaa7';
const PORT = 23374;
const AUTH_KEY = 'garza-n8n-2024';

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (req.method !== 'POST' || req.url !== '/send') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
    }

    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${AUTH_KEY}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
        try {
            const { chat_id, message } = JSON.parse(body);
            if (!chat_id || !message) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'chat_id and message required' }));
                return;
            }

            const beeperRes = await fetch(`${BEEPER_API}/api/v1/rooms/${encodeURIComponent(chat_id)}/send`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${BEEPER_TOKEN}`
                },
                body: JSON.stringify({ body: message, msgtype: 'm.text' })
            });

            const result = await beeperRes.json();
            res.writeHead(beeperRes.ok ? 200 : 500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: beeperRes.ok, result }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
    });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`Beeper webhook running on port ${PORT}`);
});
