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
    for (const sc of res.headers.getSetCookie()) {
      const [, k, v] = sc.match(/^(\w+)=([^;]*)/);
      this.jar = this.jar || {};
      if (v) this.jar[k] = v; else delete this.jar[k];
      this.cookie = Object.entries(this.jar).map(([a, b]) => `${a}=${b}`).join('; ');
    }
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
  const r = await admin.post('/api/admin/employees', { employee_code: 'S100', name: '佐藤 次郎', dept: '本部', title: '事務', role: 'clerk' });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.ok(r.data.temp_password.length >= 10);
  staffPw = r.data.temp_password; staffId = r.data.id;
  assert.equal((await admin.post('/api/admin/employees', { employee_code: 'S100', name: '重複' })).status, 409);
});
// ワークフロー用の管理者（課長・部長）
for (const [code, name, title] of [['A002', '佐々木 施設長', '施設長'], ['A003', '鈴木 事業部長', '事業部長']]) {
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
  assert.equal((await staff.post('/api/attendance/punch', { type: 'break', minutes: 50 })).status, 400);
  const br = await staff.post('/api/attendance/punch', { type: 'break', minutes: 45 });
  assert.equal(br.status, 200, JSON.stringify(br.data));
  assert.equal(br.data.day.break_minutes, 45); assert.equal(br.data.state, 'working');
  const r = await staff.post('/api/attendance/punch', { type: 'out' });
  assert.equal(r.data.state, 'done');
  assert.equal((await staff.post('/api/attendance/punch', { type: 'in' })).status, 409, '同日の再出勤は不可');
  assert.equal((await staff.post('/api/attendance/punch', { type: 'break', minutes: 60 })).data.day.break_minutes, 60, '退勤後も当日は変更可');
  const m = await staff.get('/api/attendance/month');
  assert.equal(m.data.days.length, 1);
});
await t('管理者が勤怠を修正（日付またぎ・削除）', async () => {
  const ym = '2026-10';
  let r = await admin.put('/api/office/attendance/days', { employee_id: staffId, work_date: '2026-10-05', clock_in: '22:00', clock_out: '06:30', break_minutes: 30, note: '夜勤', reason: 'テスト' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await admin.get(`/api/office/attendance/days?ym=${ym}`);
  const d = r.data.days.find((x) => x.work_date === '2026-10-05');
  assert.equal(d.clock_in, '2026-10-05T13:00:00.000Z');
  assert.equal(d.clock_out, '2026-10-05T21:30:00.000Z');
  assert.equal(d.modified_by, 1);
  assert.equal((await admin.put('/api/office/attendance/days', { employee_id: staffId, work_date: '2026-10-06', clock_out: '18:00' })).status, 400);
  assert.equal((await admin.put('/api/office/attendance/days', { employee_id: staffId, work_date: '2026-10-05', clock_in: '25:00' })).status, 400);
  await admin.put('/api/office/attendance/days', { employee_id: staffId, work_date: '2026-10-05', clock_in: '', clock_out: '', note: '' });
  r = await admin.get(`/api/office/attendance/days?ym=${ym}&employee_id=${staffId}`);
  assert.equal(r.data.days.length, 0);
});

console.log('チャット');
const kacho = new Client('10.0.1.2'); await kacho.login('A002', 'Admin1234', 'admin'); await kacho.post('/api/auth/password', { current: 'Admin1234', new_password: 'Kacho1234' });
const bucho = new Client('10.0.1.3'); await bucho.login('A003', 'Admin1234', 'admin'); await bucho.post('/api/auth/password', { current: 'Admin1234', new_password: 'Bucho1234' });
await t('一般職員はチャットを使えない', async () => {
  assert.equal((await staff.get('/api/chat/poll')).status, 403);
  assert.equal((await staff.post('/api/chat/messages', { channel_id: 1, body: 'x' })).status, 403);
});

let msgId;
await t('チャンネル一覧と投稿・未読', async () => {
  const p = await kacho.get('/api/chat/poll');
  assert.equal(p.data.channels.length, 2);
  const r = await kacho.post('/api/chat/messages', { channel_id: 1, body: 'おはようございます\n本日もよろしくお願いします' });
  assert.equal(r.status, 200, JSON.stringify(r.data)); msgId = r.data.message.id;
  assert.equal((await kacho.post('/api/chat/messages', { channel_id: 1, body: '   ' })).status, 400);
  assert.equal((await kacho.post('/api/chat/messages', { channel_id: 999, body: 'x' })).status, 404);
  const a = await admin.get('/api/chat/poll');
  assert.equal(a.data.channels.find((c) => c.id === 1).unread, 1);
  const s = await kacho.get('/api/chat/poll');
  assert.equal(s.data.channels.find((c) => c.id === 1).unread, 0, '自分の投稿は未読にならない');
  await admin.post('/api/chat/read', { channel_id: 1, last_id: msgId });
  assert.equal((await admin.get('/api/chat/poll')).data.channels.find((c) => c.id === 1).unread, 0);
});
await t('新着・編集の取得', async () => {
  const first = await admin.get('/api/chat/messages?channel=1');
  const since = first.data.server_time;
  await new Promise((r) => setTimeout(r, 5));
  assert.equal((await admin.put(`/api/chat/messages/${msgId}`, { body: '他人のは編集不可' })).status, 403);
  await kacho.put(`/api/chat/messages/${msgId}`, { body: '編集しました' });
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
  assert.equal((await kacho.get('/api/chat/poll')).data.channels.length, 2);
  assert.equal((await kacho.post('/api/chat/messages', { channel_id: r.data.id, body: 'x' })).status, 404);
});

console.log('ワークフロー');
let reqId;
await t('初期データ（書式2・ルート1）', async () => {
  const b = await admin.get('/api/admin/wf/bootstrap');
  assert.equal(b.status, 200, JSON.stringify(b.data));
  assert.equal(b.data.forms.length, 2); assert.equal(b.data.routes.length, 1);
  assert.equal((await staff.get('/api/admin/wf/bootstrap')).status, 403);
});
await t('承認者が見つからない申請は拒否（稟議：経理責任者が未登録）', async () => {
  const r = await admin.post('/api/admin/wf/requests', { form_id: 'f1', title: 'PC購入', values: { k1: '設備投資', k2: '500000', k3: '老朽化' }, submit: true });
  assert.equal(r.status, 400); assert.match(r.data.error, /経理確認/);
});
await t('必須項目のチェック', async () => {
  const r = await admin.post('/api/admin/wf/requests', { form_id: 'f2', title: '備品', values: { k1: 'ペン' }, submit: true });
  assert.equal(r.status, 400); assert.match(r.data.error, /数量/);
});
await t('下書き → 申請 → 施設長承認 → 事業部長差し戻し → 再申請 → 承認完了', async () => {
  let r = await admin.post('/api/admin/wf/requests', { form_id: 'f2', title: '車いすの購入', values: { k1: '車いす', k2: '1' }, submit: false });
  assert.equal(r.data.status, 'draft'); reqId = r.data.id;
  r = await admin.post('/api/admin/wf/requests', { id: reqId, title: '車いすの購入', values: { k1: '車いす', k2: '1', k3: '80000', k4: '老朽化のため' }, submit: true });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.status, 'pending'); assert.match(r.data.no, /^R\d{6}-[0-9A-F]{6}$/);
  assert.equal((await bucho.post(`/api/admin/wf/requests/${reqId}`, { action: 'approved' })).status, 409, '順番が違う');
  assert.equal((await kacho.post(`/api/admin/wf/requests/${reqId}`, { action: 'rejected' })).status, 400, '却下はコメント必須');
  assert.equal((await kacho.post(`/api/admin/wf/requests/${reqId}`, { action: 'approved', comment: 'OK' })).data.status, 'pending');
  assert.equal((await bucho.post(`/api/admin/wf/requests/${reqId}`, { action: 'returned', comment: '理由を書いてください' })).data.status, 'returned');
  r = await admin.post('/api/admin/wf/requests', { id: reqId, title: '車いすの購入', values: { k1: '車いす', k2: '1', k3: '80000', k4: '老朽化のため。見積書を添付しました' }, submit: true });
  assert.equal(r.data.status, 'pending');
  await kacho.post(`/api/admin/wf/requests/${reqId}`, { action: 'approved' });
  assert.equal((await bucho.post(`/api/admin/wf/requests/${reqId}`, { action: 'approved' })).data.status, 'approved');
  const b = await admin.get('/api/admin/wf/bootstrap');
  const req = b.data.requests.find((x) => x.id === reqId);
  assert.equal(req.status, 'approved');
  assert.deepEqual(req.history.map((h) => h.action), ['draft', 'submit', 'approved', 'returned', 'resubmit', 'approved', 'approved']);
});
await t('施設長本人の申請は施設長ステップを自動省略', async () => {
  const r = await kacho.post('/api/admin/wf/requests', { form_id: 'f2', title: '文房具', values: { k1: 'ファイル', k2: '10', k3: '3000', k4: '書類整理' }, submit: true });
  const b = await kacho.get('/api/admin/wf/bootstrap');
  const req = b.data.requests.find((x) => x.id === r.data.id);
  assert.equal(req.steps[0].status, 'skipped'); assert.equal(req.steps[1].status, 'pending');
  assert.equal((await kacho.post(`/api/admin/wf/requests/${r.data.id}`, { action: 'withdrawn' })).data.status, 'withdrawn');
});
await t('承認ルートを申請ごとに指定し、使ったルートが記録される', async () => {
  const kachoId = (await kacho.get('/api/auth/me')).data.user.id;
  const buchoId = (await bucho.get('/api/auth/me')).data.user.id;
  const vals = { k1: 'プリンター', k2: '1', k3: '30000', k4: '故障のため' };
  assert.equal((await admin.post('/api/admin/wf/requests', { form_id: 'f2', title: 'x', values: vals, submit: true, route: [] })).status, 400, '承認者なし');
  assert.equal((await admin.post('/api/admin/wf/requests', { form_id: 'f2', title: 'x', values: vals, submit: true, route: [{ approverId: 1 }] })).status, 400, '自分は不可');
  assert.equal((await admin.post('/api/admin/wf/requests', { form_id: 'f2', title: 'x', values: vals, submit: true, route: [{ approverId: staffId }] })).status, 400, '管理者以外は不可');
  // 事業部長 → 施設長 の順（標準ルートと逆）
  const route = [{ name: '事業部長確認', approverId: buchoId }, { name: '最終承認', approverId: kachoId }];
  let r = await admin.post('/api/admin/wf/requests', { form_id: 'f2', title: 'プリンター購入', values: vals, submit: true, route });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await kacho.post(`/api/admin/wf/requests/${r.data.id}`, { action: 'approved' })).status, 409, '順番が違う');
  await bucho.post(`/api/admin/wf/requests/${r.data.id}`, { action: 'approved' });
  assert.equal((await kacho.post(`/api/admin/wf/requests/${r.data.id}`, { action: 'approved' })).data.status, 'approved');
  // 同じルートをもう一度 → 記録は1行で回数2
  r = await admin.post('/api/admin/wf/requests', { form_id: 'f1', title: '研修委託', values: { k1: 'その他', k2: '200000', k3: '研修' }, submit: true, route });
  assert.equal(r.status, 200);
  const log = (await admin.get('/api/admin/wf/bootstrap')).data.routeLog;
  const hit = log.find((x) => x.steps.map((s) => s.approverId).join(',') === `${buchoId},${kachoId}`);
  assert.equal(hit.usedCount, 2); assert.equal(hit.steps[0].name, '事業部長確認'); assert.equal(hit.lastFormName, '稟議書');
  // 下書きに予定のルートが残る
  r = await admin.post('/api/admin/wf/requests', { form_id: 'f2', title: '下書き', values: {}, submit: false, route: [{ name: '承認', approverId: kachoId }] });
  const d = (await admin.get('/api/admin/wf/bootstrap')).data.requests.find((x) => x.id === r.data.id);
  assert.equal(d.steps[0].approverId, kachoId); assert.equal(d.status, 'draft');
  await admin.post(`/api/admin/wf/requests/${r.data.id}`, { action: 'delete_draft' });
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
  const r = await admin.post('/api/admin/wf/requests', { form_id: 'f2', title: '購買の下書き', values: {}, submit: false });
  assert.equal((await kacho.post(`/api/admin/wf/requests/${r.data.id}`, { action: 'delete_draft' })).status, 409);
  assert.equal((await admin.post(`/api/admin/wf/requests/${r.data.id}`, { action: 'delete_draft' })).status, 200);
});

console.log('施設・打刻端末');
const tablet = new Client('10.0.2.1');
let oiwa;
await t('未登録の端末は打刻できない', async () => {
  assert.equal((await tablet.get('/api/kiosk/status')).data.code, 'kiosk_unregistered');
});
await t('施設に氏名をまとめて追加（社員IDは自動）', async () => {
  const f = await admin.get('/api/office/facilities');
  assert.equal(f.status, 200); assert.equal(f.data.facilities.length, 17);
  assert.deepEqual(f.data.facilities.filter((x) => x.company === 'T社').map((x) => x.name), ['籠上', '本社', '金谷', '山梨']);
  oiwa = f.data.facilities.find((x) => x.name === '大岩');
  const r = await admin.post(`/api/office/facilities/${oiwa.id}/staff`, { names: '伊藤 美咲\n中村 翔\n\n高橋　さくら', title: '介護職員' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.added.map((x) => x.code), ['K0001', 'K0002', 'K0003']);
  assert.equal(r.data.added[2].name, '高橋 さくら');
  assert.equal((await admin.post(`/api/office/facilities/${oiwa.id}/staff`, { names: '伊藤 美咲' })).status, 409, '同姓同名は確認');
  assert.equal((await new Client('10.0.2.9').login('K0001', '!')).status, 401, '打刻のみの職員はログインできない');
  // 施設長（管理者）も施設の打刻端末に表示される
  await admin.post('/api/admin/employees', { employee_code: 'A101', name: '大岩 施設長', dept: '大岩', title: '施設長', role: 'admin', password: 'Admin1234' });
});
await t('端末を登録すると管理者はログアウトされ、端末で打刻できる', async () => {
  await tablet.login('A001', 'Admin1234', 'admin');
  const r = await tablet.post('/api/office/kiosks', { facility_id: oiwa.id, name: '大岩の打刻用PC' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await tablet.get('/api/auth/me')).status, 401);
});
await t('端末からの打刻（他施設の職員は不可）', async () => {
  // Client は Cookie を1つしか保持しないので kid を直接使う
  const st = await tablet.get('/api/kiosk/status');
  assert.equal(st.status, 200, JSON.stringify(st.data));
  assert.equal(st.data.facility.name, '大岩'); assert.equal(st.data.employees.length, 4);
  assert.equal(st.data.employees[0].title, '施設長', '施設長が先頭');
  const ito = st.data.employees[1];
  let r = await tablet.post('/api/kiosk/punch', { employee_id: ito.id, type: 'in' });
  assert.equal(r.data.state, 'working'); assert.equal(r.data.name, '伊藤 美咲');
  r = await tablet.post('/api/kiosk/punch', { employee_id: ito.id, type: 'break', minutes: 60 });
  assert.equal(r.data.day.break_minutes, 60);
  assert.equal((await tablet.post('/api/kiosk/punch', { employee_id: 1, type: 'in' })).status, 404);
  assert.equal((await tablet.get('/api/admin/employees')).status, 401, '端末では管理画面は使えない');
});
await t('施設名の変更で所属職員の部署も変わる・端末の解除', async () => {
  await admin.put(`/api/admin/facilities/${oiwa.id}`, { name: '大岩（本館）' });
  const f = (await admin.get('/api/office/facilities')).data.facilities.find((x) => x.id === oiwa.id);
  assert.equal(f.employees.length, 4); assert.equal(f.kiosks.length, 1);
  assert.equal((await tablet.get('/api/kiosk/status')).data.facility.name, '大岩（本館）');
  await admin.del(`/api/office/kiosks/${f.kiosks[0].id}`);
  assert.equal((await tablet.get('/api/kiosk/status')).status, 401);
});

console.log('権限（施設長・事務員）');
const chief = new Client('10.0.3.1');
const clerkC = new Client('10.0.3.2');
await t('施設長は自分の施設の勤怠だけ見られる', async () => {
  await chief.login('A101', 'Admin1234', 'admin');
  await chief.post('/api/auth/password', { current: 'Admin1234', new_password: 'Chief1234' });
  const me = await chief.get('/api/auth/me');
  assert.equal(me.data.access.facility, '大岩（本館）'); assert.equal(me.data.access.hq, false);
  const d = await chief.get('/api/office/attendance/days');
  assert.equal(d.status, 200, JSON.stringify(d.data));
  assert.ok(d.data.employees.length >= 4 && d.data.employees.every((e) => e.dept === '大岩（本館）'));
  assert.ok(d.data.days.every((x) => d.data.employees.some((e) => e.id === x.employee_id)));
  assert.equal((await chief.put('/api/office/attendance/days', { employee_id: staffId, work_date: '2026-10-01', clock_in: '09:00' })).status, 403, '他施設の職員は修正不可');
  assert.equal((await chief.get('/api/office/facilities')).data.facilities.length, 1);
  assert.equal((await chief.get('/api/admin/employees')).status, 403, '社員管理は本部のみ');
  assert.equal((await chief.get('/api/admin/audit')).status, 403, '操作ログは本部のみ');
  assert.equal((await chief.get('/api/admin/wf/bootstrap')).status, 200, 'ワークフローは使える');
});
await t('施設の事務員：事務員用の入口から自分の施設の勤怠管理', async () => {
  const r = await admin.post('/api/admin/employees', { employee_code: 'C001', name: '大岩 事務', dept: '大岩（本館）', title: '事務員', role: 'clerk', password: 'Clerk1234' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await clerkC.login('C001', 'Clerk1234', 'admin')).status, 403, '管理者の入口には入れない');
  assert.equal((await clerkC.login('C001', 'Clerk1234')).status, 200);
  await clerkC.post('/api/auth/password', { current: 'Clerk1234', new_password: 'Clerk5678' });
  const me = await clerkC.get('/api/auth/me');
  assert.equal(me.data.access.office, true); assert.equal(me.data.access.admin, false);
  const d = await clerkC.get('/api/office/attendance/days');
  assert.ok(d.data.employees.length && d.data.employees.every((e) => e.dept === '大岩（本館）'));
  assert.equal((await clerkC.get('/api/admin/wf/bootstrap')).status, 403);
  assert.equal((await clerkC.get('/api/chat/poll')).status, 403);
  const f = (await clerkC.get('/api/office/facilities')).data.facilities[0];
  assert.equal((await clerkC.post(`/api/office/facilities/${f.id}/staff`, { names: '新人 太郎' })).status, 200);
  const other = (await admin.get('/api/office/facilities')).data.facilities.find((x) => x.name === '焼津');
  assert.equal((await clerkC.post(`/api/office/facilities/${other.id}/staff`, { names: 'x' })).status, 403, '他施設には追加できない');
  const newbie = (await clerkC.get('/api/office/facilities')).data.facilities[0].employees.find((e) => e.name === '新人 太郎');
  assert.equal((await clerkC.post(`/api/office/staff/${newbie.id}`, { action: 'retire' })).status, 200);
});
await t('本部の事務員は全施設、権限のない職員は入れない', async () => {
  const me = await staff.get('/api/auth/me');
  assert.equal(me.data.access.office, true); assert.equal(me.data.access.facility, null);
  const d = await staff.get('/api/office/attendance/days');
  assert.ok(new Set(d.data.employees.map((e) => e.dept)).size > 1);
  await admin.post('/api/admin/employees', { employee_code: 'P001', name: '一般 花子', dept: '焼津', role: 'staff', password: 'Plain1234' });
  assert.equal((await new Client('10.0.3.9').login('P001', 'Plain1234')).status, 403);
});

console.log('延べ利用者数');
await t('施設一覧（本部は全施設を入力可）', async () => {
  const r = await admin.get('/api/admin/usage/facilities');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.facilities.length, 8); assert.ok(r.data.facilities.every((f) => f.can_edit));
  assert.equal(r.data.facilities.find((f) => f.name === '大岩').use_7h, 0);
  assert.equal((await clerkC.get('/api/admin/usage/facilities')).status, 403, '事務員は使えない');
});
await t('施設長は自分の施設だけ入力でき、全施設を閲覧できる', async () => {
  await admin.post('/api/admin/employees', { employee_code: 'A102', name: '焼津 施設長', dept: '焼津', title: '施設長', role: 'admin', password: 'Admin1234' });
  const y = new Client('10.0.4.1');
  await y.login('A102', 'Admin1234', 'admin'); await y.post('/api/auth/password', { current: 'Admin1234', new_password: 'Yaizu1234' });
  const f = (await y.get('/api/admin/usage/facilities')).data.facilities;
  assert.deepEqual(f.filter((x) => x.can_edit).map((x) => x.name), ['焼津']);
  const yaizu = f.find((x) => x.name === '焼津').id, joseii = f.find((x) => x.name === '城西').id;
  assert.equal((await y.put('/api/admin/usage/records', { facility_id: yaizu, date: '2026-12-01', am_support: 10, am_care: 20, pm_support: 5, pm_care: 15, full_care: 40 })).status, 200);
  assert.equal((await y.put('/api/admin/usage/records', { facility_id: joseii, date: '2026-12-01', am_support: 1 })).status, 403);
  assert.equal((await y.put('/api/admin/usage/records', { facility_id: yaizu, date: '2026-12-06', am_support: 1 })).status, 400, '日曜は入力不可');
  assert.equal((await y.put('/api/admin/usage/records', { facility_id: yaizu, date: '2026-12-02', am_support: -1 })).status, 400);
  await y.put('/api/admin/usage/records', { facility_id: yaizu, date: '2026-12-02', am_support: 0, am_care: 0, pm_support: 0, pm_care: 0, full_care: 0 });
  await y.put('/api/admin/usage/records', { facility_id: yaizu, date: '2026-12-03', am_support: 1 });
  await y.put('/api/admin/usage/records', { facility_id: yaizu, date: '2026-12-03', am_support: null }); // 空欄に戻す → 未入力
  const rec = await y.get(`/api/admin/usage/records?facility_id=${yaizu}&month=2026-12`);
  assert.deepEqual(rec.data.records.map((x) => x.date), ['2026-12-01', '2026-12-02']);
  // 集計：営業日2日 → 午前 (30+0)/2=15、午後 (20+0)/2=10、3H=12.5、7H=20
  const sm = (await y.get('/api/admin/usage/summary?month=2026-12')).data.summary.find((x) => x.facility.id === yaizu);
  assert.equal(sm.total.days, 2); assert.equal(sm.total.am, 15); assert.equal(sm.total.pm, 10); assert.equal(sm.total.h3, 12.5); assert.equal(sm.total.full, 20);
  assert.equal(sm.weekdays[2].days, 1, '12/1は火曜');
  const tr = (await y.get(`/api/admin/usage/trend?facility_id=${yaizu}&year=2026`)).data.trend;
  assert.equal(tr[11].days, 2);
  assert.equal((await y.put(`/api/admin/usage/facilities/${yaizu}`, { name: '焼津', cap_3h: 1, cap_7h: 1 })).status, 403, '設定は本部のみ');
  assert.equal((await admin.put(`/api/admin/usage/facilities/${yaizu}`, { name: '焼津', cap_3h: 46, cap_7h: 50, use_am: true, use_pm: true, use_7h: true })).status, 200);
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
