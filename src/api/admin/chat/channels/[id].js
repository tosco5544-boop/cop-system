// チャンネルの名前・説明の変更、アーカイブ（管理者）
import { json, fail, readBody, str, intOr, audit } from '../../../../../lib/util.js';

export async function onRequestPut({ request, env, data, params }) {
  const id = intOr(params.id);
  const ch = id && (await env.DB.prepare('SELECT * FROM chat_channels WHERE id = ?').bind(id).first());
  if (!ch) return fail('チャンネルが見つかりません', 404);
  const b = await readBody(request);
  const name = b.name === undefined ? ch.name : str(b.name, 40);
  const description = b.description === undefined ? ch.description : str(b.description, 200);
  const archived = b.archived === undefined ? ch.archived : b.archived ? 1 : 0;
  if (!name) return fail('チャンネル名を入力してください');
  const dup = await env.DB.prepare('SELECT id FROM chat_channels WHERE name = ? AND id <> ?').bind(name, id).first();
  if (dup) return fail('同じ名前のチャンネルがあります', 409);
  await env.DB.prepare('UPDATE chat_channels SET name = ?, description = ?, archived = ? WHERE id = ?').bind(name, description, archived, id).run();
  await audit(env, {
    actorId: data.user.id,
    action: archived && !ch.archived ? 'chat.channel_archive' : 'chat.channel_update',
    target: name,
    detail: { before: { name: ch.name, description: ch.description }, after: { name, description } },
    ip: data.ip,
  });
  return json({ ok: true });
}
