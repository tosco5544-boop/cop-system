// パスワードハッシュ（PBKDF2-SHA256）とトークン生成
// Cloudflare Workers の Web Crypto は PBKDF2 の反復回数上限が 100,000 回のため、この値を使用

const enc = new TextEncoder();
const ITERATIONS = 100000;

function toB64(u8) {
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(b) {
  const s = atob(b);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2_sha256$${ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') {
    await pbkdf2(password, new Uint8Array(16), ITERATIONS); // 応答時間をそろえる
    return false;
  }
  const iterations = Number.parseInt(parts[1], 10);
  const salt = fromB64(parts[2]);
  const expected = fromB64(parts[3]);
  const got = await pbkdf2(password, salt, iterations);
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ expected[i];
  return diff === 0;
}

/** 存在しない社員IDでも同じ時間がかかるようにするためのダミー */
export const DUMMY_HASH = 'pbkdf2_sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export function randomToken(bytes = 32) {
  const u = crypto.getRandomValues(new Uint8Array(bytes));
  return toB64(u).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 仮パスワード（紛らわしい文字 0/O/1/l/I を除外） */
export function tempPassword(len = 10) {
  const cs = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  while (s.length < len) {
    for (const b of crypto.getRandomValues(new Uint8Array(len * 2))) {
      if (b < 224 && s.length < len) s += cs[b % cs.length]; // 224 = 56*4 で偏りをなくす
    }
  }
  // パスワード条件（英字＋数字）を満たすよう、数字がなければ末尾を数字にする
  return /\d/.test(s) ? s : s.slice(0, -1) + '23456789'[crypto.getRandomValues(new Uint8Array(1))[0] % 8];
}

export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'パスワードは8文字以上にしてください';
  if (pw.length > 128) return 'パスワードは128文字以内にしてください';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'パスワードは英字と数字を両方含めてください';
  return null;
}

export function timingSafeEqualStr(a, b) {
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}
