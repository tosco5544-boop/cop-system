// テスト・ローカル確認用：Node 内蔵 SQLite で D1 を模擬し、Pages Functions のルーティングを再現する
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- D1 互換シム ---------- */
class Stmt {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...a) {
    for (const v of a) if (v === undefined || typeof v === 'boolean' || (typeof v === 'object' && v !== null)) throw new Error(`D1 に渡せない値: ${v} in ${this.sql}`);
    this.args = a; return this;
  }
  async first() { return this.db.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args) }; }
  async run() { const r = this.db.prepare(this.sql).run(...this.args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; }
}
class D1 {
  constructor() { this.db = new DatabaseSync(':memory:'); this.db.exec('PRAGMA foreign_keys = ON'); }
  prepare(sql) { return new Stmt(this.db, sql); }
  async batch(stmts) {
    this.db.exec('BEGIN');
    try {
      const out = [];
      for (const s of stmts) out.push(/^\s*(SELECT|WITH)/i.test(s.sql) ? await s.all() : await s.run());
      this.db.exec('COMMIT');
      return out;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  exec(sql) { this.db.exec(sql); }
}

/* ---------- Pages Functions 互換ルーター ---------- */
function walk(dir) { return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; }); }
const fnDir = join(ROOT, 'functions');
const routes = [];
for (const file of walk(fnDir)) {
  const rel = relative(fnDir, file).replace(/\\/g, '/').replace(/\.js$/, '');
  if (rel.endsWith('_middleware')) continue;
  const names = [];
  const re = new RegExp('^/' + rel.split('/').map((seg) => { const m = seg.match(/^\[(\w+)\]$/); if (m) { names.push(m[1]); return '([^/]+)'; } return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('/') + '$');
  routes.push({ re, names, mod: await import(pathToFileURL(file)), dynamic: names.length });
}
routes.sort((a, b) => a.dynamic - b.dynamic); // 静的ルート優先
const middleware = await import(pathToFileURL(join(fnDir, 'api/_middleware.js')));

export const env = { DB: new D1(), SETUP_TOKEN: 'test-token' };
env.DB.exec(readFileSync(join(ROOT, 'schema.sql'), 'utf8'));
env.DB.exec(readFileSync(join(ROOT, 'schema.sql'), 'utf8')); // 2回実行しても壊れないこと

export async function handle(request) {
  const url = new URL(request.url);
  for (const r of routes) {
    const m = url.pathname.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    const h = r.mod['onRequest' + request.method[0] + request.method.slice(1).toLowerCase()] || r.mod.onRequest;
    const data = {};
    const ctx = { request, env, params, data, next: async () => (h ? h({ request, env, params, data }) : new Response('Method Not Allowed', { status: 405 })) };
    return middleware.onRequest(ctx);
  }
  return new Response('Not Found', { status: 404 });
}

