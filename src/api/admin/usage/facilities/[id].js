// 延べ利用者数：施設名・定員・区分の設定（本部のみ）
import { json, fail, readBody, intOr, audit } from '../../../../../lib/util.js';

export async function onRequestPut({ request, env, data, params }) {
  if (!data.access.hq) return fail('本部の管理者のみ設定できます', 403);
  const id = intOr(params.id);
  const f = id && (await env.DB.prepare('SELECT * FROM ua_facilities WHERE id = ?').bind(id).first());
  if (!f) return fail('施設が見つかりません', 404);
  const b = await readBody(request);
  const name = String(b.name || '').trim();
  if (!name || name.length > 50) return fail('施設名を入力してください（50文字以内）');
  const cap = (v) => (Number.isInteger(v) && v >= 0 && v <= 999 ? v : null);
  if (cap(b.cap_3h) === null || cap(b.cap_7h) === null) return fail('定員は0〜999の整数で入力してください');
  await env.DB
    .prepare('UPDATE ua_facilities SET name = ?, cap_3h = ?, cap_7h = ?, use_am = ?, use_pm = ?, use_7h = ? WHERE id = ?')
    .bind(name, b.cap_3h, b.cap_7h, b.use_am ? 1 : 0, b.use_pm ? 1 : 0, b.use_7h ? 1 : 0, id)
    .run();
  await audit(env, { actorId: data.user.id, action: 'usage.facility_update', target: name, detail: { cap_3h: b.cap_3h, cap_7h: b.cap_7h }, ip: data.ip });
  return json({ ok: true });
}
