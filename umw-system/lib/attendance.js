// 勤怠の共通処理
import { jstDate, addDays } from './util.js';

/** 退勤し忘れた古い勤務を「勤務中」とみなさないための上限（時間） */
export const OPEN_SHIFT_HOURS = 20;

export function dayState(d) {
  if (!d || !d.clock_in) return 'off';
  if (d.clock_out) return 'done';
  if (d.break_start) return 'break';
  return 'working';
}

export function workMinutes(d) {
  if (!d || !d.clock_in || !d.clock_out) return null;
  return Math.max(0, Math.round((Date.parse(d.clock_out) - Date.parse(d.clock_in)) / 60000) - (d.break_minutes || 0));
}

/** 現在の勤務（日付をまたぐ夜勤にも対応）。なければ今日の行 */
export async function findCurrentDay(env, employeeId, now = new Date()) {
  const today = jstDate(now);
  const limit = new Date(now.getTime() - OPEN_SHIFT_HOURS * 3600 * 1000).toISOString();
  const open = await env.DB
    .prepare(
      `SELECT * FROM attendance_days
        WHERE employee_id = ? AND clock_in IS NOT NULL AND clock_out IS NULL
          AND work_date >= ? AND clock_in > ?
        ORDER BY work_date DESC LIMIT 1`,
    )
    .bind(employeeId, addDays(today, -1), limit)
    .first();
  if (open) return open;
  return await env.DB.prepare('SELECT * FROM attendance_days WHERE employee_id = ? AND work_date = ?').bind(employeeId, today).first();
}

export function monthRange(ym) {
  return [`${ym}-01`, `${ym}-31`];
}
