// チャンネル作成（管理者）
import { json, fail, readBody, str, nowIso, audit } from '../../../../lib/util.js';

export async function onRequestPost({ request, env, data }) {
  const b = await readBody(request);
  const name = str(b.name, 40);
  if (!name) return fail('チャンネル名を入力してください');
  const exists = await env.DB.prepare('SELECT id, archived FROM chat_channels WHERE name = ?').bind(name).first();
  if (exists) return fail(exists.archived ? '同じ名前のアーカイブ済みチャンネルがあります' : '同じ名前のチャンネルがあります', 409);
  const r = await env.DB
    .prepare('INSERT INTO chat_channels (name, description, created_by, created_at) VALUES (?, ?, ?, ?)')
    .bind(name, str(b.description, 200), data.user.id, nowIso())
    .run();
  await audit(env, { actorId: data.user.id, action: 'chat.channel_create', target: name, ip: data.ip });
  return json({ id: r.meta.last_row_id });
}
