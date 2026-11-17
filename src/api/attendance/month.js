// 自分の月別勤怠
import { json, fail, isYm, jstDate } from '../../../lib/util.js';
import { monthRange } from '../../../lib/attendance.js';

export async function onRequestGet({ request, env, data }) {
  const ym = new URL(request.url).searchParams.get('ym') || jstDate().slice(0, 7);
  if (!isYm(ym)) return fail('年月の形式が不正です');
  const [from, to] = monthRange(ym);
  const { results } = await env.DB
    .prepare('SELECT * FROM attendance_days WHERE employee_id = ? AND work_date BETWEEN ? AND ? ORDER BY work_date')
    .bind(data.user.id, from, to)
    .all();
  return json({ ym, days: results });
}
