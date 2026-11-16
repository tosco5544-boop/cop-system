// 勤怠管理（管理者）
// GET ?ym=YYYY-MM[&employee_id=]  … 月の勤怠（全員分 or 1人分）
// PUT { employee_id, work_date, clock_in:'HH:MM', clock_out:'HH:MM', break_minutes, note } … 修正（空なら削除）
import { json, fail, readBody, str, intOr, isYm, isDate, jstDate, nowIso, audit, addDays } from '../../../../lib/util.js';
import { monthRange } from '../../../../lib/attendance.js';

export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  const ym = q.get('ym') || jstDate().slice(0, 7);
  if (!isYm(ym)) return fail('年月の形式が不正です');
  const [from, to] = monthRange(ym);
  const empId = intOr(q.get('employee_id'));
  const days = empId
    ? (await env.DB.prepare('SELECT * FROM attendance_days WHERE employee_id = ? AND work_date BETWEEN ? AND ? ORDER BY work_date').bind(empId, from, to).all()).results
    : (await env.DB.prepare('SELECT * FROM attendance_days WHERE work_date BETWEEN ? AND ? ORDER BY employee_id, work_date').bind(from, to).all()).results;
  const employees = (
    await env.DB
      .prepare(
        `SELECT id, employee_code, name, dept, title, active FROM employees
          WHERE active = 1 OR id IN (SELECT employee_id FROM attendance_days WHERE work_date BETWEEN ? AND ?)
          ORDER BY employee_code`,
      )
      .bind(from, to)
      .all()
  ).results;
  return json({ ym, employees, days, today: jstDate() });
}

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const toIso = (date, hm) => new Date(`${date}T${hm}:00+09:00`).toISOString();

export async function onRequestPut({ request, env, data }) {
  const b = await readBody(request);
  const empId = intOr(b.employee_id);
  const wd = str(b.work_date, 10);
  if (!empId || !isDate(wd)) return fail('社員または日付が不正です');
  const emp = await env.DB.prepare('SELECT id, employee_code, name FROM employees WHERE id = ?').bind(empId).first();
  if (!emp) return fail('社員が見つかりません', 404);

  const inHm = str(b.clock_in, 5);
  const outHm = str(b.clock_out, 5);
  if ((inHm && !HM.test(inHm)) || (outHm && !HM.test(outHm))) return fail('時刻は HH:MM の形式で入力してください');
  if (outHm && !inHm) return fail('退勤だけを登録することはできません。出勤時刻も入力してください');
  const clockIn = inHm ? toIso(wd, inHm) : null;
  let clockOut = outHm ? toIso(wd, outHm) : null;
  if (clockIn && clockOut && clockOut <= clockIn) clockOut = toIso(addDays(wd, 1), outHm); // 日付をまたぐ勤務
  const breakMin = Math.min(1440, Math.max(0, intOr(b.break_minutes, 0)));
  const note = str(b.note, 200);
  const reason = str(b.reason, 200);

  const before = await env.DB.prepare('SELECT * FROM attendance_days WHERE employee_id = ? AND work_date = ?').bind(empId, wd).first();
  const t = nowIso();
  if (!clockIn && !note) {
    if (before) await env.DB.prepare('DELETE FROM attendance_days WHERE id = ?').bind(before.id).run();
  } else {
    const breakStart = clockOut ? null : before ? before.break_start : null;
    await env.DB
      .prepare(
        `INSERT INTO attendance_days (employee_id, work_date, clock_in, clock_out, break_start, break_minutes, note, modified_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (employee_id, work_date) DO UPDATE SET
           clock_in = excluded.clock_in, clock_out = excluded.clock_out, break_start = excluded.break_start,
           break_minutes = excluded.break_minutes, note = excluded.note, modified_by = excluded.modified_by, updated_at = excluded.updated_at`,
      )
      .bind(empId, wd, clockIn, clockOut, breakStart, breakMin, note, data.user.id, t)
      .run();
  }
  const pick = (d) => (d ? { clock_in: d.clock_in, clock_out: d.clock_out, break_minutes: d.break_minutes, note: d.note } : null);
  await audit(env, {
    actorId: data.user.id,
    action: 'attendance.edit',
    target: `${emp.employee_code} ${emp.name} ${wd}`,
    detail: { before: pick(before), after: clockIn || note ? { clock_in: clockIn, clock_out: clockOut, break_minutes: breakMin, note } : null, reason },
    ip: data.ip,
  });
  return json({ ok: true });
}
