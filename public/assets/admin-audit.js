(function () {
  'use strict';
  const { api, esc, fmtDateTime } = UMW;
  const LABEL = {
    'setup.admin_created': '初期管理者を作成', 'auth.login': 'ログイン（職員）', 'auth.login_admin': 'ログイン（管理者）', 'auth.logout': 'ログアウト',
    'auth.admin_denied': '管理者ログイン拒否', 'auth.password_changed': 'パスワード変更',
    'employee.create': '社員を追加', 'employee.update': '社員情報を変更', 'employee.reset_password': '仮パスワード再発行', 'employee.force_logout': '強制ログアウト',
    'attendance.edit': '勤怠を修正', 'chat.channel_create': 'チャンネル作成', 'chat.channel_update': 'チャンネル変更', 'chat.channel_archive': 'チャンネルをアーカイブ',
    'chat.message_deleted_by_admin': 'メッセージを管理者削除', 'wf.form_save': '申請書式を保存', 'wf.form_delete': '申請書式を削除', 'wf.route_save': '承認ルートを保存',
    'wf.route_delete': '承認ルートを削除', 'wf.submit': '申請', 'wf.approved': '承認', 'wf.returned': '差し戻し', 'wf.rejected': '却下', 'wf.withdrawn': '取り下げ',
  };

  UMW.start({ active: 'audit', title: '操作ログ', admin: true, hq: true }, async (me, view) => {
    view.innerHTML = `<div class="row" style="margin-bottom:14px"><input class="inp sm" id="q" placeholder="操作・対象・氏名で検索（例：attendance, auth.login）" style="max-width:340px">
      <button class="btn sm" id="go">検索</button><div style="flex:1"></div><span class="hint">最新300件を表示</span></div>
      <div class="card tbl-wrap" id="list"></div>`;
    const $ = (id) => document.getElementById(id);
    async function load() {
      const { logs } = await api('/api/admin/audit?q=' + encodeURIComponent($('q').value.trim()));
      $('list').innerHTML = logs.length ? `<table class="t"><thead><tr><th>日時</th><th>操作者</th><th>操作</th><th>対象</th><th class="hide-sm">詳細</th><th class="hide-sm">IP</th></tr></thead><tbody>
        ${logs.map((l) => `<tr><td class="num" style="white-space:nowrap">${fmtDateTime(l.at)}</td><td>${esc(l.actor_name || '—')}<div class="hint mono">${esc(l.actor_code || '')}</div></td>
          <td>${esc(LABEL[l.action] || l.action)}</td><td>${esc(l.target || '')}</td>
          <td class="hide-sm hint" style="max-width:360px;word-break:break-all">${esc(l.detail || '')}</td><td class="hide-sm hint mono">${esc(l.ip || '')}</td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">ログがありません</div>';
    }
    $('go').onclick = load;
    $('q').onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing) load(); };
    await load();
  });
})();
