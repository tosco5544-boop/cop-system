// 施設の追加（本部の管理者のみ）
import { json, fail, readBody, str, nowIso, audit } from '../../../lib/util.js';

export async function onRequestPost({ request, env, data }) {
  const b = await readBody(request);
  const name = str(b.name, 50);
  if (!name) return fail('施設名を入力してください');
  if (await env.DB.prepare('SELECT id FROM facilities WHERE name = ?').bind(name).first()) return fail('同じ名前の施設があります', 409);
  const max = await env.DB.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM facilities').first();
  const r = await env.DB.prepare('INSERT INTO facilities (name, company, sort_order, created_at) VALUES (?, ?, ?, ?)').bind(name, str(b.company, 30), max.m + 1, nowIso()).run();
  await audit(env, { actorId: data.user.id, action: 'facility.create', target: name, ip: data.ip });
  return json({ id: r.meta.last_row_id });
}
