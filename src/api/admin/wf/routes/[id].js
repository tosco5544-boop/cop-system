// 承認ルートの保存・削除
import { json, fail, readBody, nowIso, audit } from '../../../../../lib/util.js';
import { cleanRoute, validateRoute } from '../../../../../lib/workflow.js';

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function onRequestPut({ request, env, data, params }) {
  if (!ID.test(params.id)) return fail('IDが不正です');
  const r = cleanRoute(await readBody(request), params.id);
  const e = validateRoute(r);
  if (e) return fail(e);
  await env.DB
    .prepare(
      `INSERT INTO wf_routes (id, name, steps_json, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, steps_json = excluded.steps_json, updated_at = excluded.updated_at`,
    )
    .bind(r.id, r.name, JSON.stringify(r.steps), nowIso())
    .run();
  await audit(env, { actorId: data.user.id, action: 'wf.route_save', target: r.name, ip: data.ip });
  return json({ ok: true });
}

export async function onRequestDelete({ env, data, params }) {
  const row = await env.DB.prepare('SELECT name FROM wf_routes WHERE id = ?').bind(params.id).first();
  if (!row) return fail('ルートが見つかりません', 404);
  await env.DB.prepare('DELETE FROM wf_routes WHERE id = ?').bind(params.id).run();
  await audit(env, { actorId: data.user.id, action: 'wf.route_delete', target: row.name, ip: data.ip });
  return json({ ok: true });
}
