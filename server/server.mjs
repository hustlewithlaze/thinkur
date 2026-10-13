// Production server: serves the built app from dist/ and the /api routes. Run `npm run build` first.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiStatus, handleApi } from './ai.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT ?? 4173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

createServer(async (req, res) => {
  if (await handleApi(req, res)) return;
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, path);
  try {
    if (!file.startsWith(root) || !(await stat(file)).isFile()) file = join(root, 'index.html');
  } catch {
    file = join(root, 'index.html');
  }
  try {
    const body = await readFile(file);
    res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(body);
  } catch {
    res.statusCode = 500;
    res.end('Build not found. Run `npm run build` first.');
  }
}).listen(port, () => {
  const ai = aiStatus();
  console.log(`Thinkur running at http://localhost:${port}  (AI: ${ai.configured ? ai.model : 'not configured — rule-based briefs'})`);
});
