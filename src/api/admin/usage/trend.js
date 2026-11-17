// 延べ利用者数：1施設の月別推移
import { json, fail, intOr } from '../../../../lib/util.js';
import { newAgg, addRow, finish } from '../../../../lib/usage.js';

export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  const year = q.get('year');
  const fid = intOr(q.get('facility_id'));
  if (!/^\d{4}$/.test(year || '')) return fail('年を指定してください');
  const f = fid && (await env.DB.prepare('SELECT * FROM ua_facilities WHERE id = ?').bind(fid).first());
  if (!f) return fail('施設が見つかりません');
  const { results } = await env.DB
    .prepare('SELECT * FROM ua_daily_records WHERE facility_id = ? AND date BETWEEN ? AND ?')
    .bind(fid, year + '-01-01', year + '-12-31')
    .all();
  const months = Array.from({ length: 12 }, newAgg);
  for (const r of results) addRow(months[Number(r.date.slice(5, 7)) - 1], r);
  return json({ trend: months.map((a, i) => ({ month: i + 1, ...finish(a, f) })) });
}
