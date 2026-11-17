// ワークフロー画面の初期データ（社員・書式・ルート・申請・履歴）
import { json } from '../../../../lib/util.js';
import { rowToForm, rowToRoute, rowToRequest, rowToHistory } from '../../../../lib/workflow.js';

export async function onRequestGet({ env, data }) {
  const me = data.user.id;
  const [users, forms, routes, requests, history, routeLog] = await env.DB.batch([
    env.DB.prepare('SELECT id, name, dept, title, role, active FROM employees ORDER BY dept, name'),
    env.DB.prepare('SELECT * FROM wf_forms ORDER BY sort_order, name'),
    env.DB.prepare('SELECT * FROM wf_routes ORDER BY name'),
    env.DB.prepare("SELECT * FROM wf_requests WHERE status <> 'draft' OR applicant_id = ? ORDER BY updated_at DESC").bind(me),
    env.DB.prepare(
      `SELECT h.* FROM wf_history h JOIN wf_requests r ON r.id = h.request_id
        WHERE r.status <> 'draft' OR r.applicant_id = ? ORDER BY h.id`,
    ).bind(me),
    env.DB.prepare('SELECT * FROM wf_route_log ORDER BY last_used_at DESC LIMIT 100'),
  ]);
  const histMap = new Map();
  for (const h of history.results) {
    if (!histMap.has(h.request_id)) histMap.set(h.request_id, []);
    histMap.get(h.request_id).push(rowToHistory(h));
  }
  return json({
    me,
    users: users.results.map((u) => ({ ...u, active: u.active === 1 })),
    forms: forms.results.map(rowToForm),
    routes: routes.results.map(rowToRoute),
    requests: requests.results.map((r) => rowToRequest(r, histMap.get(r.id) || [])),
    routeLog: routeLog.results.map((x) => ({ id: x.id, steps: JSON.parse(x.steps_json), usedCount: x.used_count, firstUsedAt: x.first_used_at, lastUsedAt: x.last_used_at, lastUsedBy: x.last_used_by, lastFormName: x.last_form_name })),
  });
}
