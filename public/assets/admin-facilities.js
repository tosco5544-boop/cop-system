(function () {
  'use strict';
  const { api, esc, toast, modal, confirmDialog, fmtDateTime } = UMW;
  const TITLES = ['介護職員', '看護師', '生活相談員', 'ケアマネジャー', '機能訓練指導員', '事務', '調理員', '運転手'];

  UMW.start({ active: 'fac', title: '職員・打刻端末', office: true }, async (me, view) => {
    const hq = !!me.access.hq;
    if (me.access.facility) document.querySelector('.top h1').textContent = `職員・打刻端末（${me.access.facility}）`;
    let D = { facilities: [], unassigned: [] };
    let q = '';
    view.innerHTML = `
      <div class="note info">施設の打刻用パソコンを「打刻端末」に登録すると、職員はログインせずに自分の氏名をクリックして打刻できます。
        職員を追加するには、施設の欄に<b>氏名を1行に1人ずつ</b>入力して「追加」を押すだけです。${hq ? '<br>施設長は［社員管理］で、部署＝施設名・役職＝施設長・権限＝管理者として登録すると、その施設の打刻端末の先頭に表示され、同じように打刻できます。' : ''}</div>
      <div class="row" style="margin-bottom:14px">
        <input class="inp sm" id="q" placeholder="施設名・氏名で絞り込み" style="max-width:260px">
        <div style="flex:1"></div>${hq ? '<button class="btn" id="add-fac">＋ 施設を追加</button>' : ''}</div>
      <datalist id="dl-titles">${TITLES.map((t) => `<option value="${t}">`).join('')}</datalist>
      <div class="fac-grid" id="list"></div>`;
    const $ = (id) => document.getElementById(id);

    async function load() { D = await api('/api/office/facilities'); render(); }
    const coList = () => `<datalist id="dl-co">${[...new Set(['G社', 'T社', 'F社', ...D.facilities.map((f) => f.company).filter(Boolean)])].map((c) => `<option value="${esc(c)}">`).join('')}</datalist>`;

    function render() {
      const w = q.trim().toLowerCase();
      const coOrder = [...new Set(D.facilities.map((f) => f.company || ''))];
      const list = D.facilities.slice().sort((a, b) => coOrder.indexOf(a.company || '') - coOrder.indexOf(b.company || '')).filter((f) => !w || f.name.toLowerCase().includes(w) || f.employees.some((e) => e.name.toLowerCase().includes(w)));
      let lastCo = null;
      $('list').innerHTML = list.map((f) => {
        const co = f.company || '（会社未設定）';
        const head = !me.access.facility && co !== lastCo ? `<h3 class="co-h">${esc(co)}</h3>` : '';
        lastCo = co;
        return head + `<div class="card fac ${f.active ? '' : 'off'}" data-fac="${f.id}">
        <div class="card-h"><h2>${esc(f.name)}</h2><span class="tag">${f.employees.length}名</span>${f.active ? '' : '<span class="badge b-gray">休止中</span>'}
          <div style="flex:1"></div>${hq ? `<button class="btn sm ghost" data-rename="${f.id}">名前変更</button>` : ''}</div>
        <div class="card-b">
          <div class="chips">${f.employees.map((e) => `<span class="chip" title="${esc(e.employee_code)}${e.role === 'admin' ? '・管理者' : ''}">${esc(e.name)}${e.title ? `<small>${esc(e.title)}</small>` : ''}${e.role === 'admin' ? '<small class="adm">管理者</small>' : `${e.is_clerk ? '<small class="adm">事務員</small>' : ''}<button data-retire="${e.id}" aria-label="${esc(e.name)}を外す">×</button>`}</span>`).join('') || '<span class="hint">まだ職員がいません</span>'}</div>
          <div class="add-box">
            <textarea class="inp" data-names="${f.id}" rows="3" placeholder="氏名を1行に1人ずつ入力&#10;例）静岡 花子&#10;　　駿河 一郎"></textarea>
            <div class="row"><input class="inp sm" data-title="${f.id}" list="dl-titles" placeholder="職種（任意）" style="max-width:180px"><div style="flex:1"></div><button class="btn pri sm" data-add="${f.id}">追加</button></div>
          </div>
          <div class="sec-t" style="margin-top:16px">打刻端末</div>
          ${f.kiosks.length ? f.kiosks.map((k) => `<div class="row kiosk-row"><span>🖥️ ${esc(k.name)}</span><span class="hint">登録 ${fmtDateTime(k.created_at)}・最終利用 ${k.last_seen_at ? fmtDateTime(k.last_seen_at) : '—'}</span><div style="flex:1"></div><button class="btn sm ng" data-revoke="${k.id}">解除</button></div>`).join('') : '<div class="hint">登録された端末はありません</div>'}
          ${f.active ? `<button class="btn sm" data-register="${f.id}" style="margin-top:10px">この端末を「${esc(f.name)}」の打刻端末にする</button>` : ''}
        </div></div>`;
      }).join('') || '<div class="card empty">該当する施設はありません</div>';
      if (D.unassigned.length && !w) {
        $('list').insertAdjacentHTML('beforeend', `<div class="card fac"><div class="card-h"><h2>施設に所属していない社員</h2></div><div class="card-b">
          <p class="hint" style="margin-top:0">部署が施設名と一致していない社員です。社員管理で部署を施設名に合わせると打刻端末に表示されます。</p>
          <div class="chips">${D.unassigned.map((e) => `<span class="chip">${esc(e.name)}<small>${esc(e.dept || '部署なし')}</small></span>`).join('')}</div></div></div>`);
      }
    }

    async function addStaff(fid, allowDup) {
      const ta = document.querySelector(`[data-names="${fid}"]`);
      const title = document.querySelector(`[data-title="${fid}"]`).value.trim();
      if (!ta.value.trim()) { toast('氏名を入力してください', true); ta.focus(); return; }
      try {
        const r = await api(`/api/office/facilities/${fid}/staff`, { method: 'POST', body: { names: ta.value, title, allow_duplicate: !!allowDup } });
        toast(`${r.added.length}名を追加しました`);
        await load();
      } catch (e) {
        if (e.status === 409 && e.data && e.data.duplicates) {
          if (await confirmDialog('同じ氏名の職員がいます', `${e.data.duplicates.join('、')} はすでに登録されています。\n同姓同名の別の人として追加しますか？`, '追加する', false)) addStaff(fid, true);
        } else toast(e.message, true);
      }
    }

    view.addEventListener('click', async (ev) => {
      const t = ev.target;
      const add = t.closest('[data-add]');
      if (add) return addStaff(Number(add.dataset.add));
      const ret = t.closest('[data-retire]');
      if (ret) {
        const emp = D.facilities.flatMap((f) => f.employees).find((x) => x.id === Number(ret.dataset.retire));
        if (!(await confirmDialog(`${emp.name} さんを外しますか？`, '打刻端末に表示されなくなります（退職・異動など）。\nこれまでの勤怠記録は残ります。本部の社員管理から戻せます。', '外す'))) return;
        try { await api('/api/office/staff/' + emp.id, { method: 'POST', body: { action: 'retire' } }); toast('外しました'); await load(); }
        catch (e) { toast(e.message, true); }
        return;
      }
      const rn = t.closest('[data-rename]');
      if (rn) {
        const f = D.facilities.find((x) => x.id === Number(rn.dataset.rename));
        const dlg = modal({
          title: '施設の設定', size: 'sm',
          body: `<label class="f"><span>施設名</span><input class="inp" id="fn" value="${esc(f.name)}"></label>
                 <label class="f"><span>会社</span><input class="inp" id="fc" list="dl-co" value="${esc(f.company || '')}" placeholder="例：G社、T社、F社"></label>${coList()}
                 <label class="chk"><input type="checkbox" id="fa" ${f.active ? 'checked' : ''}>利用中（外すと休止。打刻端末も使えなくなります）</label>
                 <p class="hint">名前を変えると、所属する社員の「部署」もまとめて変わります。ワークフローの承認者もこの名前で探します。</p><div class="err" id="fe"></div>`,
          foot: '<button class="btn" data-close>キャンセル</button><button class="btn pri" id="fs">保存</button>',
        });
        dlg.querySelector('#fs').onclick = async () => {
          try { await api('/api/admin/facilities/' + f.id, { method: 'PUT', body: { name: dlg.querySelector('#fn').value, company: dlg.querySelector('#fc').value, active: dlg.querySelector('#fa').checked } }); dlg.close(); toast('保存しました'); await load(); }
          catch (e) { dlg.querySelector('#fe').textContent = e.message; }
        };
        return;
      }
      const rv = t.closest('[data-revoke]');
      if (rv) {
        if (!(await confirmDialog('この端末の登録を解除しますか？', '解除した端末では打刻できなくなります（紛失・入れ替えのとき）。', '解除する'))) return;
        try { await api('/api/office/kiosks/' + rv.dataset.revoke, { method: 'DELETE' }); toast('解除しました'); await load(); }
        catch (e) { toast(e.message, true); }
        return;
      }
      const rg = t.closest('[data-register]');
      if (rg) {
        const f = D.facilities.find((x) => x.id === Number(rg.dataset.register));
        const dlg = modal({
          title: `打刻端末の登録：${f.name}`, size: 'sm',
          body: `<p style="margin-top:0">いま操作している<b>この端末</b>を「${esc(f.name)}」の打刻端末にします。</p>
                 <label class="f"><span>端末の名前（管理用）</span><input class="inp" id="kn" value="${esc(f.name)}の打刻用PC"></label>
                 <ul class="hint" style="padding-left:1.2em"><li>登録すると、安全のためあなたは自動でログアウトし、打刻画面に切り替わります。</li>
                 <li>施設の打刻用パソコンで操作してください。登録はこのブラウザだけに有効です（別のブラウザやシークレットウィンドウでは使えません）。</li><li>間違えて自分のパソコンで登録した場合は、下の一覧から解除できます。</li></ul>`,
          foot: '<button class="btn" data-close>キャンセル</button><button class="btn pri" id="kr">登録して打刻画面へ</button>',
        });
        dlg.querySelector('#kr').onclick = async () => {
          try { await api('/api/office/kiosks', { method: 'POST', body: { facility_id: f.id, name: dlg.querySelector('#kn').value } }); location.href = '/kiosk.html'; }
          catch (e) { toast(e.message, true); }
        };
        return;
      }
      if (t.closest('#add-fac')) {
        const dlg = modal({ title: '施設を追加', size: 'sm', body: `<label class="f"><span>施設名</span><input class="inp" id="nf" placeholder="例：金谷"></label><label class="f"><span>会社</span><input class="inp" id="nc" list="dl-co" value="${esc((D.facilities[0] || {}).company || '')}" placeholder="例：G社、T社、F社"></label>${coList()}<div class="err" id="ne"></div>`, foot: '<button class="btn" data-close>キャンセル</button><button class="btn pri" id="ns">追加</button>' });
        dlg.querySelector('#ns').onclick = async () => {
          try { await api('/api/admin/facilities', { method: 'POST', body: { name: dlg.querySelector('#nf').value, company: dlg.querySelector('#nc').value } }); dlg.close(); toast('追加しました'); await load(); }
          catch (e) { dlg.querySelector('#ne').textContent = e.message; }
        };
      }
    });
    $('q').oninput = (e) => { q = e.target.value; render(); };
    await load();
  });
})();
