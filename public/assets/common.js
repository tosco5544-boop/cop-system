/* UMW 社内システム 共通スクリプト（全画面で読み込む） */
(function () {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isAdminPath = () => location.pathname.startsWith('/admin');
  const loginUrl = () => (isAdminPath() ? '/admin/login.html' : '/office/login.html');

  class ApiError extends Error {
    constructor(message, status, data) { super(message); this.status = status; this.data = data; }
  }

  /** API 呼び出し。401 はログイン画面へ、初回パスワード未変更は変更画面へ移動 */
  async function api(path, opts = {}) {
    const method = opts.method || 'GET';
    const init = { method, credentials: 'same-origin', headers: {} };
    if (method !== 'GET') {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body ?? {});
    }
    let res;
    try { res = await fetch(path, init); }
    catch (e) { throw new ApiError('通信できませんでした。ネットワーク接続を確認してください。', 0); }
    let data = null;
    try { data = await res.json(); } catch (e) { /* JSON 以外 */ }
    if (res.status === 401 && !opts.noRedirect) {
      location.href = loginUrl() + '?next=' + encodeURIComponent(location.pathname + location.search);
      throw new ApiError('ログインが必要です', 401, data);
    }
    if (res.status === 403 && data && data.code === 'must_change_password' && !location.pathname.startsWith('/account')) {
      location.href = '/account.html?force=1';
      throw new ApiError(data.error, 403, data);
    }
    if (!res.ok) throw new ApiError((data && data.error) || `エラーが発生しました（${res.status}）`, res.status, data);
    return data;
  }

  /* ---------- 日時（日本時間で表示） ---------- */
  const TZ = 'Asia/Tokyo';
  const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('ja-JP', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '');
  const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
  const jstDate = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const weekday = (ymd) => new Date(ymd + 'T00:00:00Z').getUTCDay();
  const hm = (min) => (min == null ? '' : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`);
  const daysOfMonth = (ym) => {
    const [y, m] = ym.split('-').map(Number);
    const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`);
  };
  const workMinutes = (d) => (d && d.clock_in && d.clock_out
    ? Math.max(0, Math.round((Date.parse(d.clock_out) - Date.parse(d.clock_in)) / 60000) - (d.break_minutes || 0)) : null);
  /** 日の残業（8時間超）。法定の判定は就業規則に合わせて調整してください */
  const DAILY_STANDARD_MIN = 480;
  const overMinutes = (w) => (w == null ? 0 : Math.max(0, w - DAILY_STANDARD_MIN));

  /* ---------- 表示部品 ---------- */
  const AVC = ['#0f6b5c', '#2457c5', '#a15c07', '#7a3fb0', '#b42318', '#1f7a3d', '#3d5a80', '#8a5a44'];
  function av(name, id, size) {
    let h = 0;
    for (const c of String(id ?? name ?? '?')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const s = size ? `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px;` : '';
    return `<span class="av" style="${s}background:${AVC[h % AVC.length]}">${esc(String(name || '?').slice(0, 1))}</span>`;
  }

  const ICONS = {
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>',
    chat: '<path d="M4 5h16v11H8l-4 4z"/>',
    route: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6H15a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h6.5"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
  };
  const ic = (n, s) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${s ? `width="${s}" height="${s}"` : ''}>${ICONS[n] || ''}</svg>`;

  /** サイドバー。wfNav を渡すとワークフローの中のメニューを差し込む。表示は権限（me.access）で出し分ける */
  function side(active, wfNav) {
    const me = UMW.me;
    const ac = me.access || {};
    const a = (href, key, label, icon) => `<a href="${href}" class="${active === key ? 'on' : ''}">${ic(icon)}<span>${label}</span></a>`;
    const role = ac.hq ? '本部・管理者' : ac.admin ? `施設長・${ac.facility || ''}` : `事務員・${ac.facility || '全施設'}`;
    let h = `<aside class="side"><div class="brand"><div class="brand-mark">UMW</div><div><b>社内システム</b><small>${esc(role)}</small></div></div><nav class="nav">`;
    h += '<div class="nav-h">勤怠</div>';
    if (ac.office) h += a('/office/attendance.html', 'att-admin', ac.facility ? `勤怠管理（${ac.facility}）` : '勤怠管理', 'table') + a('/office/facilities.html', 'fac', '職員・打刻端末', 'users');
    if (ac.admin) h += a('/punch.html', 'punch', '自分の打刻・履歴', 'clock');
    if (ac.admin) {
      h += `<div class="nav-h">コミュニケーション</div>${a('/chat.html', 'chat', 'チャット', 'chat')}`;
      h += `<div class="nav-h">ワークフロー</div>${wfNav || a('/admin/workflow.html', 'wf', 'ワークフロー', 'route')}`;
      h += `<div class="nav-h">デイサービス</div>${a('/admin/usage.html', 'usage', '延べ利用者数', 'chart')}`;
    }
    if (ac.hq) h += `<div class="nav-h">管理（本部）</div>${a('/admin/employees.html', 'emp', '社員管理', 'users')}${a('/admin/audit.html', 'audit', '操作ログ', 'list')}`;
    h += `</nav><div class="side-foot"><div class="me">${esc(me.user.name)}<span style="opacity:.6">（${esc(me.user.employee_code)}）</span></div>
      <a href="/account.html">パスワード変更</a>　<a href="#" data-logout>ログアウト</a></div></aside>`;
    return h;
  }

  async function boot(opts = {}) {
    let me;
    try { me = await api('/api/auth/me'); }
    catch (e) {
      if (e.status !== 401) document.getElementById('root').innerHTML = `<div class="loading"><div class="err">${esc(e.message)}</div></div>`;
      return null;
    }
    const ac = me.access || {};
    if (opts.staffRedirect && !ac.admin) { location.href = opts.staffRedirect; return null; }
    if (opts.admin && !ac.admin) { location.href = '/admin/login.html?next=' + encodeURIComponent(location.pathname); return null; }
    if (opts.office && !ac.office) { location.href = '/office/login.html?next=' + encodeURIComponent(location.pathname); return null; }
    if (opts.hq && !ac.hq) { location.href = '/office/attendance.html'; return null; }
    if (me.user.must_change_password && !opts.allowMustChange) { location.href = '/account.html?force=1'; return null; }
    UMW.me = me;
    if (me.access && me.access.admin) document.body.classList.add('admin-portal');
    return me;
  }

  /** 標準的な画面：ログイン確認 → サイドバー＋ヘッダー描画 → fn(me, viewEl) */
  async function start(opts, fn) {
    const root = document.getElementById('root');
    root.innerHTML = '<div class="loading"><div><div class="spin"></div>読み込み中…</div></div>';
    const me = await boot(opts);
    if (!me) return;
    document.title = `${opts.title} | UMW 社内システム`;
    if (!me.access || !me.access.office) {
      // 勤怠管理の権限がない場合：打刻だけのシンプルな画面（サイドメニューなし）
      root.innerHTML = `<div class="staff-app"><header class="staff-top"><a class="brand-mark" href="/punch.html">UMW</a><b>勤怠打刻</b><div class="sp"></div>
        <a href="/punch.html">打刻</a><a href="/account.html">パスワード変更</a><a href="#" data-logout>ログアウト</a></header>
        <main class="view staff-view" id="view"></main></div>`;
    } else root.innerHTML = `<div class="app">${side(opts.active)}<main><header class="top"><h1>${esc(opts.title)}</h1><div class="sp"></div><div id="top-extra" class="row"></div></header><div class="view ${opts.viewClass || ''}" id="view"></div></main></div>`;
    try { await fn(me, document.getElementById('view')); }
    catch (e) { console.error(e); document.getElementById('view').innerHTML = `<div class="card card-b err">${esc(e.message)}</div>`; }
  }

  async function logout() {
    const admin = UMW.me && UMW.me.scope === 'admin';
    try { await api('/api/auth/logout', { method: 'POST', noRedirect: true }); } catch (e) { /* すでに切れていても移動 */ }
    location.href = admin ? '/admin/login.html' : '/office/login.html';
  }

  /* ---------- モーダル・トースト ---------- */
  function ensure(id) {
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('div'); el.id = id; document.body.appendChild(el); }
    return el;
  }
  function toast(msg, isErr) {
    const t = document.createElement('div');
    t.className = 'toast' + (isErr ? ' e' : '');
    t.textContent = msg;
    ensure('toast').appendChild(t);
    setTimeout(() => t.remove(), isErr ? 5000 : 3200);
  }
  /** モーダルを開く。戻り値の要素の中から入力欄を探して使う */
  function modal({ title, body, foot, size }) {
    const box = document.createElement('div');
    box.className = 'ov';
    box.innerHTML = `<div class="modal ${size || ''}" role="dialog" aria-modal="true">
      <div class="modal-h"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="閉じる">${ic('x', 16)}</button></div>
      <div class="modal-b">${body}</div>${foot ? `<div class="modal-f">${foot}</div>` : ''}</div>`;
    box.close = () => box.remove();
    box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('[data-close]')) box.close(); });
    ensure('modal').appendChild(box);
    const first = box.querySelector('input,textarea,select');
    if (first) first.focus();
    return box;
  }
  function confirmDialog(title, msg, okLabel, danger = true) {
    return new Promise((res) => {
      const m = modal({
        title, size: 'sm', body: `<div style="white-space:pre-wrap">${esc(msg)}</div>`,
        foot: `<button class="btn" data-c="0">キャンセル</button><button class="btn pri" data-c="1" ${danger ? 'style="background:var(--red);border-color:var(--red)"' : ''}>${esc(okLabel || 'OK')}</button>`,
      });
      m.addEventListener('click', (e) => {
        const c = e.target.closest('[data-c]');
        if (c) { m.close(); res(c.dataset.c === '1'); }
        else if (e.target === m || e.target.closest('[data-close]')) res(false);
      });
    });
  }

  function downloadCsv(filename, rows) {
    const csv = rows.map((r) => r.map((v) => {
      const s = String(v ?? '');
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }); // Excel で文字化けしないよう BOM 付き
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-logout]')) { e.preventDefault(); logout(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { const ovs = document.querySelectorAll('#modal .ov'); if (ovs.length) ovs[ovs.length - 1].remove(); }
  });

  const UMW = {
    me: null, api, ApiError, esc, av, ic, side, boot, start, logout, toast, modal, confirmDialog, downloadCsv,
    fmtTime, fmtDateTime, jstDate, WD, weekday, hm, daysOfMonth, workMinutes, overMinutes, DAILY_STANDARD_MIN,
  };
  window.UMW = UMW;
})();
