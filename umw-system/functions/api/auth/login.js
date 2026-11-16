// ログイン（職員用・管理者用の入口共通。portal で区別）
import { json, fail, readBody, str, nowIso, audit } from '../../../lib/util.js';
import { verifyPassword, DUMMY_HASH } from '../../../lib/crypto.js';
import { createSession, destroySession } from '../../../lib/session.js';

const WINDOW_MIN = 15;     // この時間内の失敗回数を数える
const MAX_FAIL = 5;        // 社員IDごとの上限
const MAX_FAIL_IP = 30;    // IPアドレスごとの上限

export async function onRequestPost({ request, env, data }) {
  const b = await readBody(request);
  const code = str(b.employee_code, 32);
  const password = typeof b.password === 'string' ? b.password.slice(0, 128) : '';
  const portal = b.portal === 'admin' ? 'admin' : 'staff';
  if (!code || !password) return fail('社員IDとパスワードを入力してください');

  const since = new Date(Date.now() - WINDOW_MIN * 60000).toISOString();
  const fails = await env.DB
    .prepare(
      `SELECT COUNT(*) AS n FROM login_attempts
        WHERE employee_code = ? AND success = 0 AND at > ?
          AND at > COALESCE((SELECT MAX(at) FROM login_attempts WHERE employee_code = ? AND success = 1), '')`,
    )
    .bind(code, since, code)
    .first();
  const ipFails = data.ip
    ? await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND success = 0 AND at > ?').bind(data.ip, since).first()
    : { n: 0 };
  if (fails.n >= MAX_FAIL || ipFails.n >= MAX_FAIL_IP) {
    return fail(`ログインに続けて失敗したため、一時的にロックしています。${WINDOW_MIN}分ほど待ってから再度お試しください。`, 429);
  }

  const emp = await env.DB.prepare('SELECT * FROM employees WHERE employee_code = ?').bind(code).first();
  const passOk = await verifyPassword(password, emp ? emp.password_hash : DUMMY_HASH);
  const record = (success) =>
    env.DB.prepare('INSERT INTO login_attempts (employee_code, ip, success, at) VALUES (?, ?, ?, ?)')
      .bind(code, data.ip || null, success ? 1 : 0, nowIso())
      .run();

  if (!emp || !passOk || emp.active !== 1) {
    await record(false);
    return fail('社員IDまたはパスワードが正しくありません', 401);
  }
  if (portal === 'admin' && emp.role !== 'admin') {
    await record(false);
    await audit(env, { actorId: emp.id, action: 'auth.admin_denied', ip: data.ip });
    return fail('このアカウントには管理者権限がありません。職員用のログイン画面をご利用ください。', 403);
  }

  await record(true);
  await destroySession(env, request);
  const cookie = await createSession(env, emp.id, portal, request);
  await audit(env, { actorId: emp.id, action: portal === 'admin' ? 'auth.login_admin' : 'auth.login', ip: data.ip });

  // ときどき古いデータを掃除
  if (Math.random() < 0.05) {
    const old = new Date(Date.now() - 90 * 86400000).toISOString();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(nowIso()),
      env.DB.prepare('DELETE FROM login_attempts WHERE at < ?').bind(old),
    ]);
  }

  return json({ ok: true, scope: portal, must_change_password: emp.must_change_password === 1 }, 200, { 'Set-Cookie': cookie });
}
