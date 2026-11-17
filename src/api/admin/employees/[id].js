// PUT: 社員情報の更新 / POST: 操作（reset_password: 仮パスワード発行, logout: 強制ログアウト）
import { json, fail, readBody, str, intOr, nowIso, audit, isEmployeeCode } from '../../../../lib/util.js';
import { hashPassword, tempPassword } from '../../../../lib/crypto.js';
import { destroyAllSessions } from '../../../../lib/session.js';
import { EMP_COLUMNS, clerkStmt } from '../employees.js';

async function load(env, id) {
  return await env.DB.prepare(`SELECT ${EMP_COLUMNS} FROM employees WHERE id = ?`).bind(id).first();
}

export async function onRequestPut({ request, env, data, params }) {
  const id = intOr(params.id);
  const emp = id && (await load(env, id));
  if (!emp) return fail('社員が見つかりません', 404);
  const b = await readBody(request);
  const next = {
    employee_code: b.employee_code === undefined ? emp.employee_code : str(b.employee_code, 32),
    name: b.name === undefined ? emp.name : str(b.name, 50),
    dept: b.dept === undefined ? emp.dept : str(b.dept, 50),
    title: b.title === undefined ? emp.title : str(b.title, 50),
    role: b.role === undefined ? emp.role : b.role === 'admin' ? 'admin' : 'staff',
    is_clerk: b.role === undefined ? emp.is_clerk : b.role === 'clerk' ? 1 : 0,
    active: b.active === undefined ? emp.active : b.active ? 1 : 0,
  };
  if (!isEmployeeCode(next.employee_code)) return fail('社員IDは半角英数字・ハイフン・アンダースコア（32文字以内）で入力してください');
  if (!next.name) return fail('氏名を入力してください');
  if (id === data.user.id && (next.role !== 'admin' || !next.active)) {
    return fail('自分自身の管理者権限の解除・無効化はできません（他の管理者に依頼してください）');
  }
  if (next.employee_code !== emp.employee_code) {
    const dup = await env.DB.prepare('SELECT id FROM employees WHERE employee_code = ? AND id <> ?').bind(next.employee_code, id).first();
    if (dup) return fail('この社員IDはすでに使われています', 409);
  }
  await env.DB
    .prepare('UPDATE employees SET employee_code = ?, name = ?, dept = ?, title = ?, role = ?, active = ?, updated_at = ? WHERE id = ?')
    .bind(next.employee_code, next.name, next.dept, next.title, next.role, next.active, nowIso(), id)
    .run();
  if (next.is_clerk !== emp.is_clerk) await clerkStmt(env, id, !!next.is_clerk).run();
  // 権限が下がった・無効化された場合は即ログアウト
  if ((emp.role === 'admin' && next.role !== 'admin') || (emp.is_clerk && !next.is_clerk) || (emp.active && !next.active)) await destroyAllSessions(env, id);

  const changed = {};
  for (const k of Object.keys(next)) if (next[k] !== emp[k]) changed[k] = { before: emp[k], after: next[k] };
  if (Object.keys(changed).length) {
    await audit(env, { actorId: data.user.id, action: 'employee.update', target: next.employee_code, detail: changed, ip: data.ip });
  }
  return json({ ok: true });
}

export async function onRequestPost({ request, env, data, params }) {
  const id = intOr(params.id);
  const emp = id && (await load(env, id));
  if (!emp) return fail('社員が見つかりません', 404);
  const { action } = await readBody(request);
  if (action === 'reset_password') {
    const pw = tempPassword();
    await env.DB
      .prepare('UPDATE employees SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?')
      .bind(await hashPassword(pw), nowIso(), id)
      .run();
    await destroyAllSessions(env, id);
    // ロック解除のため、成功扱いの記録を入れる
    await env.DB.prepare('INSERT INTO login_attempts (employee_code, ip, success, at) VALUES (?, ?, 1, ?)').bind(emp.employee_code, 'reset', nowIso()).run();
    await audit(env, { actorId: data.user.id, action: 'employee.reset_password', target: emp.employee_code, ip: data.ip });
    return json({ temp_password: pw });
  }
  if (action === 'logout') {
    await destroyAllSessions(env, id);
    await audit(env, { actorId: data.user.id, action: 'employee.force_logout', target: emp.employee_code, ip: data.ip });
    return json({ ok: true });
  }
  return fail('操作が不正です');
}
