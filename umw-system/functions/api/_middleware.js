// /api/* すべてに適用：DB確認・CSRF対策・ログイン確認・管理者権限確認
import { getSession } from '../../lib/session.js';
import { json, clientIp } from '../../lib/util.js';

const PUBLIC_PATHS = new Set(['/api/auth/login', '/api/setup']);
const ALLOWED_BEFORE_PASSWORD_CHANGE = new Set(['/api/auth/me', '/api/auth/password', '/api/auth/logout']);

export async function onRequest(context) {
  const { request, env, data, next } = context;
  const url = new URL(request.url);
  try {
    if (!env.DB) {
      return json({ error: 'データベース（D1）が接続されていません。Pages の設定で D1 バインディング「DB」を追加してください。' }, 500);
    }

    // CSRF 対策：書き込み系は同一オリジン＋JSON のみ受け付ける
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const origin = request.headers.get('Origin');
      if (origin && origin !== url.origin) return json({ error: '不正なリクエストです' }, 403);
      if (!(request.headers.get('Content-Type') || '').includes('application/json')) {
        return json({ error: '不正なリクエストです（JSON以外）' }, 415);
      }
    }

    data.ip = clientIp(request);
    if (PUBLIC_PATHS.has(url.pathname)) return await next();

    const s = await getSession(env, request);
    if (!s) return json({ error: 'ログインが必要です', code: 'unauthorized' }, 401);
    data.user = s.user;
    data.scope = s.scope;
    data.session = s;

    // 管理者API：管理者用の入口からログインした管理者のみ
    if (url.pathname.startsWith('/api/admin/') && !(s.scope === 'admin' && s.user.role === 'admin')) {
      return json({ error: '管理者用ページからログインしてください', code: 'forbidden' }, 403);
    }

    if (s.user.must_change_password && !ALLOWED_BEFORE_PASSWORD_CHANGE.has(url.pathname)) {
      return json({ error: '初回ログインのため、パスワードを変更してください', code: 'must_change_password' }, 403);
    }

    return await next();
  } catch (e) {
    console.error(e && e.stack ? e.stack : e);
    return json({ error: 'サーバーでエラーが発生しました。時間をおいて再度お試しください。' }, 500);
  }
}
