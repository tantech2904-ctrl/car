/**
 * Lightweight Zero-Dependency Static File Server for JARVIS Cockpit
 * Compatible with Node.js v14+ (Built-in http, fs, path, url)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const BASE_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js':   'application/javascript; charset=UTF-8',
  '.mjs':  'application/javascript; charset=UTF-8',
  '.css':  'text/css; charset=UTF-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.glb':  'model/gltf-binary',
  '.gltf': 'model/gltf+json'
};

const server = http.createServer((req, res) => {
  // CORS & Private Network Access headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Check for ESP32 reverse proxy endpoints
  const urlParts = req.url.split('?');
  const reqPath = decodeURI(urlParts[0]);
  const queryString = urlParts[1] ? `?${urlParts[1]}` : '';

  if (reqPath === '/status' || reqPath.startsWith('/cmd') || reqPath.startsWith('/alert') || reqPath.startsWith('/api/esp32')) {
    let targetPath = reqPath;
    if (targetPath.startsWith('/api/esp32')) {
      targetPath = targetPath.replace('/api/esp32', '');
    }
    const targetUrl = `http://192.168.4.1${targetPath}${queryString}`;

    const proxyReq = http.request(targetUrl, {
      method: req.method,
      headers: { ...req.headers, host: '192.168.4.1' },
      timeout: 800
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        ...proxyRes.headers,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Private-Network': 'true',
        'Cache-Control': 'no-cache, no-store'
      });
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'ESP32 unreachable at 192.168.4.1', online: false }));
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Timeout connecting to ESP32 at 192.168.4.1', online: false }));
    });

    req.pipe(proxyReq);
    return;
  }

  // Normalize static file path
  let filePathStr = reqPath;
  if (filePathStr === '/' || filePathStr === '') filePathStr = '/index.html';

  const filePath = path.join(BASE_DIR, filePathStr);

  // Security: prevent directory traversal
  if (!filePath.startsWith(BASE_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(` JARVIS AUTONOMOUS VEHICLE COCKPIT SERVER ONLINE       `);
  console.log(` Local URL: http://localhost:${PORT}                  `);
  console.log(`======================================================\n`);
});

