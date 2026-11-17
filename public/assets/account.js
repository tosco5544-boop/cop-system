(function () {
  'use strict';
  const force = new URLSearchParams(location.search).get('force') === '1';
  UMW.start({ active: '', title: 'パスワード変更', allowMustChange: true }, async (me, view) => {
    const mustChange = me.user.must_change_password;
    view.innerHTML = `
      ${mustChange || force ? '<div class="note">初回ログインまたはパスワード再発行後のため、新しいパスワードを設定してください。</div>' : ''}
      <div class="card" style="max-width:480px"><div class="card-h"><h2>パスワード変更</h2></div><div class="card-b">
        <form id="pw-form">
          <label class="f"><span>現在のパスワード（仮パスワード）</span><input class="inp" type="password" name="current" autocomplete="current-password" required></label>
          <label class="f"><span>新しいパスワード</span><input class="inp" type="password" name="new_password" autocomplete="new-password" required minlength="8"></label>
          <label class="f"><span>新しいパスワード（確認）</span><input class="inp" type="password" name="confirm" autocomplete="new-password" required></label>
          <p class="hint" style="margin-top:-6px">8文字以上で、英字と数字を両方含めてください。変更すると他の端末ではログアウトされます。</p>
          <div class="err" id="err" style="margin-bottom:10px"></div>
          <button class="btn pri" type="submit">変更する</button>
        </form>
      </div></div>`;
    const f = document.getElementById('pw-form');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = document.getElementById('err');
      err.textContent = '';
      if (f.new_password.value !== f.confirm.value) { err.textContent = '確認用のパスワードが一致しません'; return; }
      try {
        await UMW.api('/api/auth/password', { method: 'POST', body: { current: f.current.value, new_password: f.new_password.value } });
        UMW.toast('パスワードを変更しました');
        setTimeout(() => { location.href = me.access && me.access.office ? '/office/attendance.html' : '/punch.html'; }, 800);
      } catch (ex) { err.textContent = ex.message; }
    });
  });
})();
