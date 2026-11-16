// 打刻：in(出勤) / break_start(休憩開始) / break_end(休憩終了) / out(退勤)
import { json, fail, readBody, jstDate, nowIso } from '../../../lib/util.js';
import { findCurrentDay, dayState } from '../../../lib/attendance.js';

const LABEL = { in: '出勤', out: '退勤', break_start: '休憩開始', break_end: '休憩終了' };

export async function onRequestPost({ request, env, data }) {
  const { type } = await readBody(request);
  if (!LABEL[type]) return fail('打刻の種類が不正です');
  const empId = data.user.id;
  const now = new Date();
  const t = now.toISOString();
  const cur = await findCurrentDay(env, empId, now);
  const state = dayState(cur);
  let stmt;

  if (type === 'in') {
    if (state === 'working' || state === 'break') return fail('すでに出勤中です', 409);
    const today = jstDate(now);
    const row = await env.DB.prepare('SELECT clock_in FROM attendance_days WHERE employee_id = ? AND work_date = ?').bind(empId, today).first();
    if (row && row.clock_in) return fail('本日はすでに出勤打刻済みです。修正が必要な場合は管理者に連絡してください。', 409);
    stmt = env.DB
      .prepare(
        `INSERT INTO attendance_days (employee_id, work_date, clock_in, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (employee_id, work_date) DO UPDATE SET clock_in = excluded.clock_in, updated_at = excluded.updated_at`,
      )
      .bind(empId, today, t, t);
  } else if (type === 'break_start') {
    if (state !== 'working') return fail(state === 'break' ? 'すでに休憩中です' : '出勤していません', 409);
    stmt = env.DB.prepare('UPDATE attendance_days SET break_start = ?, updated_at = ? WHERE id = ?').bind(t, t, cur.id);
  } else if (type === 'break_end') {
    if (state !== 'break') return fail('休憩中ではありません', 409);
    const mins = Math.max(0, Math.round((now - Date.parse(cur.break_start)) / 60000));
    stmt = env.DB
      .prepare('UPDATE attendance_days SET break_minutes = break_minutes + ?, break_start = NULL, updated_at = ? WHERE id = ?')
      .bind(mins, t, cur.id);
  } else {
    if (state !== 'working' && state !== 'break') return fail(state === 'done' ? 'すでに退勤済みです' : '出勤していません', 409);
    const mins = state === 'break' ? Math.max(0, Math.round((now - Date.parse(cur.break_start)) / 60000)) : 0;
    stmt = env.DB
      .prepare('UPDATE attendance_days SET clock_out = ?, break_minutes = break_minutes + ?, break_start = NULL, updated_at = ? WHERE id = ?')
      .bind(t, mins, t, cur.id);
  }

  await env.DB.batch([
    stmt,
    env.DB.prepare('INSERT INTO attendance_punches (employee_id, type, at, ip) VALUES (?, ?, ?, ?)').bind(empId, type, t, data.ip || null),
  ]);
  const day = await findCurrentDay(env, empId, now);
  return json({ ok: true, message: `${LABEL[type]}を記録しました`, day, state: dayState(day), server_time: nowIso() });
}
