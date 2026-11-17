// 打刻処理（本人の打刻・施設の打刻端末の両方で使う）
// 種類：in(出勤) / out(退勤) / break(休憩時間を分で設定。minutes) / break_start・break_end(休憩の開始・終了。互換用)
import { jstDate, nowIso } from './util.js';
import { findCurrentDay, dayState } from './attendance.js';

const fail = (error, status = 400) => ({ error, status });

const LABEL = { in: '出勤', out: '退勤', break: '休憩時間', break_start: '休憩開始', break_end: '休憩終了' };
export const BREAK_OPTIONS = [0, 15, 30, 45, 60, 90];

/** 打刻を記録する。エラー時は { error, status }、成功時は { ok, message, day, state, server_time } */
export async function applyPunch(env, empId, b, ip) {
  const type = b.type;
  if (!LABEL[type]) return fail('打刻の種類が不正です');
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
  } else if (type === 'break') {
    const mins = Number(b.minutes);
    if (!BREAK_OPTIONS.includes(mins)) return fail('休憩時間が不正です');
    if (!cur || !cur.clock_in) return fail('出勤していません', 409);
    if (state === 'done' && cur.work_date !== jstDate(now)) return fail('前日以前の休憩時間は管理者に修正を依頼してください', 409);
    stmt = env.DB.prepare('UPDATE attendance_days SET break_minutes = ?, break_start = NULL, updated_at = ? WHERE id = ?').bind(mins, t, cur.id);
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

  // 打刻の生ログ（休憩時間の設定は打刻ではないので記録しない。既存DBの制約とも合わせるため）
  await env.DB.batch(type === 'break' ? [stmt] : [
    stmt,
    env.DB.prepare('INSERT INTO attendance_punches (employee_id, type, at, ip) VALUES (?, ?, ?, ?)').bind(empId, type, t, ip || null),
  ]);
  const day = await findCurrentDay(env, empId, now);
  const message = type === 'break' ? `休憩時間を${b.minutes ? b.minutes + '分' : 'なし'}にしました` : `${LABEL[type]}を記録しました`;
  return { ok: true, message, day, state: dayState(day), server_time: nowIso() };
}
