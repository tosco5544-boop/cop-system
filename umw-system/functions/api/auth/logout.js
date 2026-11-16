import { json, audit } from '../../../lib/util.js';
import { destroySession, clearCookie } from '../../../lib/session.js';

export async function onRequestPost({ request, env, data }) {
  await destroySession(env, request);
  await audit(env, { actorId: data.user.id, action: 'auth.logout', ip: data.ip });
  return json({ ok: true, scope: data.scope }, 200, { 'Set-Cookie': clearCookie() });
}
