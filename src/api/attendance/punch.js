// 本人の打刻（ログインした職員・管理者）
import { json, readBody } from '../../../lib/util.js';
import { applyPunch } from '../../../lib/punch.js';

export async function onRequestPost({ request, env, data }) {
  const r = await applyPunch(env, data.user.id, await readBody(request), data.ip);
  return json(r.error ? { error: r.error } : r, r.error ? r.status : 200);
}
