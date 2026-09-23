// Local preview server for dist/ (npm run serve). Not used in production.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { p } from './lib/util.mjs';

const DIST = p('dist');
const PORT = Number(process.env.PORT || 4321);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.txt': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    let file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST)) return res.writeHead(403).end();
    let st = await stat(file).catch(() => null);
    if (st?.isDirectory()) {
      file = path.join(file, 'index.html');
      st = await stat(file).catch(() => null);
    }
    if (!st) {
      const notFound = await readFile(path.join(DIST, '404.html')).catch(() => 'Not found');
      return res.writeHead(404, { 'Content-Type': TYPES['.html'] }).end(notFound);
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
}).listen(PORT, () => console.log(`serving dist/ at http://localhost:${PORT}`));
