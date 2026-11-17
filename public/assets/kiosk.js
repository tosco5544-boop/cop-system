/* 施設の打刻端末（ログイン不要）
 * 施設の打刻用パソコンのブラウザで開いておく。職員は自分の氏名をクリックして出勤・退勤・休憩を記録する。
 */
(function () {
  'use strict';
  const { api, esc, toast, fmtTime, jstDate, WD, weekday, hm, workMinutes } = UMW;
  const BREAKS = [0, 15, 30, 45, 60, 90];
  const STATE = { off: ['未出勤', ''], working: ['勤務中', 'working'], break: ['休憩中', 'working'], done: ['退勤済み', 'done'] };
  const POLL_MS = 60000;
  const PANEL_TIMEOUT_MS = 30000; // 操作がなければ一覧に戻る

  const root = document.getElementById('root');
  let S = null;
  let offset = 0;
  let current = null; // 選択中の職員ID
  let panelTimer = null;

  const now = () => new Date(Date.now() + offset);
  function clockText() {
    const d = now();
    const ymd = jstDate(d);
    return {
      date: `${ymd.replace(/-/g, '/')}（${WD[weekday(ymd)]}）`,
      time: d.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
  }

  function unregistered() {
    root.innerHTML = `<div class="kiosk-empty"><div class="card">
      <div class="brand-mark">UMW</div>
      <h1>この端末は打刻端末として登録されていません</h1>
      <p>事務員または施設長・本部の管理者がこの端末でログインし、［職員・打刻端末］の画面で「この端末を打刻端末にする」を押してください。</p>
      <a class="btn pri" href="/office/login.html?next=${encodeURIComponent('/office/facilities.html')}">事務員・管理者ログインへ</a></div></div>`;
  }

  async function load() {
    try {
      const r = await api('/api/kiosk/status', { noRedirect: true });
      S = r;
      offset = Date.parse(r.server_time) - Date.now();
      render();
    } catch (e) {
      if (e.status === 401) return unregistered();
      if (!S) root.innerHTML = `<div class="kiosk-empty"><div class="card"><h1>読み込めませんでした</h1><p class="err">${esc(e.message)}</p><button class="btn pri" id="k-retry">再読み込み</button></div></div>`;
      else toast(e.message, true);
    }
  }

  function badge(emp) {
    const d = emp.day;
    if (emp.state === 'off') return '<span class="k-st">未出勤</span>';
    if (emp.state === 'done') return `<span class="k-st done">退勤 ${fmtTime(d.clock_out)}</span>`;
    return `<span class="k-st working">出勤 ${fmtTime(d.clock_in)}</span>`;
  }

  function render() {
    const c = clockText();
    const working = S.employees.filter((e) => e.state === 'working' || e.state === 'break').length;
    root.innerHTML = `<div class="kiosk">
      <header class="k-top">
        <div><div class="k-fac">${esc(S.facility.name)}</div><div class="k-sub">${S.facility.company ? esc(S.facility.company) + '　' : ''}勤怠打刻　勤務中 ${working}人 ／ ${S.employees.length}人</div></div>
        <div class="k-clock"><div id="k-date">${c.date}</div><div id="k-time">${c.time}</div></div>
      </header>
      <p class="k-guide">自分の名前をクリックしてください</p>
      <div class="k-grid">${S.employees.map((e) => `<button class="k-card ${STATE[e.state][1]}" data-emp="${e.id}">
          <span class="k-name">${esc(e.name)}</span><span class="k-title">${esc(e.title || '')}</span>${badge(e)}</button>`).join('')
        || '<div class="empty">職員が登録されていません。管理者が［施設・打刻端末］から氏名を追加してください。</div>'}</div>
      <footer class="k-foot"><span>${esc(S.kiosk.name)}</span><button class="btn sm ghost" id="k-reload">最新に更新</button></footer>
    </div>${current ? panelHtml() : ''}`;
    if (current) bindPanel();
  }

  function panelHtml() {
    const e = S.employees.find((x) => x.id === current);
    if (!e) { current = null; return ''; }
    const d = e.day;
    const c = clockText();
    const canBreak = !!(d && d.clock_in) && (e.state !== 'done' || d.work_date === S.today);
    const w = workMinutes(d);
    return `<div class="k-ov" id="k-ov"><div class="k-panel">
      <button class="k-back" data-close-panel>← 戻る<small>（Esc）</small></button>
      <div class="k-pname">${esc(e.name)}<small>さん</small></div>
      <div class="k-ptime">${c.time.slice(0, 5)}</div>
      <div class="k-pstate">${STATE[e.state][0]}${d && d.clock_in ? `　出勤 ${fmtTime(d.clock_in)}` : ''}${d && d.clock_out ? `　退勤 ${fmtTime(d.clock_out)}` : ''}${w != null ? `　実働 ${hm(w)}` : ''}</div>
      <div class="punch-main">
        <button class="pbtn in" data-k="in" ${e.state === 'off' ? '' : 'disabled'}>出勤</button>
        <button class="pbtn out" data-k="out" ${e.state === 'working' || e.state === 'break' ? '' : 'disabled'}>退勤</button>
      </div>
      <div class="break-box"><div class="break-h">休憩時間<span>クリックで選択（当日中は変更できます）</span></div>
        <div class="break-opts">${BREAKS.map((m) => `<button class="bopt ${canBreak && d.break_minutes === m ? 'on' : ''}" data-kb="${m}" ${canBreak ? '' : 'disabled'}>${m ? m + '<small>分</small>' : 'なし'}</button>`).join('')}</div></div>
    </div></div>`;
  }

  function resetPanelTimer() {
    clearTimeout(panelTimer);
    panelTimer = setTimeout(() => { current = null; render(); }, PANEL_TIMEOUT_MS);
  }
  function bindPanel() { resetPanelTimer(); }

  function done(name, message) {
    const box = document.createElement('div');
    box.className = 'k-done';
    box.innerHTML = `<div><div class="k-dname">${esc(name)} さん</div><div class="k-dmsg">${esc(message)}</div><div class="k-dtime">${clockText().time.slice(0, 5)}</div></div>`;
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 2500);
    box.addEventListener('click', () => box.remove());
  }

  async function punch(body) {
    const e = S.employees.find((x) => x.id === current);
    document.querySelectorAll('[data-k],[data-kb]').forEach((b) => { b.disabled = true; });
    try {
      const r = await api('/api/kiosk/punch', { method: 'POST', noRedirect: true, body: { employee_id: current, ...body } });
      e.day = r.day; e.state = r.state;
      if (body.type === 'break') { toast(r.message); render(); }
      else { current = null; clearTimeout(panelTimer); render(); done(r.name, body.type === 'in' ? '出勤しました' : 'お疲れさまでした（退勤）'); }
      load();
    } catch (ex) {
      if (ex.status === 401) return unregistered();
      toast(ex.message, true);
      render();
    }
  }

  document.addEventListener('click', async (ev) => {
    if (ev.target.closest('#k-retry')) { location.reload(); return; }
    if (!S) return;
    const card = ev.target.closest('[data-emp]');
    if (card) { current = Number(card.dataset.emp); render(); return; }
    if (ev.target.closest('[data-close-panel]') || ev.target.id === 'k-ov') { current = null; clearTimeout(panelTimer); render(); return; }
    if (ev.target.closest('#k-reload')) { load(); return; }
    const k = ev.target.closest('[data-k]');
    if (k) {
      resetPanelTimer();
      const e = S.employees.find((x) => x.id === current);
      if (k.dataset.k === 'out' && e.day && !e.day.break_minutes) {
        if (!(await UMW.confirmDialog('休憩時間が「なし」です', '休憩なしで退勤しますか？\n休憩を取った場合は「キャンセル」を押して、休憩時間を選んでから退勤してください。', '休憩なしで退勤', false))) return;
      }
      punch({ type: k.dataset.k });
      return;
    }
    const kb = ev.target.closest('[data-kb]');
    if (kb) { resetPanelTimer(); punch({ type: 'break', minutes: Number(kb.dataset.kb) }); }
  });

  setInterval(() => {
    if (!S) return;
    const c = clockText();
    const t = document.getElementById('k-time');
    const dt = document.getElementById('k-date');
    if (t) t.textContent = c.time;
    if (dt) dt.textContent = c.date;
    // 日付が変わったら一覧を更新
    if (S.today !== jstDate(now())) { S.today = jstDate(now()); load(); }
  }, 1000);
  // キーボード：Esc で一覧に戻る
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && current && !document.querySelector('#modal .ov')) { current = null; clearTimeout(panelTimer); render(); }
  });
  setInterval(() => { if (document.visibilityState === 'visible' && !current) load(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });

  root.innerHTML = '<div class="loading"><div><div class="spin"></div>読み込み中…</div></div>';
  load();
})();
