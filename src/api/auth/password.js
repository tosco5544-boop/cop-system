// 自分のパスワード変更
import { json, fail, readBody, nowIso, audit } from '../../../lib/util.js';
import { hashPassword, verifyPassword, passwordProblem } from '../../../lib/crypto.js';
import { destroyAllSessions } from '../../../lib/session.js';

export async function onRequestPost({ request, env, data }) {
  const b = await readBody(request);
  const emp = await env.DB.prepare('SELECT password_hash FROM employees WHERE id = ?').bind(data.user.id).first();
  if (!emp || !(await verifyPassword(String(b.current || ''), emp.password_hash))) return fail('現在のパスワードが正しくありません');
  const p = passwordProblem(b.new_password);
  if (p) return fail(p);
  if (b.new_password === b.current) return fail('現在と異なるパスワードを設定してください');

  await env.DB
    .prepare('UPDATE employees SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?')
    .bind(await hashPassword(b.new_password), nowIso(), data.user.id)
    .run();
  await destroyAllSessions(env, data.user.id, data.session.tokenHash); // 他の端末はログアウト
  await audit(env, { actorId: data.user.id, action: 'auth.password_changed', ip: data.ip });
  return json({ ok: true, scope: data.scope });
}
