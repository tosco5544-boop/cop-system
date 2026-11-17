// テスト・ローカル確認用：Node 内蔵 SQLite で D1 を模擬し、本番と同じ Worker の入口でリクエストを処理する
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
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

/* ---------- 本番と同じ入口（src/index.js）を使う ---------- */
const worker = (await import(pathToFileURL(join(ROOT, 'src/index.js')))).default;

export const env = { DB: new D1(), SETUP_TOKEN: 'test-token' };
env.DB.exec(readFileSync(join(ROOT, 'schema.sql'), 'utf8'));
env.DB.exec(readFileSync(join(ROOT, 'schema.sql'), 'utf8')); // 2回実行しても壊れないこと
// 画面確認用：UMW_IMPORT_DATA=1 のとき、延べ利用者数の過去データ（data/*.sql）も読み込む
if (process.env.UMW_IMPORT_DATA) {
  const { readdirSync } = await import('node:fs');
  for (const f of readdirSync(join(ROOT, 'data')).sort()) env.DB.exec(readFileSync(join(ROOT, 'data', f), 'utf8'));
}

export async function handle(request) {
  return worker.fetch(request, env, { waitUntil() {} });
}
