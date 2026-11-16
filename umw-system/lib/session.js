// セッション管理（HttpOnly Cookie + D1）
import { randomToken, sha256hex } from './crypto.js';
import { clientIp } from './util.js';

const COOKIE = 'sid';
// セッションの有効時間（秒）。管理者は短めにする
export const SESSION_TTL = { staff: 12 * 3600, admin: 8 * 3600 };

export function sessionCookie(token, maxAge) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
export const clearCookie = () => sessionCookie('', 0);

export function readToken(request) {
  const c = request.headers.get('Cookie') || '';
  const m = c.match(/(?:^|;\s*)sid=([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : null;
}

export async function createSession(env, employeeId, scope, request) {
  const token = randomToken();
  const now = new Date();
  const ttl = SESSION_TTL[scope];
  await env.DB
    .prepare('INSERT INTO sessions (token_hash, employee_id, scope, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(
      await sha256hex(token),
      employeeId,
      scope,
      now.toISOString(),
      new Date(now.getTime() + ttl * 1000).toISOString(),
      clientIp(request) || null,
      (request.headers.get('User-Agent') || '').slice(0, 200),
    )
    .run();
  return sessionCookie(token, ttl);
}

export async function getSession(env, request) {
  const token = readToken(request);
  if (!token) return null;
  const tokenHash = await sha256hex(token);
  const row = await env.DB
    .prepare(
      `SELECT s.scope, s.expires_at, e.id, e.employee_code, e.name, e.dept, e.title, e.role,
              e.must_change_password, e.active
         FROM sessions s JOIN employees e ON e.id = s.employee_id
        WHERE s.token_hash = ?`,
    )
    .bind(tokenHash)
    .first();
  if (!row || row.expires_at <= new Date().toISOString() || row.active !== 1) return null;
  return {
    tokenHash,
    scope: row.scope,
    expiresAt: row.expires_at,
    user: {
      id: row.id,
      employee_code: row.employee_code,
      name: row.name,
      dept: row.dept,
      title: row.title,
      role: row.role,
      must_change_password: row.must_change_password === 1,
    },
  };
}

export async function destroySession(env, request) {
  const token = readToken(request);
  if (!token) return;
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256hex(token)).run();
}

export async function destroyAllSessions(env, employeeId, exceptTokenHash = null) {
  if (exceptTokenHash) {
    await env.DB.prepare('DELETE FROM sessions WHERE employee_id = ? AND token_hash <> ?').bind(employeeId, exceptTokenHash).run();
  } else {
    await env.DB.prepare('DELETE FROM sessions WHERE employee_id = ?').bind(employeeId).run();
  }
}
