// チャットの共通処理
export const MAX_BODY = 4000;

export const MSG_SELECT = `SELECT m.id, m.channel_id, m.employee_id, m.body, m.created_at, m.edited_at, m.deleted,
                                  e.name, e.dept
                             FROM chat_messages m JOIN employees e ON e.id = m.employee_id`;

export function shapeMessage(m) {
  return {
    id: m.id,
    channel_id: m.channel_id,
    employee_id: m.employee_id,
    name: m.name,
    dept: m.dept,
    body: m.deleted ? '' : m.body,
    created_at: m.created_at,
    edited_at: m.edited_at,
    deleted: m.deleted === 1,
  };
}

export async function listChannels(env, employeeId) {
  const { results } = await env.DB
    .prepare(
      `SELECT c.id, c.name, c.description,
              COALESCE(r.last_read_id, 0) AS last_read_id,
              (SELECT COUNT(*) FROM chat_messages m
                 WHERE m.channel_id = c.id AND m.deleted = 0 AND m.id > COALESCE(r.last_read_id, 0) AND m.employee_id <> ?) AS unread,
              (SELECT MAX(id) FROM chat_messages m WHERE m.channel_id = c.id) AS last_id
         FROM chat_channels c
         LEFT JOIN chat_reads r ON r.channel_id = c.id AND r.employee_id = ?
        WHERE c.archived = 0
        ORDER BY c.id`,
    )
    .bind(employeeId, employeeId)
    .all();
  return results;
}

export async function getActiveChannel(env, id) {
  return await env.DB.prepare('SELECT * FROM chat_channels WHERE id = ? AND archived = 0').bind(id).first();
}
