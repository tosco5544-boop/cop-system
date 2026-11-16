// 社員一覧・登録（管理者）
import { json, fail, readBody, str, nowIso, audit, isEmployeeCode } from '../../../lib/util.js';
import { hashPassword, tempPassword, passwordProblem } from '../../../lib/crypto.js';

export const EMP_COLUMNS = 'id, employee_code, name, dept, title, role, must_change_password, active, created_at, updated_at';

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`SELECT ${EMP_COLUMNS} FROM employees ORDER BY active DESC, employee_code`).all();
  const last = (
    await env.DB.prepare("SELECT actor_id, MAX(at) AS at FROM audit_logs WHERE action IN ('auth.login','auth.login_admin') GROUP BY actor_id").all()
  ).results;
  const lastMap = new Map(last.map((r) => [r.actor_id, r.at]));
  return json({ employees: results.map((e) => ({ ...e, last_login_at: lastMap.get(e.id) || null })) });
}

export async function onRequestPost({ request, env, data }) {
  const b = await readBody(request);
  const code = str(b.employee_code, 32);
  const name = str(b.name, 50);
  if (!isEmployeeCode(code)) return fail('社員IDは半角英数字・ハイフン・アンダースコア（32文字以内）で入力してください');
  if (!name) return fail('氏名を入力してください');
  const role = b.role === 'admin' ? 'admin' : 'staff';
  if (await env.DB.prepare('SELECT id FROM employees WHERE employee_code = ?').bind(code).first()) {
    return fail('この社員IDはすでに使われています', 409);
  }
  let password = b.password ? String(b.password) : '';
  let generated = false;
  if (password) {
    const p = passwordProblem(password);
    if (p) return fail(p);
  } else {
    password = tempPassword();
    generated = true;
  }
  const t = nowIso();
  const r = await env.DB
    .prepare(
      `INSERT INTO employees (employee_code, name, dept, title, role, password_hash, must_change_password, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
    )
    .bind(code, name, str(b.dept, 50), str(b.title, 50), role, await hashPassword(password), t, t)
    .run();
  await audit(env, { actorId: data.user.id, action: 'employee.create', target: code, detail: { name, role }, ip: data.ip });
  return json({ id: r.meta.last_row_id, temp_password: generated ? password : null });
}
