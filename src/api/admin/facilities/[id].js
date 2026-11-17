// 施設名の変更・休止（名前を変えると、所属する社員の「部署」もまとめて変わる）
import { json, fail, readBody, str, intOr, nowIso, audit } from '../../../../lib/util.js';

export async function onRequestPut({ request, env, data, params }) {
  const id = intOr(params.id);
  const f = id && (await env.DB.prepare('SELECT * FROM facilities WHERE id = ?').bind(id).first());
  if (!f) return fail('施設が見つかりません', 404);
  const b = await readBody(request);
  const name = b.name === undefined ? f.name : str(b.name, 50);
  const active = b.active === undefined ? f.active : b.active ? 1 : 0;
  const company = b.company === undefined ? f.company : str(b.company, 30);
  const sort = b.sort_order === undefined ? f.sort_order : intOr(b.sort_order, f.sort_order);
  if (!name) return fail('施設名を入力してください');
  if (name !== f.name && (await env.DB.prepare('SELECT id FROM facilities WHERE name = ? AND id <> ?').bind(name, id).first())) {
    return fail('同じ名前の施設があります', 409);
  }
  const stmts = [env.DB.prepare('UPDATE facilities SET name = ?, company = ?, active = ?, sort_order = ? WHERE id = ?').bind(name, company, active, sort, id)];
  if (name !== f.name) stmts.push(env.DB.prepare('UPDATE employees SET dept = ?, updated_at = ? WHERE dept = ?').bind(name, nowIso(), f.name));
  await env.DB.batch(stmts);
  await audit(env, { actorId: data.user.id, action: 'facility.update', target: name, detail: { before: { name: f.name, company: f.company, active: f.active }, after: { name, company, active } }, ip: data.ip });
  return json({ ok: true });
}
