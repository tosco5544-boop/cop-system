// 打刻端末：施設の職員一覧と本日の状態
import { json, jstDate, nowIso, addDays } from '../../../lib/util.js';
import { dayState, OPEN_SHIFT_HOURS } from '../../../lib/attendance.js';
import { kioskCookie } from '../../../lib/kiosk.js';

export async function onRequestGet({ env, data }) {
  const k = data.kiosk;
  const today = jstDate();
  const { results: emps } = await env.DB
    .prepare("SELECT id, name, title FROM employees WHERE active = 1 AND dept = ? ORDER BY CASE WHEN title = '施設長' THEN 0 WHEN role = 'admin' THEN 1 ELSE 2 END, employee_code")
    .bind(k.facilityName)
    .all();
  const { results: days } = await env.DB
    .prepare(
      `SELECT d.* FROM attendance_days d JOIN employees e ON e.id = d.employee_id
        WHERE e.dept = ? AND e.active = 1 AND d.work_date >= ? ORDER BY d.work_date`,
    )
    .bind(k.facilityName, addDays(today, -1))
    .all();
  const limit = new Date(Date.now() - OPEN_SHIFT_HOURS * 3600e3).toISOString();
  const pick = (empId) => {
    const mine = days.filter((d) => d.employee_id === empId);
    const open = mine.filter((d) => d.clock_in && !d.clock_out && d.clock_in > limit).pop();
    return open || mine.find((d) => d.work_date === today) || null;
  };
  const employees = emps.map((e) => { const d = pick(e.id); return { id: e.id, name: e.name, title: e.title, day: d, state: dayState(d) }; });
  // Cookie の期限を延長（端末を使い続ける限り切れない）
  return json(
    { facility: { id: k.facilityId, name: k.facilityName, company: k.company }, kiosk: { id: k.id, name: k.name }, employees, today, server_time: nowIso() },
    200,
    { 'Set-Cookie': kioskCookie(k.token) },
  );
}
