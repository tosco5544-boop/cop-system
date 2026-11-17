(function () {
  'use strict';
  const root = document.getElementById('root');
  const esc = UMW.esc;

  UMW.api('/api/setup', { noRedirect: true }).then((st) => {
    if (!st.needed) {
      root.innerHTML = `<div class="login-wrap"><div class="card login"><h1>初期設定は完了しています</h1>
        <p class="sub">最初の管理者はすでに登録されています。</p><a class="btn pri block" href="/admin/login.html">管理者ログインへ</a></div></div>`;
      return;
    }
    root.innerHTML = `<div class="login-wrap"><form class="card login" id="f" style="width:min(460px,100%)">
      <div class="brand-mark">UMW</div><h1>初期設定</h1><p class="sub">最初の管理者アカウントを作成します</p>
      ${st.token_configured ? '' : '<div class="note">Cloudflare の環境変数 <b>SETUP_TOKEN</b> が未設定です。設定してから再デプロイしてください。</div>'}
      <label class="f"><span>セットアップトークン<i class="req">*</i></span><input class="inp" type="password" name="token" required></label>
      <label class="f"><span>社員ID<i class="req">*</i></span><input class="inp" name="employee_code" required placeholder="例：A0001"></label>
      <label class="f"><span>氏名<i class="req">*</i></span><input class="inp" name="name" required></label>
      <div class="grid g2"><label class="f"><span>部署</span><input class="inp" name="dept"></label><label class="f"><span>役職</span><input class="inp" name="title"></label></div>
      <label class="f"><span>パスワード<i class="req">*</i></span><input class="inp" type="password" name="password" autocomplete="new-password" required></label>
      <p class="hint" style="margin-top:-6px">8文字以上・英字と数字を含む</p>
      <div class="err" id="err" style="margin-bottom:10px"></div>
      <button class="btn pri block" type="submit">管理者を作成</button></form></div>`;
    const f = document.getElementById('f');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = document.getElementById('err');
      err.textContent = '';
      const body = Object.fromEntries(new FormData(f).entries());
      try {
        await UMW.api('/api/setup', { method: 'POST', noRedirect: true, body });
        root.innerHTML = `<div class="login-wrap"><div class="card login"><h1>作成しました</h1>
          <p class="sub">${esc(body.name)} さんを管理者として登録しました。安全のため、Cloudflare の SETUP_TOKEN は削除して構いません。</p>
          <a class="btn pri block" href="/admin/login.html">管理者ログインへ</a></div></div>`;
      } catch (ex) { err.textContent = ex.message; }
    });
  }).catch((e) => { root.innerHTML = `<div class="loading err">${esc(e.message)}</div>`; });
})();
