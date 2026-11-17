// 打刻端末からの打刻（その施設の職員のみ）
// body: { employee_id, type: 'in' | 'out' | 'break', minutes? }
import { json, fail, readBody, intOr } from '../../../lib/util.js';
import { applyPunch } from '../../../lib/punch.js';

export async function onRequestPost({ request, env, data }) {
  const b = await readBody(request);
  const empId = intOr(b.employee_id);
  const emp = empId && (await env.DB.prepare('SELECT id, name FROM employees WHERE id = ? AND active = 1 AND dept = ?').bind(empId, data.kiosk.facilityName).first());
  if (!emp) return fail('この施設の職員ではありません', 404);
  if (!['in', 'out', 'break'].includes(b.type)) return fail('打刻の種類が不正です');
  const r = await applyPunch(env, emp.id, b, `${data.ip || ''} 端末${data.kiosk.id}`.trim());
  return json(r.error ? { error: r.error } : { ...r, name: emp.name }, r.error ? r.status : 200);
}
