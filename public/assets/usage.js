/* 延べ利用者数（管理者のみ）
 * 「延べ利用者数アプリ」を社内システムに組み込んだもの。ログインは社内システムの管理者ログインを使う。
 *  入力：本部は全施設、施設長は自分の施設だけ（施設名が同じもの）。閲覧・集計は全施設。
 *  設定（施設名・定員・区分）：本部のみ。
 */
(function () {
  'use strict';
  const { api, esc } = UMW;
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const METRICS = [['am', '午前'], ['pm', '午後'], ['h3', '3H平均'], ['full', '7H']];
  const fmt = (v) => (v === null || v === undefined ? '—' : v.toFixed(1));
  const now = new Date(Date.now() + 9 * 3600e3);
  const S = { facilities: [], hq: false, own: null, month: now.toISOString().slice(0, 7), facilityId: null, metric: 'am' };
  let view;

  async function loadFacilities() {
    const r = await api('/api/admin/usage/facilities');
    S.facilities = r.facilities; S.hq = r.hq; S.own = r.own;
    if (!S.facilityId) {
      const mine = S.facilities.find((f) => f.can_edit && !S.hq);
      S.facilityId = (mine || S.facilities[0] || {}).id;
    }
  }

  /* ---------- 枠 ---------- */
  function frame(active, inner) {
    const tabs = [['input', '実績入力'], ['summary', '集計']];
    if (S.hq) tabs.push(['settings', '設定']);
    view.innerHTML = `<div class="ua">
      <div class="tabs">${tabs.map(([k, l]) => `<button class="${k === active ? 'on' : ''}" data-view="${k}">${l}</button>`).join('')}</div>
      ${inner}</div>`;
  }
  function monthBar(extra = '') {
    return `<div class="ua-bar"><div class="ua-month"><button type="button" id="prev" aria-label="前の月">‹</button>
      <input type="month" id="month" value="${S.month}" aria-label="対象月"><button type="button" id="next" aria-label="次の月">›</button></div>
      ${extra}<span class="ua-status" id="status" role="status"></span></div>`;
  }
  function bindMonth(rerender) {
    const shift = (d) => {
      const [y, m] = S.month.split('-').map(Number);
      const t = new Date(Date.UTC(y, m - 1 + d, 1));
      S.month = t.toISOString().slice(0, 7);
      rerender();
    };
    view.querySelector('#prev').onclick = () => shift(-1);
    view.querySelector('#next').onclick = () => shift(1);
    view.querySelector('#month').onchange = (ev) => { if (ev.target.value) { S.month = ev.target.value; rerender(); } };
  }
  const facilityTabs = () => `<div class="ua-tabs" id="fac" role="tablist" aria-label="施設">${S.facilities.map((f) =>
    `<button type="button" role="tab" data-id="${f.id}" aria-selected="${f.id === S.facilityId}" class="${f.id === S.facilityId ? 'on' : ''}">${esc(f.name)}${f.can_edit && !S.hq ? ' ✎' : ''}</button>`).join('')}</div>`;
  function bindTabs(rerender) {
    view.querySelector('#fac').addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-id]');
      if (!b) return;
      S.facilityId = Number(b.dataset.id);
      rerender();
    });
  }

  /* ---------- 入力 ---------- */
  async function renderInput() {
    const f = S.facilities.find((x) => x.id === S.facilityId) || S.facilities[0];
    S.facilityId = f.id;
    const canEdit = f.can_edit;
    const { records } = await api(`/api/admin/usage/records?facility_id=${f.id}&month=${S.month}`);
    const byDate = Object.fromEntries(records.map((r) => [r.date, r]));
    const [y, m] = S.month.split('-').map(Number);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cols = [];
    if (f.use_am) cols.push(['am_support', 'am_care', 'am']);
    if (f.use_pm) cols.push(['pm_support', 'pm_care', 'pm']);
    const cell = (date, key, r) => `<td class="in"><input type="number" inputmode="numeric" min="0" max="999" step="1"
      data-date="${date}" data-key="${key}" ${canEdit ? '' : 'disabled'} value="${r && r[key] !== null && r[key] !== undefined ? r[key] : ''}" aria-label="${date} ${key}"></td>`;
    let body = '';
    for (let d = 1; d <= days; d++) {
      const date = `${S.month}-${String(d).padStart(2, '0')}`;
      const w = new Date(date + 'T00:00:00Z').getUTCDay();
      const r = byDate[date];
      const span = cols.length * 3 + (f.use_7h ? 1 : 0);
      if (w === 0) { body += `<tr class="closed"><td>${d}</td><td>日</td><td colspan="${span}">休業日</td></tr>`; continue; }
      body += `<tr data-row="${date}" class="${w === 6 ? 'sat' : ''}"><td>${d}</td><td>${WD[w]}</td>`;
      for (const [s, c, t] of cols) body += cell(date, s, r) + cell(date, c, r) + `<td class="num" data-total="${t}"></td>`;
      if (f.use_7h) body += cell(date, 'full_care', r);
      body += '</tr>';
    }
    const head1 = (f.use_am ? `<th colspan="3">午前 9:00-12:00（定員${f.cap_3h}）</th>` : '')
      + (f.use_pm ? `<th colspan="3">午後 13:00-16:00（定員${f.cap_3h}）</th>` : '')
      + (f.use_7h ? `<th>7H 9:00-16:00（定員${f.cap_7h}）</th>` : '');
    const head2 = cols.map(() => '<th>要支援</th><th>要介護</th><th>合計</th>').join('') + (f.use_7h ? '<th>要介護</th>' : '');

    frame('input', facilityTabs() + monthBar() + `<div class="ua-kpis" id="kpis"></div>
      <div class="card"><div class="tbl-wrap"><table class="ua-entry">
        <thead><tr><th rowspan="2">日</th><th rowspan="2">曜日</th>${head1}</tr><tr>${head2}</tr></thead>
        <tbody>${body}</tbody><tfoot><tr id="sum"></tr><tr id="avg"></tr></tfoot></table></div></div>
      <p class="hint">${canEdit ? '入力すると自動で保存されます。' : '<b>閲覧のみ</b>です（入力できるのは自分の施設だけです）。'}入力がある日だけを営業日として数えます（0も営業日に含みます）。空欄に戻した日は未入力の扱いです。</p>`);
    bindMonth(renderInput);
    bindTabs(renderInput);

    const rowValues = (tr) => { const v = {}; tr.querySelectorAll('input').forEach((i) => { v[i.dataset.key] = i.value === '' ? null : Number(i.value); }); return v; };
    function recalc() {
      const sums = { am_support: 0, am_care: 0, pm_support: 0, pm_care: 0, full_care: 0 };
      let n = 0;
      view.querySelectorAll('tr[data-row]').forEach((tr) => {
        const v = rowValues(tr);
        const entered = Object.values(v).some((x) => x !== null);
        if (entered) n++;
        for (const k of Object.keys(v)) sums[k] += v[k] || 0;
        tr.querySelectorAll('[data-total]').forEach((td) => { const p = td.dataset.total; td.textContent = entered ? (v[p + '_support'] || 0) + (v[p + '_care'] || 0) : ''; });
      });
      const line = (label, fn) => {
        let h = `<td class="name" colspan="2">${label}</td>`;
        for (const [s, c] of cols) h += `<td>${fn(sums[s])}</td><td>${fn(sums[c])}</td><td>${fn(sums[s] + sums[c])}</td>`;
        if (f.use_7h) h += `<td>${fn(sums.full_care)}</td>`;
        return h;
      };
      view.querySelector('#sum').innerHTML = line('合計', (x) => x);
      view.querySelector('#avg').innerHTML = line(`平均（営業${n}日）`, (x) => (n ? (x / n).toFixed(1) : '—'));
      const avg = (x) => (n ? x / n : null);
      const am = f.use_am ? avg(sums.am_support + sums.am_care) : null;
      const pm = f.use_pm ? avg(sums.pm_support + sums.pm_care) : null;
      const parts = [am, pm].filter((v) => v !== null);
      const h3 = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
      const cards = [['営業日数', `${n}<small>日</small>`, '']];
      if (f.use_am) cards.push(['午前平均', fmt(am), '']);
      if (f.use_pm) cards.push(['午後平均', fmt(pm), '']);
      cards.push(['3H平均', fmt(h3), 'main']);
      if (f.use_7h) cards.push(['7H平均', fmt(avg(sums.full_care)), 'main']);
      view.querySelector('#kpis').innerHTML = cards.map(([l, v, c]) => `<div class="ua-kpi ${c}"><span>${l}</span><b>${v}</b></div>`).join('');
    }
    recalc();

    const status = view.querySelector('#status');
    view.querySelector('tbody').addEventListener('change', async (ev) => {
      const input = ev.target.closest('input');
      if (!input) return;
      const tr = input.closest('tr');
      const v = rowValues(tr);
      if (Object.values(v).some((x) => x !== null && (!Number.isInteger(x) || x < 0 || x > 999))) {
        status.className = 'ua-status bad'; status.textContent = '0〜999の整数で入力してください'; return;
      }
      recalc();
      status.className = 'ua-status'; status.textContent = '保存中…';
      try {
        await api('/api/admin/usage/records', { method: 'PUT', body: { facility_id: f.id, date: tr.dataset.row, ...v } });
        status.textContent = '✓ 保存しました';
      } catch (e) { status.className = 'ua-status bad'; status.textContent = '保存できませんでした：' + e.message; }
    });
  }

  /* ---------- 集計 ---------- */
  async function renderSummary() {
    const year = S.month.slice(0, 4);
    const [{ summary }, { trend }] = await Promise.all([
      api(`/api/admin/usage/summary?month=${S.month}`),
      api(`/api/admin/usage/trend?facility_id=${S.facilityId}&year=${year}`),
    ]);
    const monthly = summary.map((s) => `<tr><td class="name">${esc(s.facility.name)}</td>
      <td class="r">${s.facility.cap_3h}</td><td class="r">${s.facility.cap_7h}</td><td class="r">${s.total.days}</td>
      <td class="r">${fmt(s.total.am)}</td><td class="r">${fmt(s.total.pm)}</td><td class="avg">${fmt(s.total.h3)}</td><td class="avg">${fmt(s.total.full)}</td></tr>`).join('');
    const weekly = summary.map((s) => `<tr><td class="name">${esc(s.facility.name)}</td>${[1, 2, 3, 4, 5, 6].map((w) => `<td class="r">${fmt(s.weekdays[w][S.metric])}</td>`).join('')}</tr>`).join('');
    const trendRows = trend.map((t) => `<tr><td class="name">${t.month}月</td><td class="r">${t.days}</td>
      <td class="r">${fmt(t.am)}</td><td class="r">${fmt(t.pm)}</td><td class="avg">${fmt(t.h3)}</td><td class="avg">${fmt(t.full)}</td></tr>`).join('');
    frame('summary', monthBar() + `
      <section class="card ua-sec"><div class="card-h"><h2>月次平均（全施設）</h2></div>
        <div class="tbl-wrap"><table class="t ua-t"><thead><tr><th>施設</th><th class="r">定員 3H</th><th class="r">定員 7H</th><th class="r">営業日数</th>
          <th class="r">午前</th><th class="r">午後</th><th class="r">3H平均</th><th class="r">7H</th></tr></thead><tbody>${monthly}</tbody></table></div>
        <p class="hint ua-pad">平均 ＝ 月の合計 ÷ 営業日数（入力がある日の数）。3H平均 ＝ 午前平均と午後平均の平均。</p></section>
      <section class="card ua-sec"><div class="card-h"><h2>曜日別平均（全施設）</h2><div style="flex:1"></div>
        <div class="ua-seg" id="metric" role="group" aria-label="区分">${METRICS.map(([k, l]) => `<button type="button" data-m="${k}" class="${k === S.metric ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="tbl-wrap"><table class="t ua-t"><thead><tr><th>施設</th>${[1, 2, 3, 4, 5, 6].map((w) => `<th class="r">${WD[w]}</th>`).join('')}</tr></thead><tbody>${weekly}</tbody></table></div></section>
      <section class="card ua-sec"><div class="card-h"><h2>月別推移（${year}年）</h2></div>
        <div class="ua-pad" style="padding-bottom:0">${facilityTabs()}</div>
        <div class="tbl-wrap"><table class="t ua-t"><thead><tr><th>月</th><th class="r">営業日数</th><th class="r">午前</th><th class="r">午後</th><th class="r">3H平均</th><th class="r">7H</th></tr></thead><tbody>${trendRows}</tbody></table></div></section>`);
    bindMonth(renderSummary);
    view.querySelector('#metric').addEventListener('click', (ev) => { const b = ev.target.closest('button[data-m]'); if (!b) return; S.metric = b.dataset.m; renderSummary(); });
    bindTabs(renderSummary);
  }

  /* ---------- 設定（本部） ---------- */
  async function renderSettings() {
    if (!S.hq) { location.hash = '#input'; return; }
    await loadFacilities();
    const chk = (v, k) => `<input type="checkbox" data-k="${k}" ${v ? 'checked' : ''}>`;
    frame('settings', `<section class="card ua-sec"><div class="card-h"><h2>施設と定員</h2></div>
      <div class="tbl-wrap"><table class="t ua-t"><thead><tr><th>施設名</th><th>定員 3H</th><th>定員 7H</th><th>午前</th><th>午後</th><th>7H</th><th></th></tr></thead>
      <tbody>${S.facilities.map((f) => `<tr data-id="${f.id}">
        <td><input class="inp sm" type="text" data-k="name" value="${esc(f.name)}" maxlength="50" aria-label="施設名" style="min-width:140px"></td>
        <td><input class="inp sm" type="number" data-k="cap_3h" value="${f.cap_3h}" min="0" max="999" style="width:80px" aria-label="定員3H"></td>
        <td><input class="inp sm" type="number" data-k="cap_7h" value="${f.cap_7h}" min="0" max="999" style="width:80px" aria-label="定員7H"></td>
        <td>${chk(f.use_am, 'use_am')}</td><td>${chk(f.use_pm, 'use_pm')}</td><td>${chk(f.use_7h, 'use_7h')}</td>
        <td><button class="btn sm pri" data-act="fac">保存</button></td></tr>`).join('')}</tbody></table></div>
      <p class="hint ua-pad">午前・午後・7Hのチェックを外すと、その区分は入力画面と集計から外れます。<br>
        施設名を社内システムの施設名（［職員・打刻端末］の施設名）と同じ表記にすると、その施設の施設長が入力できます。</p></section>
      <p class="err" id="e"></p>`);
    view.querySelector('tbody').addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button[data-act]');
      if (!btn) return;
      const tr = btn.closest('tr');
      const get = (k) => tr.querySelector(`[data-k="${k}"]`);
      const msg = view.querySelector('#e');
      try {
        await api(`/api/admin/usage/facilities/${tr.dataset.id}`, { method: 'PUT', body: {
          name: get('name').value, cap_3h: Number(get('cap_3h').value), cap_7h: Number(get('cap_7h').value),
          use_am: get('use_am').checked, use_pm: get('use_pm').checked, use_7h: get('use_7h').checked,
        } });
        await loadFacilities();
        msg.textContent = ''; UMW.toast('保存しました');
      } catch (e) { msg.textContent = e.message; }
    });
  }

  /* ---------- 起動 ---------- */
  async function route() {
    const v = location.hash.slice(1) || 'input';
    try {
      if (v === 'summary') await renderSummary();
      else if (v === 'settings') await renderSettings();
      else await renderInput();
    } catch (e) { view.innerHTML = `<div class="card card-b err">${esc(e.message)}</div>`; }
  }

  UMW.start({ active: 'usage', title: '延べ利用者数', admin: true }, async (me, v) => {
    view = v;
    await loadFacilities();
    if (!S.facilities.length) { view.innerHTML = '<div class="card empty">施設が登録されていません。</div>'; return; }
    view.addEventListener('click', (ev) => { const b = ev.target.closest('[data-view]'); if (b) location.hash = '#' + b.dataset.view; });
    window.addEventListener('hashchange', route);
    await route();
  });
})();
