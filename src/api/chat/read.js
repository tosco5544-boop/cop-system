// 既読位置の更新
import { json, fail, readBody, intOr } from '../../../lib/util.js';

export async function onRequestPost({ request, env, data }) {
  const b = await readBody(request);
  const channelId = intOr(b.channel_id);
  const lastId = intOr(b.last_id, 0);
  if (!channelId) return fail('チャンネルが不正です');
  await env.DB
    .prepare(
      `INSERT INTO chat_reads (employee_id, channel_id, last_read_id) VALUES (?, ?, ?)
       ON CONFLICT (employee_id, channel_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`,
    )
    .bind(data.user.id, channelId, lastId)
    .run();
  return json({ ok: true });
}
