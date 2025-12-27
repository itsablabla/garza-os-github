const http = require('http');
const { execSync, exec } = require('child_process');
const fs = require('fs');

const PORT = 3000;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (url.pathname === '/screenshot') {
    try {
      execSync('DISPLAY=:99 scrot -o /tmp/screen.png');
      const img = fs.readFileSync('/tmp/screen.png');
      res.setHeader('Content-Type', 'image/png');
      res.end(img);
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e.message }));
    }
  } else if (url.pathname === '/xdotool') {
    const cmd = url.searchParams.get('cmd');
    if (!cmd) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'cmd required' }));
      return;
    }
    try {
      const output = execSync(`DISPLAY=:99 xdotool ${cmd}`, { timeout: 5000 }).toString();
      res.end(JSON.stringify({ ok: true, output }));
    } catch (e) {
      res.end(JSON.stringify({ ok: true, output: e.message }));
    }
  } else if (url.pathname === '/navigate') {
    const navUrl = url.searchParams.get('url');
    if (!navUrl) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'url required' }));
      return;
    }
    try {
      execSync('DISPLAY=:99 xdotool key ctrl+l');
      execSync(`DISPLAY=:99 xdotool type "${navUrl}"`);
      execSync('DISPLAY=:99 xdotool key Return');
      res.end(JSON.stringify({ ok: true, navigated: navUrl }));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e.message }));
    }
  } else if (url.pathname === '/click') {
    const x = url.searchParams.get('x');
    const y = url.searchParams.get('y');
    try {
      execSync(`DISPLAY=:99 xdotool mousemove ${x} ${y} click 1`);
      res.end(JSON.stringify({ ok: true, clicked: { x, y } }));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e.message }));
    }
  } else if (url.pathname === '/type') {
    const text = url.searchParams.get('text');
    try {
      execSync(`DISPLAY=:99 xdotool type "${text}"`);
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e.message }));
    }
  } else if (url.pathname === '/key') {
    const key = url.searchParams.get('key');
    try {
      execSync(`DISPLAY=:99 xdotool key ${key}`);
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e.message }));
    }
  } else {
    res.end(JSON.stringify({ endpoints: ['/screenshot', '/xdotool?cmd=', '/navigate?url=', '/click?x=&y=', '/type?text=', '/key?key='] }));
  }
});

server.listen(PORT, () => console.log(`API on ${PORT}`));
