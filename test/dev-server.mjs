// 画面確認用のローカルサーバー（wrangler なしで動く簡易版。データはメモリ上のみ）
// 実行: node --experimental-sqlite test/dev-server.mjs  →  http://localhost:8788/setup.html （トークン: test-token）
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { handle, ROOT } from './harness.mjs';

const PORT = Number(process.env.PORT || 8788);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const headers = { ...req.headers, 'cf-connecting-ip': '127.0.0.1' };
      const r = await handle(new Request(`https://localhost:${PORT}${url.pathname}${url.search}`, {
        method: req.method, headers: { ...headers, origin: headers.origin ? `https://localhost:${PORT}` : undefined },
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
      }));
      const out = { 'Content-Type': r.headers.get('Content-Type') || 'application/json' };
      const sc = r.headers.getSetCookie();
      if (sc.length) out['Set-Cookie'] = sc.map((c) => c.replace('; Secure', '')); // http のため
      res.writeHead(r.status, out);
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    let p = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
    if (p.endsWith('/')) p += 'index.html';
    if (!extname(p)) p += '.html';
    const body = await readFile(join(ROOT, 'public', p));
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' });
    res.end(e.code === 'ENOENT' ? 'Not Found' : String(e.stack));
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}/setup.html  （セットアップトークン: test-token）`));
