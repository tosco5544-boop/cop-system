// PUT: 自分のメッセージを編集 / DELETE: 自分のメッセージを削除（管理者は全員分を削除可）
import { json, fail, readBody, intOr, nowIso, audit } from '../../../../lib/util.js';
import { MSG_SELECT, shapeMessage, MAX_BODY } from '../../../../lib/chat.js';

async function load(env, id) {
  return await env.DB.prepare(`${MSG_SELECT} WHERE m.id = ?`).bind(id).first();
}

export async function onRequestPut({ request, env, data, params }) {
  const id = intOr(params.id);
  const m = id && (await load(env, id));
  if (!m || m.deleted) return fail('メッセージが見つかりません', 404);
  if (m.employee_id !== data.user.id) return fail('自分のメッセージのみ編集できます', 403);
  const b = await readBody(request);
  const body = String(b.body ?? '').replace(/\r\n/g, '\n').trim();
  if (!body) return fail('メッセージを入力してください');
  if (body.length > MAX_BODY) return fail(`メッセージは${MAX_BODY}文字以内にしてください`);
  await env.DB.prepare('UPDATE chat_messages SET body = ?, edited_at = ? WHERE id = ?').bind(body, nowIso(), id).run();
  return json({ message: shapeMessage(await load(env, id)) });
}

export async function onRequestDelete({ env, data, params }) {
  const id = intOr(params.id);
  const m = id && (await load(env, id));
  if (!m || m.deleted) return fail('メッセージが見つかりません', 404);
  const isAdmin = data.scope === 'admin' && data.user.role === 'admin';
  if (m.employee_id !== data.user.id && !isAdmin) return fail('自分のメッセージのみ削除できます', 403);
  await env.DB.prepare("UPDATE chat_messages SET deleted = 1, body = '', edited_at = ? WHERE id = ?").bind(nowIso(), id).run();
  if (m.employee_id !== data.user.id) {
    await audit(env, { actorId: data.user.id, action: 'chat.message_deleted_by_admin', target: String(id), detail: { author: m.name, body: m.body.slice(0, 500) }, ip: data.ip });
  }
  return json({ message: shapeMessage(await load(env, id)) });
}
