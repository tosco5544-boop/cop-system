// 初期設定：社員が1人もいないときだけ、最初の管理者を作成できる
// 環境変数（シークレット）SETUP_TOKEN と一致するトークンが必要
import { json, fail, readBody, str, nowIso, audit, isEmployeeCode } from '../../lib/util.js';
import { hashPassword, passwordProblem, timingSafeEqualStr } from '../../lib/crypto.js';

async function employeeCount(env) {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM employees').first();
  return r.n;
}

export async function onRequestGet({ env }) {
  return json({ needed: (await employeeCount(env)) === 0, token_configured: !!env.SETUP_TOKEN });
}

export async function onRequestPost({ request, env, data }) {
  if (!env.SETUP_TOKEN) return fail('環境変数 SETUP_TOKEN が設定されていません', 403);
  if ((await employeeCount(env)) > 0) return fail('初期設定はすでに完了しています', 403);
  const b = await readBody(request);
  if (!timingSafeEqualStr(str(b.token, 200), env.SETUP_TOKEN)) return fail('セットアップトークンが違います', 403);

  const code = str(b.employee_code, 32);
  const name = str(b.name, 50);
  if (!isEmployeeCode(code)) return fail('社員IDは半角英数字・ハイフン・アンダースコア（32文字以内）で入力してください');
  if (!name) return fail('氏名を入力してください');
  const p = passwordProblem(b.password);
  if (p) return fail(p);

  const t = nowIso();
  const r = await env.DB
    .prepare(
      `INSERT INTO employees (employee_code, name, dept, title, role, password_hash, must_change_password, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'admin', ?, 0, 1, ?, ?)`,
    )
    .bind(code, name, str(b.dept, 50), str(b.title, 50), await hashPassword(b.password), t, t)
    .run();
  await audit(env, { actorId: r.meta.last_row_id, action: 'setup.admin_created', target: code, ip: data.ip });
  return json({ ok: true });
}
