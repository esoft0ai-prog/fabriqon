// Minimal dependency-free static server for local development and testing.
// Usage: node tools/serve.mjs [port]   (default 5173; PORT env also works)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || process.env.PORT || 5173);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};
const BLOCKED = /^(\/(node_modules|tests|tools|server|\.git)(\/|$))/;

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (BLOCKED.test(path)) { res.writeHead(404).end('Not found'); return; }
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root + sep) && file !== root) { res.writeHead(403).end('Forbidden'); return; }
    const s = await stat(file).catch(() => null);
    if (!s || !s.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    const body = await readFile(file);
    const headers = {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': file.endsWith('service-worker.js') || file.endsWith('.html') || file.endsWith('manifest.json') ? 'no-cache' : 'public, max-age=0, must-revalidate',
    };
    if (file.endsWith('service-worker.js')) headers['Service-Worker-Allowed'] = '/';
    res.writeHead(200, headers).end(body);
  } catch (err) {
    res.writeHead(500).end('Server error');
    console.error(err);
  }
}).listen(port, () => console.log(`Fabriqon running at http://localhost:${port}`));
