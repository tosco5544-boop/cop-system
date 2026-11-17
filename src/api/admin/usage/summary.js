// 延べ利用者数：全施設の月次平均と曜日別平均
import { json, fail } from '../../../../lib/util.js';
import { isMonth, weekdayOf, newAgg, addRow, finish } from '../../../../lib/usage.js';

export async function onRequestGet({ request, env }) {
  const month = new URL(request.url).searchParams.get('month');
  if (!isMonth(month)) return fail('月を指定してください');
  const [fac, rec] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM ua_facilities ORDER BY sort_order, id'),
    env.DB.prepare('SELECT * FROM ua_daily_records WHERE date BETWEEN ? AND ?').bind(month + '-01', month + '-31'),
  ]);
  const summary = fac.results.map((f) => {
    const total = newAgg();
    const wd = { 1: newAgg(), 2: newAgg(), 3: newAgg(), 4: newAgg(), 5: newAgg(), 6: newAgg() };
    for (const r of rec.results) {
      if (r.facility_id !== f.id) continue;
      addRow(total, r);
      const w = weekdayOf(r.date);
      if (wd[w]) addRow(wd[w], r);
    }
    const weekdays = {};
    for (const k of Object.keys(wd)) weekdays[k] = finish(wd[k], f);
    return { facility: f, total: finish(total, f), weekdays };
  });
  return json({ summary });
}
