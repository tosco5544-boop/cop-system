// 施設の打刻端末（ログイン不要）の認証
// 管理者が端末を登録すると、その端末にだけ長期間有効な Cookie（kid）を保存する。
import { randomToken, sha256hex } from './crypto.js';
import { nowIso } from './util.js';

const COOKIE = 'kid';
const MAX_AGE = 400 * 86400; // ブラウザが許す最長（約400日）。期限が近づくと自動で延長する

export const kioskCookie = (token, maxAge = MAX_AGE) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

function readKioskToken(request) {
  const c = request.headers.get('Cookie') || '';
  const m = c.match(/(?:^|;\s*)kid=([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : null;
}

export async function createKiosk(env, facilityId, name, createdBy) {
  const token = randomToken();
  await env.DB
    .prepare('INSERT INTO kiosks (token_hash, facility_id, name, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256hex(token), facilityId, name, createdBy, nowIso())
    .run();
  return kioskCookie(token);
}

export async function getKiosk(env, request) {
  const token = readKioskToken(request);
  if (!token) return null;
  const row = await env.DB
    .prepare(
      `SELECT k.id, k.name, k.last_seen_at, f.id AS facility_id, f.name AS facility_name, f.company AS company
         FROM kiosks k JOIN facilities f ON f.id = k.facility_id
        WHERE k.token_hash = ? AND k.revoked = 0 AND f.active = 1`,
    )
    .bind(await sha256hex(token))
    .first();
  if (!row) return null;
  // 最終利用日時は10分おきに更新（書き込みを減らすため）
  if (!row.last_seen_at || Date.now() - Date.parse(row.last_seen_at) > 10 * 60000) {
    await env.DB.prepare('UPDATE kiosks SET last_seen_at = ? WHERE id = ?').bind(nowIso(), row.id).run();
  }
  return { id: row.id, name: row.name, facilityId: row.facility_id, facilityName: row.facility_name, company: row.company || '', token };
}
