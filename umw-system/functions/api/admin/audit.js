// 操作ログ（管理者）
import { json, intOr, str } from '../../../lib/util.js';

export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  const limit = Math.min(1000, Math.max(1, intOr(q.get('limit'), 300)));
  const word = str(q.get('q'), 50);
  const like = `%${word.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
  const { results } = await env.DB
    .prepare(
      `SELECT a.id, a.at, a.action, a.target, a.detail, a.ip, e.name AS actor_name, e.employee_code AS actor_code
         FROM audit_logs a LEFT JOIN employees e ON e.id = a.actor_id
        WHERE (? = '' OR a.action LIKE ? ESCAPE '\\' OR a.target LIKE ? ESCAPE '\\' OR e.name LIKE ? ESCAPE '\\' OR e.employee_code LIKE ? ESCAPE '\\')
        ORDER BY a.id DESC LIMIT ?`,
    )
    .bind(word, like, like, like, like, limit)
    .all();
  return json({ logs: results });
}
