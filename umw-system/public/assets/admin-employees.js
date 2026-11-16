(function () {
  'use strict';
  const { api, esc, av, toast, modal, confirmDialog, fmtDateTime } = UMW;

  UMW.start({ active: 'emp', title: '社員管理', admin: true }, async (me, view) => {
    let list = [];
    let q = '';
    let showInactive = false;

    view.innerHTML = `<div class="row" style="margin-bottom:14px">
        <input class="inp sm" id="q" placeholder="社員ID・氏名・部署で検索" style="max-width:260px">
        <label class="chk"><input type="checkbox" id="inactive">退職者・無効も表示</label>
        <div style="flex:1"></div>
        <button class="btn" id="csv">CSV出力</button>
        <button class="btn pri" id="add">＋ 社員を追加</button></div>
      <div class="card tbl-wrap" id="list"></div>
      <p class="hint">ワークフローの承認者は「部署」と「役職」の組み合わせで決まります。表記（例：営業部／課長）をそろえて登録してください。ワークフローの承認者になれるのは管理者のみです。</p>`;
    const $ = (id) => document.getElementById(id);

    async function load() {
      list = (await api('/api/admin/employees')).employees;
      render();
    }
    function render() {
      const w = q.toLowerCase();
      const rows = list.filter((e) => (showInactive || e.active) && (!w || [e.employee_code, e.name, e.dept, e.title].join(' ').toLowerCase().includes(w)));
      $('list').innerHTML = rows.length ? `<table class="t"><thead><tr><th>社員ID</th><th>氏名</th><th>部署</th><th>役職</th><th>権限</th><th>状態</th><th class="hide-sm">最終ログイン</th><th></th></tr></thead><tbody>
        ${rows.map((e) => `<tr>
          <td class="mono">${esc(e.employee_code)}</td>
          <td><div class="row" style="flex-wrap:nowrap">${av(e.name, e.id, 26)}<b>${esc(e.name)}</b></div></td>
          <td>${esc(e.dept)}</td><td>${esc(e.title)}</td>
          <td>${e.role === 'admin' ? '<span class="badge b-blue">管理者</span>' : '<span class="hint">一般</span>'}</td>
          <td>${!e.active ? '<span class="badge b-gray">無効</span>' : e.must_change_password ? '<span class="badge b-amber">初回PW未変更</span>' : '<span class="badge b-green">有効</span>'}</td>
          <td class="hide-sm hint">${e.last_login_at ? fmtDateTime(e.last_login_at) : '—'}</td>
          <td style="text-align:right;white-space:nowrap"><button class="btn sm" data-edit="${e.id}">編集</button></td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">該当する社員はいません</div>';
    }

    function showPassword(name, pw) {
      modal({
        title: '仮パスワード', size: 'sm',
        body: `<p>${esc(name)} さんの仮パスワードです。<b>この画面を閉じると再表示できません。</b>本人に安全な方法で伝えてください。</p>
               <div class="secret">${esc(pw)}</div><p class="hint">初回ログイン時にパスワードの変更が求められます。</p>`,
        foot: '<button class="btn pri" data-close>閉じました・控えました</button>',
      });
    }

    function editor(e) {
      const isNew = !e;
      e = e || { employee_code: '', name: '', dept: '', title: '', role: 'staff', active: 1 };
      const depts = [...new Set(list.map((x) => x.dept).filter(Boolean))];
      const titles = [...new Set(list.map((x) => x.title).filter(Boolean))];
      const self = !isNew && e.id === me.user.id;
      const dlg = modal({
        title: isNew ? '社員を追加' : '社員情報の編集',
        body: `<div class="grid g2">
            <label class="f"><span>社員ID（ログインID）<i class="req">*</i></span><input class="inp" id="e-code" value="${esc(e.employee_code)}" placeholder="例：A0012"></label>
            <label class="f"><span>氏名<i class="req">*</i></span><input class="inp" id="e-name" value="${esc(e.name)}"></label>
            <label class="f"><span>部署</span><input class="inp" id="e-dept" list="dl-d" value="${esc(e.dept)}"></label>
            <label class="f"><span>役職</span><input class="inp" id="e-title" list="dl-t" value="${esc(e.title)}" placeholder="例：担当、課長、部長"></label>
            <label class="f"><span>権限</span><select class="inp" id="e-role" ${self ? 'disabled' : ''}><option value="staff">一般（打刻・チャット）</option><option value="admin" ${e.role === 'admin' ? 'selected' : ''}>管理者（全機能）</option></select></label>
            ${isNew ? '' : `<label class="f"><span>状態</span><select class="inp" id="e-active" ${self ? 'disabled' : ''}><option value="1">有効</option><option value="0" ${e.active ? '' : 'selected'}>無効（退職など）</option></select></label>`}
          </div>
          <datalist id="dl-d">${depts.map((d) => `<option value="${esc(d)}">`).join('')}</datalist>
          <datalist id="dl-t">${titles.map((d) => `<option value="${esc(d)}">`).join('')}</datalist>
          ${isNew ? '<p class="hint">登録すると仮パスワードが発行されます。</p>' : `<div class="sec-t">アカウント操作</div><div class="row">
            <button class="btn warn" id="e-reset">仮パスワードを再発行</button><button class="btn" id="e-logout">強制ログアウト</button></div>
            <p class="hint">再発行すると、現在のパスワードは使えなくなり、ログイン中の端末もログアウトされます。ログインのロックも解除されます。</p>`}
          ${self ? '<p class="hint">自分自身の権限・状態は変更できません。</p>' : ''}
          <div class="err" id="e-err"></div>`,
        foot: '<button class="btn" data-close>キャンセル</button><button class="btn pri" id="e-save">保存</button>',
      });
      const v = (id) => dlg.querySelector('#' + id);
      v('e-save').onclick = async () => {
        const body = { employee_code: v('e-code').value.trim(), name: v('e-name').value.trim(), dept: v('e-dept').value.trim(), title: v('e-title').value.trim(), role: v('e-role').value };
        if (!isNew) body.active = v('e-active').value === '1';
        try {
          if (isNew) {
            const r = await api('/api/admin/employees', { method: 'POST', body });
            dlg.close();
            showPassword(body.name, r.temp_password);
          } else {
            await api('/api/admin/employees/' + e.id, { method: 'PUT', body });
            dlg.close();
            toast('保存しました');
          }
          await load();
        } catch (ex) { v('e-err').textContent = ex.message; }
      };
      if (!isNew) {
        v('e-reset').onclick = async () => {
          if (!(await confirmDialog('仮パスワードを再発行しますか？', `${e.name} さんの現在のパスワードは使えなくなります。`, '再発行する'))) return;
          try { const r = await api('/api/admin/employees/' + e.id, { method: 'POST', body: { action: 'reset_password' } }); dlg.close(); showPassword(e.name, r.temp_password); await load(); }
          catch (ex) { v('e-err').textContent = ex.message; }
        };
        v('e-logout').onclick = async () => {
          try { await api('/api/admin/employees/' + e.id, { method: 'POST', body: { action: 'logout' } }); toast(`${e.name} さんをログアウトさせました`); }
          catch (ex) { v('e-err').textContent = ex.message; }
        };
      }
    }

    $('q').oninput = (e) => { q = e.target.value; render(); };
    $('inactive').onchange = (e) => { showInactive = e.target.checked; render(); };
    $('add').onclick = () => editor(null);
    $('csv').onclick = () => UMW.downloadCsv(`社員一覧_${UMW.jstDate()}.csv`, [
      ['社員ID', '氏名', '部署', '役職', '権限', '状態'],
      ...list.map((e) => [e.employee_code, e.name, e.dept, e.title, e.role === 'admin' ? '管理者' : '一般', e.active ? '有効' : '無効']),
    ]);
    $('list').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-edit]');
      if (b) editor(list.find((x) => x.id === Number(b.dataset.edit)));
    });
    await load();
  });
})();
