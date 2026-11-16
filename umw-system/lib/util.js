// 共通ユーティリティ（サーバー側）

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export const fail = (message, status = 400, extra = {}) => json({ error: message, ...extra }, status);

export const nowIso = () => new Date().toISOString();

/** 日本時間の日付 YYYY-MM-DD */
export function jstDate(d = new Date()) {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function readBody(request) {
  try {
    const b = await request.json();
    return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
  } catch {
    return {};
  }
}

export const clientIp = (request) => request.headers.get('CF-Connecting-IP') || '';

export function str(v, max = 200) {
  return String(v ?? '').trim().slice(0, max);
}

export function intOr(v, def = null) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

export const isYm = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s || '');
export const isDate = (s) => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s || '');
export const isEmployeeCode = (s) => /^[A-Za-z0-9_-]{1,32}$/.test(s || '');

export function auditStmt(env, { actorId = null, action, target = null, detail = null, ip = null }) {
  const d = detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 4000);
  return env.DB
    .prepare('INSERT INTO audit_logs (at, actor_id, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(nowIso(), actorId, action, target, d, ip || null);
}

export async function audit(env, entry) {
  await auditStmt(env, entry).run();
}

export function safeJson(s, def) {
  try {
    return JSON.parse(s);
  } catch {
    return def;
  }
}
