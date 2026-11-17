(function () {
  'use strict';
  const portal = document.body.dataset.portal; // staff | admin
  const home = '/office/attendance.html';
  const params = new URLSearchParams(location.search);
  const next = params.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;

  // すでに同じ入口でログイン済みならそのまま移動
  UMW.api('/api/auth/me', { noRedirect: true })
    .then((me) => { if (me.scope === portal) location.replace(safeNext || home); })
    .catch(() => {});

  const form = document.getElementById('login-form');
  const err = document.getElementById('err');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const r = await UMW.api('/api/auth/login', {
        method: 'POST',
        noRedirect: true,
        body: { employee_code: form.employee_code.value.trim(), password: form.password.value, portal },
      });
      if (r.must_change_password) location.href = '/account.html?force=1';
      else location.href = safeNext || home;
    } catch (ex) {
      err.textContent = ex.message;
      form.password.value = '';
      form.password.focus();
    } finally {
      btn.disabled = false;
    }
  });
})();
