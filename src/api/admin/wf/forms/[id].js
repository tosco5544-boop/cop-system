// 申請書式の保存・削除
import { json, fail, readBody, nowIso, audit } from '../../../../../lib/util.js';
import { cleanForm, validateForm } from '../../../../../lib/workflow.js';

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function onRequestPut({ request, env, data, params }) {
  if (!ID.test(params.id)) return fail('IDが不正です');
  const f = cleanForm(await readBody(request), params.id);
  const e = validateForm(f);
  if (e) return fail(e);
  if (f.routeId && !(await env.DB.prepare('SELECT id FROM wf_routes WHERE id = ?').bind(f.routeId).first())) return fail('承認ルートが見つかりません');
  await env.DB
    .prepare(
      `INSERT INTO wf_forms (id, name, description, route_id, active, sort_order, fields_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, description = excluded.description, route_id = excluded.route_id,
         active = excluded.active, sort_order = excluded.sort_order, fields_json = excluded.fields_json, updated_at = excluded.updated_at`,
    )
    .bind(f.id, f.name, f.description, f.routeId || null, f.active ? 1 : 0, f.order, JSON.stringify(f.fields), nowIso())
    .run();
  await audit(env, { actorId: data.user.id, action: 'wf.form_save', target: f.name, ip: data.ip });
  return json({ ok: true });
}

export async function onRequestDelete({ env, data, params }) {
  const row = await env.DB.prepare('SELECT name FROM wf_forms WHERE id = ?').bind(params.id).first();
  if (!row) return fail('書式が見つかりません', 404);
  await env.DB.prepare('DELETE FROM wf_forms WHERE id = ?').bind(params.id).run();
  await audit(env, { actorId: data.user.id, action: 'wf.form_delete', target: row.name, ip: data.ip });
  return json({ ok: true });
}
