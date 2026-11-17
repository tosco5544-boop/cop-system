// GET: メッセージ取得（最新50件、before 指定で過去分） / POST: 投稿
import { json, fail, readBody, intOr, nowIso } from '../../../lib/util.js';
import { MSG_SELECT, shapeMessage, getActiveChannel, MAX_BODY } from '../../../lib/chat.js';

const PAGE = 50;

export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  const channelId = intOr(q.get('channel'));
  if (!channelId || !(await getActiveChannel(env, channelId))) return fail('チャンネルが見つかりません', 404);
  const before = intOr(q.get('before'));
  const stmt = before
    ? env.DB.prepare(`${MSG_SELECT} WHERE m.channel_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`).bind(channelId, before, PAGE + 1)
    : env.DB.prepare(`${MSG_SELECT} WHERE m.channel_id = ? ORDER BY m.id DESC LIMIT ?`).bind(channelId, PAGE + 1);
  const rows = (await stmt.all()).results;
  const hasMore = rows.length > PAGE;
  return json({ messages: rows.slice(0, PAGE).reverse().map(shapeMessage), has_more: hasMore, server_time: nowIso() });
}

export async function onRequestPost({ request, env, data }) {
  const b = await readBody(request);
  const channelId = intOr(b.channel_id);
  const body = String(b.body ?? '').replace(/\r\n/g, '\n').trim();
  if (!body) return fail('メッセージを入力してください');
  if (body.length > MAX_BODY) return fail(`メッセージは${MAX_BODY}文字以内にしてください`);
  if (!channelId || !(await getActiveChannel(env, channelId))) return fail('チャンネルが見つかりません', 404);
  const t = nowIso();
  const r = await env.DB
    .prepare('INSERT INTO chat_messages (channel_id, employee_id, body, created_at) VALUES (?, ?, ?, ?)')
    .bind(channelId, data.user.id, body, t)
    .run();
  const id = r.meta.last_row_id;
  await env.DB
    .prepare(
      `INSERT INTO chat_reads (employee_id, channel_id, last_read_id) VALUES (?, ?, ?)
       ON CONFLICT (employee_id, channel_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`,
    )
    .bind(data.user.id, channelId, id)
    .run();
  const row = await env.DB.prepare(`${MSG_SELECT} WHERE m.id = ?`).bind(id).first();
  return json({ message: shapeMessage(row) });
}
