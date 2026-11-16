// API の通しテスト（Cloudflare を使わず、Node 内蔵 SQLite で D1 を模擬して実行）
// 実行: node --experimental-sqlite test/api.test.mjs
import assert from 'node:assert/strict';
import { handle } from './harness.mjs';

/* ---------- テスト用クライアント ---------- */
class Client {
  constructor(ip = '10.0.0.1') { this.cookie = ''; this.ip = ip; }
  async req(method, path, body, headers = {}) {
    const h = { 'CF-Connecting-IP': this.ip, Origin: 'https://umw.example', ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    if (method !== 'GET' && !('Content-Type' in headers)) h['Content-Type'] = 'application/json';
    const res = await handle(new Request('https://umw.example' + path, { method, headers: h, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) }));
    const sc = res.headers.get('Set-Cookie');
    if (sc) { const v = sc.match(/^sid=([^;]*)/)[1]; this.cookie = v ? `sid=${v}` : ''; }
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data };
  }
  get(p) { return this.req('GET', p); }
  post(p, b) { return this.req('POST', p, b); }
  put(p, b) { return this.req('PUT', p, b); }
  del(p) { return this.req('DELETE', p); }
  async login(code, password, portal = 'staff') { return this.post('/api/auth/login', { employee_code: code, password, portal }); }
}

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.error('  ✗', name); console.error(e); process.exitCode = 1; throw e; }
}

console.log('基盤');
const admin = new Client();
await t('初期設定が必要と表示される', async () => { const r = await admin.get('/api/setup'); assert.equal(r.data.needed, true); });
await t('トークン違いは拒否', async () => { const r = await admin.post('/api/setup', { token: 'x', employee_code: 'A001', name: '管理 一郎', password: 'Passw0rd!' }); assert.equal(r.status, 403); });
await t('最初の管理者を作成', async () => {
  const r = await admin.post('/api/setup', { token: 'test-token', employee_code: 'A001', name: '山田 太郎', dept: '営業部', title: '担当', password: 'Admin1234' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await admin.get('/api/setup')).data.needed, false);
  assert.equal((await admin.post('/api/setup', { token: 'test-token', employee_code: 'A002', name: 'x', password: 'Admin1234' })).status, 403);
});
await t('未ログインは401', async () => { assert.equal((await new Client().get('/api/auth/me')).status, 401); });
await t('他オリジンからの書き込みは拒否', async () => { assert.equal((await admin.req('POST', '/api/auth/login', {}, { Origin: 'https://evil.example' })).status, 403); });
await t('JSON以外の書き込みは拒否', async () => { assert.equal((await admin.req('POST', '/api/auth/login', {}, { 'Content-Type': 'text/plain' })).status, 415); });
await t('管理者入口でログイン', async () => {
  const r = await admin.login('A001', 'Admin1234', 'admin');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const me = await admin.get('/api/auth/me');
  assert.equal(me.data.scope, 'admin'); assert.equal(me.data.user.name, '山田 太郎');
});

let staffPw, staffId;
await t('社員を追加すると仮パスワードが出る', async () => {
  const r = await admin.post('/api/admin/employees', { employee_code: 'S100', name: '佐藤 次郎', dept: '開発部', title: '担当', role: 'staff' });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.ok(r.data.temp_password.length >= 10);
  staffPw = r.data.temp_password; staffId = r.data.id;
  assert.equal((await admin.post('/api/admin/employees', { employee_code: 'S100', name: '重複' })).status, 409);
});
// ワークフロー用の管理者（課長・部長）
for (const [code, name, title] of [['A002', '佐々木 課長', '課長'], ['A003', '鈴木 部長', '部長']]) {
  await admin.post('/api/admin/employees', { employee_code: code, name, dept: '営業部', title, role: 'admin', password: 'Admin1234' });
}

const staff = new Client('10.0.0.2');
await t('一般職員は管理者入口に入れない', async () => { const r = await staff.login('S100', staffPw, 'admin'); assert.equal(r.status, 403); });
await t('一般職員でログイン → 初回はパスワード変更を強制', async () => {
  const r = await staff.login('S100', staffPw);
  assert.equal(r.status, 200); assert.equal(r.data.must_change_password, true);
  const p = await staff.post('/api/attendance/punch', { type: 'in' });
  assert.equal(p.status, 403); assert.equal(p.data.code, 'must_change_password');
});
await t('パスワード変更（ルール違反は拒否）', async () => {
  assert.equal((await staff.post('/api/auth/password', { current: staffPw, new_password: 'short' })).status, 400);
  assert.equal((await staff.post('/api/auth/password', { current: 'wrong', new_password: 'Staff1234' })).status, 400);
  const r = await staff.post('/api/auth/password', { current: staffPw, new_password: 'Staff1234' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await staff.get('/api/auth/me')).data.user.must_change_password, false);
});
await t('一般職員は管理者APIを使えない', async () => { assert.equal((await staff.get('/api/admin/employees')).status, 403); });
await t('管理者でも職員入口からのログインでは管理者APIを使えない', async () => {
  const c = new Client('10.0.0.3'); await c.login('A001', 'Admin1234', 'staff');
  assert.equal((await c.get('/api/admin/employees')).status, 403);
});
await t('連続失敗でロック → 仮パスワード再発行で解除', async () => {
  const c = new Client('10.0.0.4');
  for (let i = 0; i < 5; i++) assert.equal((await c.login('S100', 'bad-pass')).status, 401);
  assert.equal((await c.login('S100', 'Staff1234')).status, 429);
  const r = await admin.post(`/api/admin/employees/${staffId}`, { action: 'reset_password' });
  assert.equal(r.status, 200);
  assert.equal((await staff.get('/api/auth/me')).status, 401, '再発行で既存セッションは切れる');
  assert.equal((await c.login('S100', r.data.temp_password)).status, 200);
  await c.post('/api/auth/password', { current: r.data.temp_password, new_password: 'Staff1234' });
  assert.equal((await staff.login('S100', 'Staff1234')).status, 200);
});

console.log('勤怠');
await t('出勤 → 休憩 → 退勤', async () => {
  assert.equal((await staff.get('/api/attendance/today')).data.state, 'off');
  assert.equal((await staff.post('/api/attendance/punch', { type: 'out' })).status, 409);
  assert.equal((await staff.post('/api/attendance/punch', { type: 'in' })).data.state, 'working');
  assert.equal((await staff.post('/api/attendance/punch', { type: 'in' })).status, 409);
  assert.equal((await staff.post('/api/attendance/punch', { type: 'break_start' })).data.state, 'break');
  assert.equal((await staff.post('/api/attendance/punch', { type: 'break_end' })).data.state, 'working');
  const r = await staff.post('/api/attendance/punch', { type: 'out' });
  assert.equal(r.data.state, 'done');
  assert.equal((await staff.post('/api/attendance/punch', { type: 'in' })).status, 409, '同日の再出勤は不可');
  const m = await staff.get('/api/attendance/month');
  assert.equal(m.data.days.length, 1);
});
await t('管理者が勤怠を修正（日付またぎ・削除）', async () => {
  const ym = '2026-10';
  let r = await admin.put('/api/admin/attendance/days', { employee_id: staffId, work_date: '2026-10-05', clock_in: '22:00', clock_out: '06:30', break_minutes: 30, note: '夜勤', reason: 'テスト' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await admin.get(`/api/admin/attendance/days?ym=${ym}`);
  const d = r.data.days.find((x) => x.work_date === '2026-10-05');
  assert.equal(d.clock_in, '2026-10-05T13:00:00.000Z');
  assert.equal(d.clock_out, '2026-10-05T21:30:00.000Z');
  assert.equal(d.modified_by, 1);
  assert.equal((await admin.put('/api/admin/attendance/days', { employee_id: staffId, work_date: '2026-10-06', clock_out: '18:00' })).status, 400);
  assert.equal((await admin.put('/api/admin/attendance/days', { employee_id: staffId, work_date: '2026-10-05', clock_in: '25:00' })).status, 400);
  await admin.put('/api/admin/attendance/days', { employee_id: staffId, work_date: '2026-10-05', clock_in: '', clock_out: '', note: '' });
  r = await admin.get(`/api/admin/attendance/days?ym=${ym}&employee_id=${staffId}`);
  assert.equal(r.data.days.length, 0);
});

console.log('チャット');
let msgId;
await t('チャンネル一覧と投稿・未読', async () => {
  const p = await staff.get('/api/chat/poll');
  assert.equal(p.data.channels.length, 2);
  const r = await staff.post('/api/chat/messages', { channel_id: 1, body: 'おはようございます\n本日もよろしくお願いします' });
  assert.equal(r.status, 200, JSON.stringify(r.data)); msgId = r.data.message.id;
  assert.equal((await staff.post('/api/chat/messages', { channel_id: 1, body: '   ' })).status, 400);
  assert.equal((await staff.post('/api/chat/messages', { channel_id: 999, body: 'x' })).status, 404);
  const a = await admin.get('/api/chat/poll');
  assert.equal(a.data.channels.find((c) => c.id === 1).unread, 1);
  const s = await staff.get('/api/chat/poll');
  assert.equal(s.data.channels.find((c) => c.id === 1).unread, 0, '自分の投稿は未読にならない');
  await admin.post('/api/chat/read', { channel_id: 1, last_id: msgId });
  assert.equal((await admin.get('/api/chat/poll')).data.channels.find((c) => c.id === 1).unread, 0);
});
await t('新着・編集の取得', async () => {
  const first = await admin.get('/api/chat/messages?channel=1');
  const since = first.data.server_time;
  await new Promise((r) => setTimeout(r, 5));
  assert.equal((await admin.put(`/api/chat/messages/${msgId}`, { body: '他人のは編集不可' })).status, 403);
  await staff.put(`/api/chat/messages/${msgId}`, { body: '編集しました' });
  const m2 = (await admin.post('/api/chat/messages', { channel_id: 1, body: '了解です' })).data.message;
  const p = await admin.get(`/api/chat/poll?channel=1&after=${msgId}&since=${encodeURIComponent(since)}`);
  assert.deepEqual(p.data.messages.map((m) => m.id), [m2.id]);
  assert.equal(p.data.changed[0].body, '編集しました');
});
await t('削除（本人・管理者）', async () => {
  const other = (await admin.post('/api/chat/messages', { channel_id: 2, body: '管理者の投稿' })).data.message;
  assert.equal((await staff.del(`/api/chat/messages/${other.id}`)).status, 403);
  const r = await admin.del(`/api/chat/messages/${msgId}`);
  assert.equal(r.data.message.deleted, true); assert.equal(r.data.message.body, '');
});
await t('チャンネル作成・アーカイブ（管理者のみ）', async () => {
  assert.equal((await staff.post('/api/admin/chat/channels', { name: '営業' })).status, 403);
  const r = await admin.post('/api/admin/chat/channels', { name: '営業', description: '営業部' });
  assert.equal(r.status, 200);
  assert.equal((await admin.post('/api/admin/chat/channels', { name: '営業' })).status, 409);
  await admin.put(`/api/admin/chat/channels/${r.data.id}`, { archived: true });
  assert.equal((await staff.get('/api/chat/poll')).data.channels.length, 2);
  assert.equal((await staff.post('/api/chat/messages', { channel_id: r.data.id, body: 'x' })).status, 404);
});

console.log('ワークフロー');
const kacho = new Client('10.0.1.2'); await kacho.login('A002', 'Admin1234', 'admin'); await kacho.post('/api/auth/password', { current: 'Admin1234', new_password: 'Kacho1234' });
const bucho = new Client('10.0.1.3'); await bucho.login('A003', 'Admin1234', 'admin'); await bucho.post('/api/auth/password', { current: 'Admin1234', new_password: 'Bucho1234' });
let reqId;
await t('初期データ（書式4・ルート3）', async () => {
  const b = await admin.get('/api/admin/wf/bootstrap');
  assert.equal(b.status, 200, JSON.stringify(b.data));
  assert.equal(b.data.forms.length, 4); assert.equal(b.data.routes.length, 3);
  assert.equal((await staff.get('/api/admin/wf/bootstrap')).status, 403);
});
await t('承認者が見つからない申請は拒否（稟議：経理部長が未登録）', async () => {
  const r = await admin.post('/api/admin/wf/requests', { form_id: 'f1', title: 'PC購入', values: { k1: '設備投資', k2: '500000', k3: '老朽化' }, submit: true });
  assert.equal(r.status, 400); assert.match(r.data.error, /経理部長確認/);
});
await t('必須項目のチェック', async () => {
  const r = await admin.post('/api/admin/wf/requests', { form_id: 'f3', title: '有給', values: { k1: '年次有給休暇' }, submit: true });
  assert.equal(r.status, 400); assert.match(r.data.error, /開始日/);
});
await t('下書き → 申請 → 課長承認 → 部長差し戻し → 再申請 → 承認完了', async () => {
  let r = await admin.post('/api/admin/wf/requests', { form_id: 'f3', title: '年次有給休暇（2日）', values: { k1: '年次有給休暇', k2: '2026-11-26' }, submit: false });
  assert.equal(r.data.status, 'draft'); reqId = r.data.id;
  r = await admin.post('/api/admin/wf/requests', { id: reqId, title: '年次有給休暇（2日）', values: { k1: '年次有給休暇', k2: '2026-11-26', k3: '2026-11-27' }, submit: true });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.status, 'pending'); assert.match(r.data.no, /^R\d{6}-[0-9A-F]{6}$/);
  assert.equal((await bucho.post(`/api/admin/wf/requests/${reqId}`, { action: 'approved' })).status, 409, '順番が違う');
  assert.equal((await kacho.post(`/api/admin/wf/requests/${reqId}`, { action: 'rejected' })).status, 400, '却下はコメント必須');
  assert.equal((await kacho.post(`/api/admin/wf/requests/${reqId}`, { action: 'approved', comment: 'OK' })).data.status, 'pending');
  assert.equal((await bucho.post(`/api/admin/wf/requests/${reqId}`, { action: 'returned', comment: '理由を書いてください' })).data.status, 'returned');
  r = await admin.post('/api/admin/wf/requests', { id: reqId, title: '年次有給休暇（2日）', values: { k1: '年次有給休暇', k2: '2026-11-26', k3: '2026-11-27', k4: '家族行事のため' }, submit: true });
  assert.equal(r.data.status, 'pending');
  await kacho.post(`/api/admin/wf/requests/${reqId}`, { action: 'approved' });
  assert.equal((await bucho.post(`/api/admin/wf/requests/${reqId}`, { action: 'approved' })).data.status, 'approved');
  const b = await admin.get('/api/admin/wf/bootstrap');
  const req = b.data.requests.find((x) => x.id === reqId);
  assert.equal(req.status, 'approved');
  assert.deepEqual(req.history.map((h) => h.action), ['draft', 'submit', 'approved', 'returned', 'resubmit', 'approved', 'approved']);
});
await t('課長本人の申請は課長ステップを自動省略', async () => {
  const r = await kacho.post('/api/admin/wf/requests', { form_id: 'f3', title: '代休', values: { k1: '代休', k2: '2026-12-01', k3: '2026-12-01' }, submit: true });
  const b = await kacho.get('/api/admin/wf/bootstrap');
  const req = b.data.requests.find((x) => x.id === r.data.id);
  assert.equal(req.steps[0].status, 'skipped'); assert.equal(req.steps[1].status, 'pending');
  assert.equal((await kacho.post(`/api/admin/wf/requests/${r.data.id}`, { action: 'withdrawn' })).data.status, 'withdrawn');
});
await t('書式・ルートの保存と検証', async () => {
  assert.equal((await admin.put('/api/admin/wf/routes/r9', { name: '', steps: [] })).status, 400);
  assert.equal((await admin.put('/api/admin/wf/routes/r9', { name: '経費ルート', steps: [{ name: '部長承認', type: 'deptTitle', target: '部長', cond: { label: '金額', op: '>=', value: 1000 } }] })).status, 200);
  assert.equal((await admin.put('/api/admin/wf/forms/f9', { name: '経費精算', routeId: 'r9', fields: [{ id: 'k1', label: '金額', type: 'number', required: true, unit: '円' }] })).status, 200);
  const r = await admin.post('/api/admin/wf/requests', { form_id: 'f9', title: '交通費', values: { k1: '500' }, submit: true });
  assert.equal(r.data.status, 'approved', '条件外ステップのみ → 自動承認');
  assert.equal((await admin.del('/api/admin/wf/forms/f9')).status, 200);
});
await t('下書き削除は本人のみ', async () => {
  const r = await admin.post('/api/admin/wf/requests', { form_id: 'f4', title: '会議室', values: {}, submit: false });
  assert.equal((await kacho.post(`/api/admin/wf/requests/${r.data.id}`, { action: 'delete_draft' })).status, 409);
  assert.equal((await admin.post(`/api/admin/wf/requests/${r.data.id}`, { action: 'delete_draft' })).status, 200);
});

console.log('社員管理・操作ログ');
await t('自分の管理者権限は外せない／無効化で即ログアウト', async () => {
  assert.equal((await admin.put('/api/admin/employees/1', { role: 'staff' })).status, 400);
  assert.equal((await admin.put(`/api/admin/employees/${staffId}`, { active: false })).status, 200);
  assert.equal((await staff.get('/api/auth/me')).status, 401);
  assert.equal((await new Client('10.9.9.9').login('S100', 'Staff1234')).status, 401);
  const list = await admin.get('/api/admin/employees');
  assert.ok(list.data.employees.every((e) => !('password_hash' in e)), 'ハッシュは返さない');
});
await t('操作ログ', async () => {
  const r = await admin.get('/api/admin/audit?q=attendance');
  assert.ok(r.data.logs.length >= 2);
  assert.ok((await admin.get('/api/admin/audit')).data.logs.some((l) => l.action === 'wf.approved'));
});
await t('ログアウト', async () => {
  assert.equal((await admin.post('/api/auth/logout')).status, 200);
  assert.equal((await admin.get('/api/auth/me')).status, 401);
});

console.log(`\n${passed} 件すべて成功`);
