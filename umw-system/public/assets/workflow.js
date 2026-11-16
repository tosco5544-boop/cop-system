/* ワークフロー（管理者専用）
 * 試作版（UMW ワークフロー）の画面・操作をそのまま移植し、保存先を D1（API）に置き換えたもの。
 * 承認ルートの確定・承認操作の権限チェックはサーバー側でも行う。
 */
(function () {
  'use strict';
  const { esc, toast, api } = UMW;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const uid = (p) => (p || '') + Math.random().toString(36).slice(2, 10);
  const TZ = 'Asia/Tokyo';
  const fmt = (iso) => (iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
  const fmtD = (iso) => (iso ? new Date(iso).toLocaleDateString('ja-JP', { timeZone: TZ, month: '2-digit', day: '2-digit' }) : '');

  const ST = { draft: ['下書き', 'gray'], pending: ['承認待ち', 'blue'], approved: ['承認済み', 'green'], rejected: ['却下', 'red'], returned: ['差し戻し', 'amber'], withdrawn: ['取り下げ', 'gray'] };
  const SST = { waiting: ['未着手', 'gray'], pending: ['承認待ち', 'blue'], approved: ['承認', 'green'], rejected: ['却下', 'red'], returned: ['差し戻し', 'amber'], skipped: ['省略', 'gray'] };
  const OPS = { '>=': '以上', '>': 'より大きい', '<=': '以下', '<': '未満', '==': 'と等しい' };
  const FT = { text: 'テキスト', textarea: '複数行テキスト', number: '数値', date: '日付', select: '選択肢' };
  const AT = { deptTitle: '申請者と同じ部署の役職', title: '役職（全社）', user: '特定のユーザー' };
  const badge = (st, map) => { const m = (map || ST)[st] || [st, 'gray']; return `<span class="badge b-${m[1]}">${m[0]}</span>`; };
  const av = (u, size) => (u ? UMW.av(u.name, u.id, size) : '<span class="av" style="background:#bbb">?</span>');

  /* ============ 状態 ============ */
  let S = { users: [], forms: [], routes: [], requests: [] };
  let ME_ID = null;
  let LOADED = false;
  let NOTE = '';
  let pendingRender = false;
  const UI = { mineTab: 'all', inboxTab: 'todo', allQ: '', allTab: 'all', fromInbox: false };
  let EDIT = null;

  async function reload() {
    const r = await api('/api/admin/wf/bootstrap');
    ME_ID = r.me;
    S = { users: r.users, forms: r.forms, routes: r.routes, requests: r.requests };
    LOADED = true;
    NOTE = '';
  }
  async function refresh() {
    try { await reload(); } catch (e) { NOTE = 'データの更新に失敗しました：' + e.message; }
    softRender();
  }
  async function save(col, obj) {
    const path = col === 'forms' ? '/api/admin/wf/forms/' : '/api/admin/wf/routes/';
    await api(path + encodeURIComponent(obj.id), { method: 'PUT', body: obj });
    await reload();
  }
  async function remove(col, id) {
    const path = col === 'forms' ? '/api/admin/wf/forms/' : '/api/admin/wf/routes/';
    await api(path + encodeURIComponent(id), { method: 'DELETE' });
    await reload();
  }
  const errMsg = (e) => (e && e.message) || '保存に失敗しました';

  /* ============ ユーザー・参照 ============ */
  const userById = (id) => S.users.find((u) => String(u.id) === String(id));
  const formById = (id) => S.forms.find((f) => f.id === id);
  const routeById = (id) => S.routes.find((r) => r.id === id);
  const me = () => userById(ME_ID);
  const byName = (a, b) => (a.dept + a.name).localeCompare(b.dept + b.name, 'ja');
  const approvers = () => S.users.filter((u) => u.active && u.role === 'admin');
  const uname = (id) => { const u = userById(id); return u ? u.name : '（不明なユーザー）'; };

  /* ============ ワークフローエンジン（プレビュー用。確定はサーバー） ============ */
  function describeApprover(st) {
    if (st.type === 'user') return uname(st.target);
    if (st.type === 'deptTitle') return '申請者部署の' + (st.target || '?');
    if (st.type === 'title') return (st.target || '?') + '（全社）';
    return '';
  }
  const describeCond = (c) => (c && c.label ? `「${c.label}」が ${Number(c.value).toLocaleString()} ${OPS[c.op] || c.op}` : '');
  function condOk(c, fields, values) {
    if (!c || !c.label) return true;
    const f = fields.find((x) => x.label === c.label);
    if (!f) return false;
    const raw = values[f.id];
    if (raw === undefined || raw === null || raw === '') return false;
    const v = Number(raw), t = Number(c.value);
    if (isNaN(v)) return false;
    switch (c.op) { case '>=': return v >= t; case '>': return v > t; case '<=': return v <= t; case '<': return v < t; case '==': return v === t; }
    return false;
  }
  function resolveSteps(fields, route, applicant, values) {
    const steps = [], errors = [];
    if (!route) { errors.push('この申請書に承認ルートが設定されていません。'); return { steps, errors }; }
    if (!route.steps || !route.steps.length) { errors.push('承認ルートにステップがありません。'); return { steps, errors }; }
    const ap = approvers();
    for (const st of route.steps) {
      const s = { name: st.name || '承認', approverId: null, status: 'waiting', note: '' };
      if (st.cond && st.cond.label && !condOk(st.cond, fields, values)) { s.status = 'skipped'; s.note = '条件外のため省略（' + describeCond(st.cond) + 'のとき）'; steps.push(s); continue; }
      let u = null;
      if (st.type === 'user') u = ap.find((x) => String(x.id) === String(st.target));
      else if (st.type === 'deptTitle') u = ap.find((x) => x.dept === applicant.dept && x.title === st.target);
      else if (st.type === 'title') u = ap.find((x) => x.title === st.target);
      if (!u) { s.note = '承認者が見つかりません（管理者権限のある社員から探します）'; errors.push(`「${s.name}」の承認者が見つかりません（${describeApprover(st)}）`); steps.push(s); continue; }
      s.approverId = u.id;
      if (u.id === applicant.id) { s.status = 'skipped'; s.note = '申請者本人のため省略'; }
      steps.push(s);
    }
    return { steps, errors };
  }
  const currentApprover = (r) => (r.status === 'pending' && r.steps && r.steps[r.currentStep] ? r.steps[r.currentStep].approverId : null);

  /* ============ 画面ルーティング ============ */
  const cur = () => (location.hash || '').slice(1) || 'dashboard';
  function go(h) { if (location.hash === '#' + h) render(); else location.hash = h; }
  window.addEventListener('hashchange', () => { EDIT = null; closeModal(); render(); window.scrollTo(0, 0); });

  function isEditing() {
    const v = cur();
    if (document.querySelector('#modal .ov')) return true;
    if (v.startsWith('new-') || v.startsWith('edit-')) return true;
    const c = document.getElementById('act-comment');
    if (c && c.value.trim()) return true;
    return false;
  }
  function softRender() { if (LOADED && isEditing()) { pendingRender = true; updateCounts(); } else render(); }

  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    doc: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M8 13h8M8 17h6"/>',
    inbox: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    form: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h4"/>',
    route: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6H15a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h6.5"/>',
    up: '<path d="m6 15 6-6 6 6"/>', down: '<path d="m6 9 6 6 6-6"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
  };
  const ic = (n, s) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${s ? `width="${s}" height="${s}"` : ''}>${ICONS[n]}</svg>`;

  function counts() {
    const m = me();
    if (!m) return { inbox: 0, returned: 0 };
    return { inbox: S.requests.filter((r) => currentApprover(r) === m.id).length, returned: S.requests.filter((r) => r.applicantId === m.id && r.status === 'returned').length };
  }
  function updateCounts() { const c = counts(); document.querySelectorAll('[data-cnt]').forEach((el) => { const n = c[el.dataset.cnt]; el.textContent = n; el.style.display = n ? '' : 'none'; }); }

  /* ============ メイン描画 ============ */
  function render() {
    pendingRender = false;
    const root = document.getElementById('root');
    if (!LOADED) { root.innerHTML = '<div class="loading"><div><div class="spin"></div>読み込み中…</div></div>'; return; }
    const v = cur(), m = me(), c = counts();
    const nav = (h, icon, label, cnt) => {
      const on = v === h || v.startsWith(h + '-') || (h === 'mine' && (v.startsWith('req-') || v.startsWith('edit-')) && !UI.fromInbox) || (h === 'new' && v.startsWith('new')) || (h === 'inbox' && v.startsWith('req-') && UI.fromInbox);
      return `<a href="#${h}" class="sub ${on ? 'on' : ''}">${ic(icon)}<span>${label}</span>${cnt ? `<span class="cnt" data-cnt="${cnt}" style="${c[cnt] ? '' : 'display:none'}">${c[cnt]}</span>` : ''}</a>`;
    };
    let body = '', title = '';
    if (v === 'admin-users') { location.href = '/admin/employees.html'; return; }
    try {
      if (v === 'dashboard') { title = 'ワークフロー'; body = viewDashboard(); }
      else if (v === 'new') { title = '新規申請'; body = viewNewPick(); }
      else if (v.startsWith('new-')) { title = '新規申請'; body = viewRequestForm(v.slice(4), null); }
      else if (v.startsWith('edit-')) { title = '申請の編集'; body = viewRequestForm(null, v.slice(5)); }
      else if (v === 'mine') { title = '自分の申請'; body = viewMine(); }
      else if (v === 'inbox') { title = '承認待ち'; body = viewInbox(); }
      else if (v === 'all') { title = '全申請一覧'; body = viewAll(); }
      else if (v.startsWith('req-')) { title = '申請詳細'; body = viewDetail(v.slice(4)); }
      else if (v === 'admin-forms') { title = '申請書式の管理'; body = viewAdminForms(); }
      else if (v === 'admin-routes') { title = '承認ルートの管理'; body = viewAdminRoutes(); }
      else { title = 'ワークフロー'; body = viewDashboard(); }
    } catch (e) { console.error(e); body = `<div class="card card-b err">画面の表示中にエラーが発生しました：${esc(e.message)}</div>`; }
    const wfNav = nav('dashboard', 'home', 'ホーム') + nav('new', 'plus', '新規申請') + nav('inbox', 'inbox', '承認待ち', 'inbox') + nav('mine', 'doc', '自分の申請', 'returned')
      + nav('all', 'list', '全申請一覧') + nav('admin-forms', 'form', '申請書式') + nav('admin-routes', 'route', '承認ルート');
    document.title = `${title} | UMW 社内システム`;
    root.innerHTML = `<div class="app">${UMW.side('wf', wfNav)}
      <main><header class="top"><h1>${esc(title)}</h1><div class="sp"></div>
        ${m ? `<div class="row">${av(m)}<span>${esc(m.name)}<span class="hint">（${esc(m.dept)}・${esc(m.title)}）</span></span></div>` : ''}
        <button class="btn sm ghost" data-act="refresh" title="最新の状態に更新">更新</button></header>
      <div class="view wf">${NOTE ? `<div class="note">${esc(NOTE)}</div>` : ''}${body}</div></main></div>`;
    afterRender();
  }

  /* ---------- 共通：申請テーブル ---------- */
  function reqTable(list, opts) {
    opts = opts || {};
    if (!list.length) return `<div class="empty">${opts.empty || '該当する申請はありません'}</div>`;
    return `<div class="tbl-wrap"><table class="t"><thead><tr><th>申請番号</th><th>件名</th><th class="hide-sm">申請書</th>${opts.noApplicant ? '' : '<th>申請者</th>'}<th>状態</th><th class="hide-sm">現在の承認者</th><th class="hide-sm">更新日</th></tr></thead><tbody>
    ${list.map((r) => { const ca = currentApprover(r); return `<tr class="click" data-act="open" data-id="${esc(r.id)}" data-from="${opts.from || ''}">
      <td class="mono">${esc(r.no || '—')}</td>
      <td class="ttl">${esc(r.title)}</td>
      <td class="hide-sm"><span class="tag">${esc(r.formName)}</span></td>
      ${opts.noApplicant ? '' : `<td>${esc(uname(r.applicantId))}</td>`}
      <td>${badge(r.status)}</td>
      <td class="hide-sm">${ca ? esc(uname(ca)) + `<span class="hint">（${esc(r.steps[r.currentStep].name)}）</span>` : '<span class="hint">—</span>'}</td>
      <td class="hide-sm hint">${fmtD(r.updatedAt)}</td></tr>`; }).join('')}
    </tbody></table></div>`;
  }
  const byUpdated = (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '');

  /* ---------- ホーム ---------- */
  function viewDashboard() {
    const m = me(), mine = S.requests.filter((r) => r.applicantId === m.id);
    const inbox = S.requests.filter((r) => currentApprover(r) === m.id).sort(byUpdated);
    const pend = mine.filter((r) => r.status === 'pending'), ret = mine.filter((r) => r.status === 'returned');
    const month = UMW.jstDate().slice(0, 7);
    const done = mine.filter((r) => r.status === 'approved' && UMW.jstDate(new Date(r.completedAt || 0)).startsWith(month));
    return `
    <div class="grid g4" style="margin-bottom:20px">
      <a class="card stat ${inbox.length ? 'hl' : ''}" href="#inbox"><div class="k">あなたの承認待ち</div><div class="v">${inbox.length}<small>件</small></div></a>
      <a class="card stat" href="#mine" data-tab="pending"><div class="k">申請中（承認待ち）</div><div class="v">${pend.length}<small>件</small></div></a>
      <a class="card stat ${ret.length ? 'hl' : ''}" href="#mine" data-tab="returned"><div class="k">差し戻し</div><div class="v">${ret.length}<small>件</small></div></a>
      <a class="card stat" href="#mine" data-tab="approved"><div class="k">今月の承認済み</div><div class="v">${done.length}<small>件</small></div></a>
    </div>
    <div class="grid g2">
      <div class="card"><div class="card-h"><h2>承認待ちの申請</h2><div style="flex:1"></div><a class="btn sm ghost" href="#inbox">すべて見る</a></div>
        ${reqTable(inbox.slice(0, 6), { empty: '承認待ちの申請はありません', from: 'inbox' })}</div>
      <div class="card"><div class="card-h"><h2>最近の自分の申請</h2><div style="flex:1"></div><a class="btn sm pri" href="#new">${ic('plus', 14)}新規申請</a></div>
        ${reqTable(mine.sort(byUpdated).slice(0, 6), { noApplicant: true, empty: 'まだ申請はありません' })}</div>
    </div>`;
  }

  /* ---------- 新規申請：書式選択 ---------- */
  function viewNewPick() {
    const forms = S.forms.filter((f) => f.active !== false).sort((a, b) => (a.order || 99) - (b.order || 99));
    if (!forms.length) return '<div class="card empty">利用できる申請書式がありません。<a href="#admin-forms">申請書式を作成</a>してください。</div>';
    return `<p class="hint" style="margin-top:0">申請する書式を選んでください。</p><div class="form-cards">
      ${forms.map((f) => { const r = routeById(f.routeId); return `<button class="fcard" data-act="pick-form" data-id="${esc(f.id)}"><b>${esc(f.name)}</b><p>${esc(f.description || '')}</p><span class="hint">${ic('route', 13)} ${esc(r ? r.name : 'ルート未設定')}・${(f.fields || []).length}項目</span></button>`; }).join('')}
    </div>`;
  }

  /* ---------- 申請フォーム（新規・編集） ---------- */
  function fieldInput(f, val) {
    const a = `data-field="${esc(f.id)}" id="fld-${esc(f.id)}"`;
    const v = val ?? '';
    if (f.type === 'textarea') return `<textarea class="inp" ${a}>${esc(v)}</textarea>`;
    if (f.type === 'select') return `<select class="inp" ${a}><option value="">選択してください</option>${(f.options || []).map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    if (f.type === 'number') return `<div class="unit-wrap"><input type="number" class="inp" ${a} value="${esc(v)}" inputmode="decimal">${f.unit ? `<span>${esc(f.unit)}</span>` : ''}</div>`;
    if (f.type === 'date') return `<input type="date" class="inp" ${a} value="${esc(v)}" style="max-width:220px">`;
    return `<input class="inp" ${a} value="${esc(v)}">`;
  }
  function viewRequestForm(formId, editId) {
    const m = me();
    let req = null, form, fields, values = {}, title = '';
    if (editId) {
      req = S.requests.find((r) => r.id === editId);
      if (!req) return '<div class="card empty">申請が見つかりません</div>';
      if (req.applicantId !== m.id || !['draft', 'returned'].includes(req.status)) return '<div class="card empty">この申請は編集できません</div>';
      form = formById(req.formId) || { name: req.formName, fields: req.fields };
      fields = req.fields; values = req.values || {}; title = req.title;
    } else {
      form = formById(formId);
      if (!form) return '<div class="card empty">申請書式が見つかりません</div>';
      fields = form.fields || [];
    }
    const back = editId ? `#req-${editId}` : '#new';
    return `<div class="two">
      <div class="card"><div class="card-h"><h2>${esc(form.name)}</h2><span class="hint">${esc(form.description || '')}</span></div>
        <div class="card-b" id="req-form" data-form="${esc(req ? req.formId : form.id)}" data-edit="${esc(editId || '')}">
          ${req && req.status === 'returned' ? returnedNote(req) : ''}
          <label class="f"><span>件名<i class="req">*</i></span><input class="inp" id="req-title" value="${esc(title)}" placeholder="申請内容がひと目でわかる件名"></label>
          ${fields.map((f) => `<label class="f"><span>${esc(f.label)}${f.required ? '<i class="req">*</i>' : ''}</span>${fieldInput(f, values[f.id])}</label>`).join('')}
          <div id="form-err" class="err" style="margin-bottom:10px"></div>
          <div class="row"><a class="btn" href="${back}">キャンセル</a><div style="flex:1"></div>
            <button class="btn" data-act="save-draft">下書き保存</button>
            <button class="btn pri" data-act="submit">${req && req.status === 'returned' ? '再申請する' : '申請する'}</button></div>
        </div></div>
      <div class="card sticky"><div class="card-h"><h2>承認ルート（予定）</h2></div><div class="card-b" id="route-preview"></div></div>
    </div>`;
  }
  function returnedNote(req) {
    const s = (req.steps || []).find((x) => x.status === 'returned');
    return s ? `<div class="note" style="margin-bottom:16px"><b>差し戻し理由（${esc(uname(s.approverId))}）：</b>${esc(s.comment)}</div>` : '';
  }
  function readForm() {
    const box = document.getElementById('req-form');
    if (!box) return null;
    const editId = box.dataset.edit;
    const req = editId ? S.requests.find((r) => r.id === editId) : null;
    const form = formById(box.dataset.form);
    const fields = req ? req.fields : (form ? form.fields : []);
    const values = {};
    box.querySelectorAll('[data-field]').forEach((el) => { values[el.dataset.field] = el.value.trim(); });
    return { req, form, fields, values, title: document.getElementById('req-title').value.trim() };
  }
  function routePreviewHtml() {
    const d = readForm();
    if (!d) return '';
    const m = me();
    const route = d.form ? routeById(d.form.routeId) : null;
    const { steps, errors } = resolveSteps(d.fields, route, m, d.values);
    return `${route ? `<div class="hint" style="margin-bottom:12px">${esc(route.name)}</div>` : ''}
      <ol class="flow"><li><span class="dot start">申</span><div><div class="nm">申請</div><div class="sub">${esc(m.name)}（${esc(m.dept)}）</div></div></li>
      ${steps.map((s, i) => `<li class="${s.status === 'skipped' ? 'skip' : ''}"><span class="dot ${s.status === 'skipped' ? 'skipped' : ''}">${i + 1}</span><div><div class="nm">${esc(s.name)}</div><div class="sub">${s.approverId ? esc(uname(s.approverId)) : '<span class="err">未設定</span>'}</div>${s.note ? `<div class="hint" style="text-decoration:none">${esc(s.note)}</div>` : ''}</div></li>`).join('')}
      </ol>${errors.map((e) => `<div class="err">${esc(e)}</div>`).join('')}
      <div class="hint" style="margin-top:6px">入力内容（金額など）によってルートが変わります。</div>`;
  }
  async function doSubmit(asDraft) {
    const d = readForm();
    if (!d) return;
    const m = me();
    const errEl = document.getElementById('form-err');
    document.querySelectorAll('.inp.bad').forEach((e) => e.classList.remove('bad'));
    const miss = [];
    if (!d.title) { miss.push('件名'); document.getElementById('req-title').classList.add('bad'); }
    if (!asDraft) d.fields.forEach((f) => { if (f.required && !d.values[f.id]) { miss.push(f.label); const el = document.getElementById('fld-' + f.id); if (el) el.classList.add('bad'); } });
    if (miss.length) { errEl.textContent = '入力してください：' + miss.join('、'); return; }
    if (!asDraft) {
      const form = formById(d.req ? d.req.formId : d.form && d.form.id);
      const { errors } = resolveSteps(d.fields, form ? routeById(form.routeId) : null, m, d.values);
      if (errors.length) { errEl.textContent = errors.join('\n'); return; }
    }
    try {
      const r = await api('/api/admin/wf/requests', {
        method: 'POST',
        body: { id: d.req ? d.req.id : null, form_id: d.form ? d.form.id : null, title: d.title, values: d.values, submit: !asDraft },
      });
      await reload();
      toast(asDraft ? '下書きを保存しました' : (r.status === 'approved' ? '申請しました（承認者がいないため自動承認）' : '申請しました'));
      UI.fromInbox = false;
      go('req-' + r.id);
    } catch (e) { errEl.textContent = errMsg(e); }
  }

  /* ---------- 一覧 ---------- */
  function tabs(key, defs, list) {
    return `<div class="tabs">${defs.map(([k, l, fn]) => `<button class="${UI[key] === k ? 'on' : ''}" data-act="tab" data-key="${key}" data-val="${k}">${l}<span class="n">${list.filter(fn).length}</span></button>`).join('')}</div>`;
  }
  function viewMine() {
    const m = me();
    const list = S.requests.filter((r) => r.applicantId === m.id).sort(byUpdated);
    const defs = [['all', 'すべて', () => true], ['draft', '下書き', (r) => r.status === 'draft'], ['pending', '承認待ち', (r) => r.status === 'pending'], ['returned', '差し戻し', (r) => r.status === 'returned'], ['approved', '承認済み', (r) => r.status === 'approved'], ['rejected', '却下', (r) => r.status === 'rejected'], ['withdrawn', '取り下げ', (r) => r.status === 'withdrawn']];
    const fn = (defs.find((x) => x[0] === UI.mineTab) || defs[0])[2];
    return `<div class="row" style="margin-bottom:6px">${tabs('mineTab', defs, list)}<div style="flex:1"></div><a class="btn pri" href="#new" style="margin-bottom:14px">${ic('plus', 15)}新規申請</a></div>
      <div class="card">${reqTable(list.filter(fn), { noApplicant: true })}</div>`;
  }
  function viewInbox() {
    const m = me();
    const todo = S.requests.filter((r) => currentApprover(r) === m.id).sort(byUpdated);
    const done = S.requests.filter((r) => (r.history || []).some((h) => h.by === m.id && ['approved', 'rejected', 'returned'].includes(h.action))).sort(byUpdated);
    const all = [...todo, ...done];
    const defs = [['todo', '未処理', (r) => todo.includes(r)], ['done', '処理済み', (r) => done.includes(r)]];
    return `${tabs('inboxTab', defs, all)}<div class="card">${reqTable(UI.inboxTab === 'done' ? done : todo, { from: 'inbox', empty: UI.inboxTab === 'done' ? '処理済みの申請はありません' : '承認待ちの申請はありません' })}</div>`;
  }
  function viewAll() {
    const q = UI.allQ.toLowerCase();
    const list = S.requests.filter((r) => r.status !== 'draft').sort(byUpdated);
    const defs = [['all', 'すべて', () => true], ['pending', '承認待ち', (r) => r.status === 'pending'], ['returned', '差し戻し', (r) => r.status === 'returned'], ['approved', '承認済み', (r) => r.status === 'approved'], ['rejected', '却下', (r) => r.status === 'rejected'], ['withdrawn', '取り下げ', (r) => r.status === 'withdrawn']];
    const fn = (defs.find((x) => x[0] === UI.allTab) || defs[0])[2];
    const shown = list.filter(fn).filter((r) => !q || [r.no, r.title, r.formName, uname(r.applicantId)].join(' ').toLowerCase().includes(q));
    return `<div class="row" style="margin-bottom:4px">${tabs('allTab', defs, list)}<div style="flex:1"></div>
      <button class="btn sm" data-act="csv" style="margin-bottom:14px">CSV出力</button>
      <input class="inp sm" style="max-width:260px;margin-bottom:14px" placeholder="番号・件名・申請者で検索" value="${esc(UI.allQ)}" data-input="allq"></div>
      <div class="card" id="all-table">${reqTable(shown)}</div>`;
  }

  /* ---------- 詳細 ---------- */
  function fmtVal(f, v) {
    if (v === undefined || v === '' || v === null) return '<span class="hint">—</span>';
    if (f.type === 'number') { const n = Number(v); return esc((isNaN(n) ? v : n.toLocaleString()) + (f.unit ? ' ' + f.unit : '')); }
    if (f.type === 'date') { const d = new Date(v + 'T00:00:00'); return isNaN(d) ? esc(v) : esc(d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })); }
    return esc(v);
  }
  const HA = { draft: '下書きを作成', submit: '申請', resubmit: '再申請', approved: '承認', rejected: '却下', returned: '差し戻し', withdrawn: '取り下げ' };
  function viewDetail(id) {
    const r = S.requests.find((x) => x.id === id);
    const m = me();
    if (!r) return '<div class="card empty">申請が見つかりません</div>';
    const a = userById(r.applicantId);
    const isMine = r.applicantId === m.id;
    const myTurn = currentApprover(r) === m.id;
    const back = UI.fromInbox ? '#inbox' : (isMine ? '#mine' : '#all');
    const started = r.status !== 'draft';
    return `
    <div class="row" style="margin-bottom:16px"><a class="btn sm ghost" href="${back}">← 一覧へ戻る</a></div>
    <div class="two">
      <div class="grid" style="gap:20px">
        <div class="card"><div class="card-b">
          <div class="row" style="margin-bottom:6px"><span class="mono" style="color:var(--ink2)">${esc(r.no || '未採番')}</span><span class="tag">${esc(r.formName)}</span>${badge(r.status)}</div>
          <h2 style="margin:4px 0 14px;font-size:20px">${esc(r.title)}</h2>
          <div class="row hint" style="gap:16px;margin-bottom:16px">${av(a, 22)}<span style="color:var(--ink)">${esc(a ? a.name : '?')}</span><span>${esc(a ? a.dept : '')}</span>${r.submittedAt ? `<span>申請日 ${fmt(r.submittedAt)}</span>` : ''}</div>
          <div class="kv">${(r.fields || []).map((f) => `<div class="k">${esc(f.label)}</div><div class="v ${f.type === 'number' ? 'num' : ''}">${fmtVal(f, (r.values || {})[f.id])}</div>`).join('')}</div>
        </div></div>
        ${myTurn ? `<div class="card action"><div class="card-h"><h2>あなたの承認が必要です（${esc(r.steps[r.currentStep].name)}）</h2></div><div class="card-b">
          <label class="f"><span>コメント（差し戻し・却下の場合は必須）</span><textarea class="inp" id="act-comment" style="min-height:70px" placeholder="承認者からのコメント"></textarea></label>
          <div id="act-err" class="err" style="margin-bottom:8px"></div>
          <div class="row"><button class="btn ok" data-act="approve" data-id="${esc(r.id)}">承認する</button><button class="btn warn" data-act="return" data-id="${esc(r.id)}">差し戻す</button><div style="flex:1"></div><button class="btn ng" data-act="reject" data-id="${esc(r.id)}">却下する</button></div>
        </div></div>` : ''}
        ${isMine && ['draft', 'returned', 'pending'].includes(r.status) ? `<div class="card"><div class="card-b row">
          ${r.status === 'returned' ? `<span style="flex:1">差し戻されました。内容を修正して再申請してください。</span><a class="btn pri" href="#edit-${esc(r.id)}">修正して再申請</a><button class="btn ng" data-act="withdraw" data-id="${esc(r.id)}">取り下げ</button>` : ''}
          ${r.status === 'draft' ? `<span style="flex:1">下書きです。まだ申請されていません。</span><button class="btn ng" data-act="delete-draft" data-id="${esc(r.id)}">削除</button><a class="btn pri" href="#edit-${esc(r.id)}">編集して申請</a>` : ''}
          ${r.status === 'pending' ? `<span style="flex:1" class="hint">承認が完了するまで取り下げできます。</span><button class="btn ng" data-act="withdraw" data-id="${esc(r.id)}">申請を取り下げる</button>` : ''}
        </div></div>` : ''}
        <div class="card"><div class="card-h"><h2>履歴</h2></div><div class="card-b" style="padding-top:6px;padding-bottom:6px">
          <ul class="hist">${(r.history || []).slice().reverse().map((h) => `<li><span class="when">${fmt(h.at)}</span><span>${av(userById(h.by), 20)}</span><div><b>${esc(uname(h.by))}</b> が${h.step ? `「${esc(h.step)}」を` : ''}<b>${HA[h.action] || esc(h.action)}</b>しました${h.comment ? `<div class="cmt">${esc(h.comment)}</div>` : ''}</div></li>`).join('')}</ul>
        </div></div>
      </div>
      <div class="card sticky"><div class="card-h"><h2>承認ルート</h2></div><div class="card-b">
        ${started ? `<ol class="flow"><li><span class="dot start">申</span><div><div class="nm">申請</div><div class="sub">${esc(a ? a.name : '')}・${fmt(r.submittedAt)}</div></div></li>
        ${(r.steps || []).map((s, i) => `<li class="${s.status === 'skipped' ? 'skip' : ''}"><span class="dot ${s.status}">${s.status === 'approved' ? '✓' : s.status === 'rejected' ? '×' : s.status === 'returned' ? '↩' : i + 1}</span><div>
          <div class="row" style="gap:6px"><span class="nm">${esc(s.name)}</span>${s.status !== 'skipped' && s.status !== 'waiting' ? badge(s.status, SST) : ''}</div>
          <div class="sub">${s.approverId ? esc(uname(s.approverId)) : '—'}${s.at ? '・' + fmt(s.at) : ''}</div>
          ${s.note ? `<div class="hint" style="text-decoration:none">${esc(s.note)}</div>` : ''}
          ${s.comment ? `<div class="cmt">${esc(s.comment)}</div>` : ''}</div></li>`).join('')}
        ${r.status === 'approved' ? `<li><span class="dot approved">完</span><div><div class="nm">決裁完了</div><div class="sub">${fmt(r.completedAt)}</div></div></li>` : ''}
        </ol>` : '<div class="hint">申請すると承認ルートが確定します。</div>'}
      </div></div>
    </div>`;
  }
  async function doAction(id, kind) {
    const r0 = S.requests.find((x) => x.id === id);
    const m = me();
    if (!r0 || currentApprover(r0) !== m.id) return toast('この申請はすでに処理されています', true);
    const comment = ((document.getElementById('act-comment') || {}).value || '').trim();
    if ((kind === 'rejected' || kind === 'returned') && !comment) { document.getElementById('act-err').textContent = (kind === 'rejected' ? '却下' : '差し戻し') + 'の理由をコメントに入力してください'; return; }
    if (kind === 'rejected' && !(await UMW.confirmDialog('この申請を却下しますか？', '却下すると申請は終了し、再申請できません。', '却下する'))) return;
    try {
      const res = await api('/api/admin/wf/requests/' + encodeURIComponent(id), { method: 'POST', body: { action: kind, comment } });
      document.getElementById('act-comment').value = '';
      await reload();
      toast({ approved: res.status === 'approved' ? '承認しました（決裁完了）' : '承認しました。次の承認者に回付されます', returned: '差し戻しました', rejected: '却下しました' }[kind]);
      render();
    } catch (e) { toast(errMsg(e), true); await refresh(); }
  }
  async function doWithdraw(id) {
    if (!(await UMW.confirmDialog('申請を取り下げますか？', '取り下げた申請は再申請できません。必要な場合は新しく申請してください。', '取り下げる'))) return;
    try { await api('/api/admin/wf/requests/' + encodeURIComponent(id), { method: 'POST', body: { action: 'withdrawn' } }); await reload(); toast('申請を取り下げました'); render(); }
    catch (e) { toast(errMsg(e), true); }
  }

  /* ---------- 管理：申請書式 ---------- */
  function viewAdminForms() {
    const forms = S.forms.slice().sort((a, b) => (a.order || 99) - (b.order || 99));
    return `<div class="row" style="margin-bottom:14px"><p class="hint" style="margin:0;flex:1">申請書の入力項目と、使用する承認ルートを設定します。</p><button class="btn pri" data-act="edit-form">${ic('plus', 15)}書式を追加</button></div>
    <div class="card">${forms.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>書式名</th><th>承認ルート</th><th class="hide-sm">項目数</th><th>状態</th><th></th></tr></thead><tbody>
      ${forms.map((f) => { const r = routeById(f.routeId); return `<tr><td><b>${esc(f.name)}</b><div class="hint">${esc(f.description || '')}</div></td><td>${r ? esc(r.name) : '<span class="err">未設定</span>'}</td><td class="hide-sm">${(f.fields || []).length}</td><td>${f.active !== false ? '<span class="badge b-green">公開中</span>' : '<span class="badge b-gray">非公開</span>'}</td>
      <td style="text-align:right;white-space:nowrap"><button class="btn sm" data-act="edit-form" data-id="${esc(f.id)}">編集</button></td></tr>`; }).join('')}
    </tbody></table></div>` : '<div class="empty">書式がありません</div>'}</div>`;
  }
  function formEditorHtml() {
    const f = EDIT.obj;
    return `<div class="grid g2"><label class="f"><span>書式名<i class="req">*</i></span><input class="inp" data-b="name" value="${esc(f.name)}"></label>
      <label class="f"><span>承認ルート<i class="req">*</i></span><select class="inp" data-b="routeId"><option value="">選択してください</option>${S.routes.map((r) => `<option value="${esc(r.id)}" ${r.id === f.routeId ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label></div>
      <label class="f"><span>説明</span><input class="inp" data-b="description" value="${esc(f.description || '')}"></label>
      <div class="row" style="margin-bottom:6px"><label class="chk"><input type="checkbox" data-b="active" ${f.active !== false ? 'checked' : ''}>申請者に公開する</label><div style="flex:1"></div><span class="hint">表示順</span><input type="number" class="inp sm" data-b="order" value="${esc(f.order || '')}" style="width:70px"></div>
      <div class="sec-t">入力項目 <span class="hint" style="font-weight:400">（件名は自動で追加されます）</span></div>
      ${(f.fields || []).map((x, i) => `<div class="fld-row" data-fi="${i}">
        <input class="inp sm" data-fb="label" value="${esc(x.label)}" placeholder="項目名">
        <select class="inp sm" data-fb="type" data-change="re-form">${Object.entries(FT).map(([k, l]) => `<option value="${k}" ${x.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label class="chk"><input type="checkbox" data-fb="required" ${x.required ? 'checked' : ''}>必須</label>
        ${x.type === 'select' ? `<input class="inp sm" data-fb="options" value="${esc((x.options || []).join('、'))}" placeholder="選択肢を「、」区切りで">` : x.type === 'number' ? `<input class="inp sm" data-fb="unit" value="${esc(x.unit || '')}" placeholder="単位（例：円）">` : '<span></span>'}
        <div class="row" style="gap:4px;flex-wrap:nowrap"><button class="icon-btn" title="上へ" data-act="fmove" data-i="${i}" data-d="-1">${ic('up', 15)}</button><button class="icon-btn" title="下へ" data-act="fmove" data-i="${i}" data-d="1">${ic('down', 15)}</button><button class="icon-btn" title="削除" data-act="fdel" data-i="${i}">${ic('x', 15)}</button></div>
      </div>`).join('')}
      <button class="btn sm" data-act="fadd">${ic('plus', 14)}項目を追加</button>
      <p class="hint">承認ルートの条件（例：金額 100,000円以上）は、ここで付けた<b>項目名</b>で判定します。</p>`;
  }
  function syncForm() {
    const f = EDIT.obj, mb = document.getElementById('modal');
    mb.querySelectorAll('[data-b]').forEach((el) => { const k = el.dataset.b; f[k] = el.type === 'checkbox' ? el.checked : (k === 'order' ? (el.value ? Number(el.value) : null) : el.value.trim()); });
    mb.querySelectorAll('[data-fi]').forEach((row) => { const x = f.fields[+row.dataset.fi]; row.querySelectorAll('[data-fb]').forEach((el) => { const k = el.dataset.fb; if (k === 'required') x.required = el.checked; else if (k === 'options') x.options = el.value.split(/[、,，\n]/).map((s) => s.trim()).filter(Boolean); else x[k] = el.value.trim(); }); });
  }

  /* ---------- 管理：承認ルート ---------- */
  function viewAdminRoutes() {
    return `<div class="row" style="margin-bottom:14px"><p class="hint" style="margin:0;flex:1">承認の順番と承認者の決め方を設定します。承認者は<b>管理者権限のある社員</b>から、社員管理の「部署」「役職」で探します。</p><button class="btn pri" data-act="edit-route">${ic('plus', 15)}ルートを追加</button></div>
    <div class="grid g2">${S.routes.map((r) => { const used = S.forms.filter((f) => f.routeId === r.id); return `<div class="card"><div class="card-h"><h2>${esc(r.name)}</h2><div style="flex:1"></div><button class="btn sm" data-act="edit-route" data-id="${esc(r.id)}">編集</button></div><div class="card-b">
      <ol class="flow">${(r.steps || []).map((s, i) => `<li><span class="dot">${i + 1}</span><div><div class="nm">${esc(s.name)}</div><div class="sub">${esc(describeApprover(s))}</div>${s.cond && s.cond.label ? `<div class="hint">条件：${esc(describeCond(s.cond))}のとき</div>` : ''}</div></li>`).join('')}</ol>
      <div class="hint">使用中の書式：${used.length ? used.map((f) => esc(f.name)).join('、') : 'なし'}</div></div></div>`; }).join('') || '<div class="card empty">ルートがありません</div>'}</div>`;
  }
  function routeEditorHtml() {
    const r = EDIT.obj;
    const titles = [...new Set(approvers().map((u) => u.title).filter(Boolean))];
    const numLabels = [...new Set(S.forms.flatMap((f) => (f.fields || []).filter((x) => x.type === 'number').map((x) => x.label)))];
    return `<label class="f"><span>ルート名<i class="req">*</i></span><input class="inp" data-b="name" value="${esc(r.name)}"></label>
    <datalist id="dl-titles">${titles.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
    <datalist id="dl-num">${numLabels.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
    <div class="sec-t">承認ステップ（上から順に回付）</div>
    ${(r.steps || []).map((s, i) => `<div class="step-row" data-si="${i}">
      <div class="head"><span class="no">${i + 1}</span><input class="inp sm" data-sb="name" value="${esc(s.name)}" placeholder="ステップ名（例：課長承認）" style="flex:1">
        <button class="icon-btn" data-act="smove" data-i="${i}" data-d="-1">${ic('up', 15)}</button><button class="icon-btn" data-act="smove" data-i="${i}" data-d="1">${ic('down', 15)}</button><button class="icon-btn" data-act="sdel" data-i="${i}">${ic('x', 15)}</button></div>
      <div class="step-grid">
        <span>承認者の決め方</span><select class="inp sm" data-sb="type" data-change="re-route">${Object.entries(AT).map(([k, l]) => `<option value="${k}" ${s.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <span>${s.type === 'user' ? 'ユーザー' : '役職'}</span>
        ${s.type === 'user' ? `<select class="inp sm" data-sb="target"><option value="">選択してください</option>${approvers().sort(byName).map((u) => `<option value="${u.id}" ${String(u.id) === String(s.target) ? 'selected' : ''}>${esc(u.name)}（${esc(u.dept)}・${esc(u.title)}）</option>`).join('')}</select>` : `<input class="inp sm" data-sb="target" list="dl-titles" value="${esc(s.target || '')}" placeholder="例：課長">`}
        <span>実行条件</span>
        <div class="row" style="gap:6px"><label class="chk"><input type="checkbox" data-sb="hasCond" data-change="re-route" ${s.cond && s.cond.label !== undefined ? 'checked' : ''}>条件を付ける</label>
        ${s.cond && s.cond.label !== undefined ? `<input class="inp sm" data-sb="clabel" list="dl-num" value="${esc(s.cond.label)}" placeholder="項目名（例：金額）" style="width:130px">が
          <input type="number" class="inp sm" data-sb="cvalue" value="${esc(s.cond.value ?? '')}" style="width:120px">
          <select class="inp sm" data-sb="cop" style="width:auto">${Object.entries(OPS).map(([k, l]) => `<option value="${k}" ${s.cond.op === k ? 'selected' : ''}>${l}</option>`).join('')}</select>のとき` : '<span class="hint">常に実行</span>'}</div>
      </div></div>`).join('')}
    <button class="btn sm" data-act="sadd">${ic('plus', 14)}ステップを追加</button>
    <p class="hint">承認者が申請者本人になるステップは自動で省略されます。</p>`;
  }
  function syncRoute() {
    const r = EDIT.obj, mb = document.getElementById('modal');
    mb.querySelectorAll('[data-b]').forEach((el) => { r[el.dataset.b] = el.value.trim(); });
    mb.querySelectorAll('[data-si]').forEach((row) => {
      const s = r.steps[+row.dataset.si];
      const g = (k) => row.querySelector(`[data-sb="${k}"]`);
      s.name = g('name').value.trim();
      const nt = g('type').value;
      s.target = (nt === s.type && g('target')) ? g('target').value.trim() : (nt === s.type ? s.target : '');
      s.type = nt;
      if (g('hasCond').checked) { s.cond = g('clabel') ? { label: g('clabel').value.trim(), op: g('cop').value, value: g('cvalue').value === '' ? '' : Number(g('cvalue').value) } : (s.cond && s.cond.label !== undefined ? s.cond : { label: '金額', op: '>=', value: '' }); }
      else delete s.cond;
    });
  }

  /* ---------- 編集モーダル ---------- */
  const EDITORS = {
    forms: { title: '申請書式', html: formEditorHtml, sync: syncForm, validate: (f) => (!f.name ? '書式名を入力してください' : !f.routeId ? '承認ルートを選択してください' : (f.fields || []).some((x) => !x.label) ? '項目名が空の項目があります' : null) },
    routes: { title: '承認ルート', html: routeEditorHtml, sync: syncRoute, validate: (r) => (!r.name ? 'ルート名を入力してください' : !(r.steps || []).length ? 'ステップを1つ以上追加してください' : r.steps.some((s) => !s.name || !s.target) ? 'ステップ名と承認者（役職）をすべて入力してください' : r.steps.some((s) => s.cond && (!s.cond.label || s.cond.value === '')) ? '条件の項目名と値を入力してください' : null) },
  };
  function openEditor(col, obj, isNew) {
    EDIT = { col, obj: clone(obj), isNew };
    const ed = EDITORS[col];
    document.getElementById('modal').innerHTML = `<div class="ov" data-act="ov"><div class="modal" role="dialog" aria-modal="true">
      <div class="modal-h"><h3>${ed.title}を${isNew ? '追加' : '編集'}</h3><button class="icon-btn" data-act="close">${ic('x', 16)}</button></div>
      <div class="modal-b" id="ed-body">${ed.html()}</div>
      <div class="modal-f"><span id="ed-err" class="err" style="margin-right:auto;align-self:center"></span>
        ${!isNew ? '<button class="btn ng" data-act="ed-del" style="margin-right:auto">削除</button>' : ''}
        <button class="btn" data-act="close">キャンセル</button><button class="btn pri" data-act="ed-save">保存</button></div></div></div>`;
    const first = document.querySelector('#ed-body input');
    if (first && !obj.name) first.focus();
  }
  function rerenderEditor() { const b = document.getElementById('ed-body'); const st = b.scrollTop; b.innerHTML = EDITORS[EDIT.col].html(); b.scrollTop = st; }
  async function editorSave() {
    const ed = EDITORS[EDIT.col];
    ed.sync();
    const e = ed.validate(EDIT.obj);
    if (e) { document.getElementById('ed-err').textContent = e; return; }
    try { await save(EDIT.col, EDIT.obj); toast('保存しました'); closeModal(); render(); }
    catch (err) { document.getElementById('ed-err').textContent = errMsg(err); }
  }
  async function editorDelete() {
    const { col, obj } = EDIT;
    let warn = '';
    if (col === 'routes') { const used = S.forms.filter((f) => f.routeId === obj.id); if (used.length) warn = `このルートは「${used.map((f) => f.name).join('、')}」で使われています。削除するとその書式は申請できなくなります。`; }
    if (col === 'forms') warn = '既存の申請は残ります。新しい申請ができなくなります（非公開にする方法もあります）。';
    if (!(await UMW.confirmDialog('削除しますか？', warn || 'この操作は元に戻せません。', '削除する'))) return;
    try { await remove(col, obj.id); toast('削除しました'); closeModal(); render(); }
    catch (e) { toast(errMsg(e), true); }
  }
  function closeModal() { document.getElementById('modal').innerHTML = ''; EDIT = null; if (pendingRender) render(); }

  function exportCsv() {
    const list = S.requests.filter((r) => r.status !== 'draft').sort(byUpdated);
    UMW.downloadCsv(`申請一覧_${UMW.jstDate()}.csv`, [
      ['申請番号', '件名', '申請書', '申請者', '状態', '申請日時', '完了日時', '内容'],
      ...list.map((r) => [r.no, r.title, r.formName, uname(r.applicantId), ST[r.status][0], fmt(r.submittedAt), fmt(r.completedAt),
        (r.fields || []).map((f) => `${f.label}:${(r.values || {})[f.id] ?? ''}`).join(' / ')]),
    ]);
  }

  /* ============ イベント ============ */
  function afterRender() { const p = document.getElementById('route-preview'); if (p) p.innerHTML = routePreviewHtml(); }
  document.addEventListener('click', async (e) => {
    const tabLink = e.target.closest('a[data-tab]');
    if (tabLink) UI.mineTab = tabLink.dataset.tab;
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const act = a.dataset.act, id = a.dataset.id;
    if (act === 'ov') { if (e.target === a) closeModal(); return; }
    switch (act) {
      case 'open': UI.fromInbox = a.dataset.from === 'inbox'; go('req-' + id); break;
      case 'pick-form': go('new-' + id); break;
      case 'submit': a.disabled = true; await doSubmit(false); a.disabled = false; break;
      case 'save-draft': a.disabled = true; await doSubmit(true); a.disabled = false; break;
      case 'approve': a.disabled = true; await doAction(id, 'approved'); a.disabled = false; break;
      case 'return': await doAction(id, 'returned'); break;
      case 'reject': await doAction(id, 'rejected'); break;
      case 'withdraw': await doWithdraw(id); break;
      case 'delete-draft':
        if (await UMW.confirmDialog('下書きを削除しますか？', 'この操作は元に戻せません。', '削除する')) {
          try { await api('/api/admin/wf/requests/' + encodeURIComponent(id), { method: 'POST', body: { action: 'delete_draft' } }); await reload(); toast('削除しました'); go('mine'); }
          catch (err) { toast(errMsg(err), true); }
        }
        break;
      case 'tab': UI[a.dataset.key] = a.dataset.val; render(); break;
      case 'refresh': await refresh(); toast('最新の状態に更新しました'); break;
      case 'csv': exportCsv(); break;
      case 'edit-form': { const f = id ? formById(id) : { id: uid('f'), name: '', description: '', routeId: (S.routes[0] && S.routes[0].id) || '', active: true, order: S.forms.length + 1, fields: [{ id: uid('k'), label: '', type: 'text', required: true }] }; openEditor('forms', f, !id); break; }
      case 'edit-route': { const r = id ? routeById(id) : { id: uid('rt'), name: '', steps: [{ name: '課長承認', type: 'deptTitle', target: '課長' }] }; openEditor('routes', r, !id); break; }
      case 'fadd': syncForm(); EDIT.obj.fields.push({ id: uid('k'), label: '', type: 'text', required: false }); rerenderEditor(); break;
      case 'fdel': syncForm(); EDIT.obj.fields.splice(+a.dataset.i, 1); rerenderEditor(); break;
      case 'fmove': { syncForm(); const i = +a.dataset.i, j = i + (+a.dataset.d), L = EDIT.obj.fields; if (j >= 0 && j < L.length) { [L[i], L[j]] = [L[j], L[i]]; rerenderEditor(); } break; }
      case 'sadd': syncRoute(); EDIT.obj.steps.push({ name: '', type: 'deptTitle', target: '' }); rerenderEditor(); break;
      case 'sdel': syncRoute(); EDIT.obj.steps.splice(+a.dataset.i, 1); rerenderEditor(); break;
      case 'smove': { syncRoute(); const i = +a.dataset.i, j = i + (+a.dataset.d), L = EDIT.obj.steps; if (j >= 0 && j < L.length) { [L[i], L[j]] = [L[j], L[i]]; rerenderEditor(); } break; }
      case 'ed-save': await editorSave(); break;
      case 'ed-del': await editorDelete(); break;
      case 'close': closeModal(); break;
    }
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]');
    if (!el) return;
    if (el.dataset.change === 're-form') { syncForm(); rerenderEditor(); }
    else if (el.dataset.change === 're-route') { syncRoute(); rerenderEditor(); }
  });
  document.addEventListener('input', (e) => {
    if (e.target.closest('#req-form') && e.target.dataset.field) { const p = document.getElementById('route-preview'); if (p) p.innerHTML = routePreviewHtml(); }
    if (e.target.dataset.input === 'allq') { UI.allQ = e.target.value; const pos = e.target.selectionStart; render(); const n = document.querySelector('[data-input="allq"]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && EDIT) closeModal(); });

  /* ============ 開始 ============ */
  (async function init() {
    render();
    const m = await UMW.boot({ admin: true });
    if (!m) return;
    try { await reload(); }
    catch (e) { document.getElementById('root').innerHTML = `<div class="loading"><div class="err">${esc(e.message)}</div></div>`; return; }
    render();
    // 他の管理者の操作を反映するため、表示中は1分ごとに更新
    setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 60000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  })();
})();
