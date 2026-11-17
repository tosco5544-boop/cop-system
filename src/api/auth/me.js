import { json } from '../../../lib/util.js';

export async function onRequestGet({ data }) {
  return json({ user: data.user, scope: data.scope, access: data.access, expires_at: data.session.expiresAt });
}
