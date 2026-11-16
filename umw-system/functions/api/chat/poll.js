// 定期取得（ポーリング）：チャンネル一覧の未読数＋表示中チャンネルの新着・変更
import { json, intOr, nowIso } from '../../../lib/util.js';
import { MSG_SELECT, shapeMessage, listChannels } from '../../../lib/chat.js';

export async function onRequestGet({ request, env, data }) {
  const q = new URL(request.url).searchParams;
  const serverTime = nowIso();
  const channels = await listChannels(env, data.user.id);
  const channelId = intOr(q.get('channel'));
  let messages = [];
  let changed = [];
  if (channelId && channels.some((c) => c.id === channelId)) {
    const after = intOr(q.get('after'), 0);
    const since = q.get('since') || '';
    messages = (
      await env.DB.prepare(`${MSG_SELECT} WHERE m.channel_id = ? AND m.id > ? ORDER BY m.id LIMIT 200`).bind(channelId, after).all()
    ).results.map(shapeMessage);
    if (since) {
      changed = (
        await env.DB
          .prepare(`${MSG_SELECT} WHERE m.channel_id = ? AND m.id <= ? AND m.edited_at > ? ORDER BY m.id LIMIT 200`)
          .bind(channelId, after, since)
          .all()
      ).results.map(shapeMessage);
    }
  }
  return json({ channels, messages, changed, server_time: serverTime });
}
