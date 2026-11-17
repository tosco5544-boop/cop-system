(function () {
  'use strict';
  const { api, esc, toast, fmtTime, jstDate, WD, weekday, hm, daysOfMonth, workMinutes, overMinutes } = UMW;
  const STATE = {
    off: ['未出勤', 'gray'], working: ['勤務中', 'green'], break: ['休憩中', 'amber'], done: ['退勤済み', 'blue'],
  };
  // 休憩時間の選択肢（分）。サーバー側（src/api/attendance/punch.js の BREAK_OPTIONS）と合わせてください
  const BREAKS = [0, 15, 30, 45, 60, 90];

  UMW.start({ active: 'punch', title: '打刻・勤怠履歴' }, async (me, view) => {
    view.innerHTML = `
      <div class="card punch-hero">
        <div class="who-big"><span class="name">${esc(me.user.name)}</span><span class="san">さん</span></div>
        <div class="who-dept">${esc([me.user.dept, me.user.title].filter(Boolean).join('・'))}</div>
        <div class="clock-date" id="cdate"></div>
        <div class="clock" id="clock">--:--</div>
        <div class="state" id="state"></div>
        <div class="punch-main">
          <button class="pbtn in" data-p="in" disabled>出勤</button>
          <button class="pbtn out" data-p="out" disabled>退勤</button>
        </div>
        <div class="break-box">
          <div class="break-h">休憩時間<span>クリックで選択（退勤後も当日中は変更できます）</span></div>
          <div class="break-opts">${BREAKS.map((m) => `<button class="bopt" data-b="${m}" disabled>${m ? m + '<small>分</small>' : 'なし'}</button>`).join('')}</div>
        </div>
        <div class="today-line" id="today"></div>
        <div class="err" id="perr"></div>
      </div>
      <div class="card" style="margin-top:20px">
        <div class="card-h"><h2>勤怠履歴</h2><div style="flex:1"></div>
          <button class="btn sm ghost" id="prev">‹ 前月</button><input type="month" class="inp sm" id="ym" style="width:auto"><button class="btn sm ghost" id="next">翌月 ›</button></div>
        <div class="tbl-wrap" id="month"></div>
      </div>
      <p class="hint">打刻の修正が必要な場合は施設長・管理者に連絡してください。</p>`;

    const $ = (id) => document.getElementById(id);
    let offset = 0; // サーバー時刻との差
    let last = null;
    const tick = () => {
      const d = new Date(Date.now() + offset);
      $('clock').textContent = d.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const ymd = jstDate(d);
      $('cdate').textContent = `${ymd.replace(/-/g, '/')}（${WD[weekday(ymd)]}）`;
    };
    tick();
    setInterval(tick, 1000);

    function showToday(r) {
      last = r;
      offset = Date.parse(r.server_time) - Date.now();
      const st = STATE[r.state];
      $('state').innerHTML = `<span class="badge b-${st[1]}">${st[0]}</span>`;
      const d = r.day;
      document.querySelector('[data-p="in"]').disabled = r.state !== 'off';
      document.querySelector('[data-p="out"]').disabled = !(r.state === 'working' || r.state === 'break');
      const canBreak = !!(d && d.clock_in) && (r.state !== 'done' || d.work_date === r.today);
      document.querySelectorAll('[data-b]').forEach((b) => {
        b.disabled = !canBreak;
        b.classList.toggle('on', canBreak && d.break_minutes === Number(b.dataset.b));
      });
      const w = workMinutes(d);
      $('today').innerHTML = d && d.clock_in
        ? `<span>出勤 <b>${fmtTime(d.clock_in)}</b></span><span>退勤 <b>${d.clock_out ? fmtTime(d.clock_out) : '—'}</b></span><span>休憩 <b>${d.break_minutes ? d.break_minutes + '分' : 'なし'}</b></span><span>実働 <b>${w == null ? '—' : hm(w)}</b></span>`
        : '<span>まだ出勤していません。出勤ボタンを押してください。</span>';
    }

    async function loadToday() {
      try { showToday(await api('/api/attendance/today')); }
      catch (e) { $('perr').textContent = e.message; }
    }

    async function send(body) {
      $('perr').textContent = '';
      document.querySelectorAll('[data-p],[data-b]').forEach((x) => { x.disabled = true; });
      try {
        const r = await api('/api/attendance/punch', { method: 'POST', body });
        toast(body.type === 'break' ? r.message : `${r.message}（${fmtTime(r.server_time)}）`);
        showToday(r);
        loadMonth();
      } catch (e) {
        $('perr').textContent = e.message;
        loadToday();
      }
    }

    document.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', async () => {
      const type = b.dataset.p;
      if (type === 'out' && last && last.day && !last.day.break_minutes) {
        if (!(await UMW.confirmDialog('休憩時間が「なし」です', '休憩なしで退勤しますか？\n休憩を取った場合は「キャンセル」を押して、休憩時間を選んでから退勤してください。', '休憩なしで退勤', false))) return;
      }
      send({ type });
    }));
    document.querySelectorAll('[data-b]').forEach((b) => b.addEventListener('click', () => send({ type: 'break', minutes: Number(b.dataset.b) })));

    const ymEl = $('ym');
    ymEl.value = jstDate().slice(0, 7);
    const shift = (n) => {
      const [y, m] = ymEl.value.split('-').map(Number);
      ymEl.value = new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
      loadMonth();
    };
    $('prev').onclick = () => shift(-1);
    $('next').onclick = () => shift(1);
    ymEl.onchange = loadMonth;

    async function loadMonth() {
      const ym = ymEl.value;
      if (!ym) return;
      const box = $('month');
      try {
        const { days } = await api('/api/attendance/month?ym=' + ym);
        const map = new Map(days.map((d) => [d.work_date, d]));
        const today = jstDate();
        let total = 0, over = 0, cnt = 0;
        const rows = daysOfMonth(ym).map((ymd) => {
          const d = map.get(ymd);
          const w = workMinutes(d);
          if (d && d.clock_in) cnt++;
          if (w != null) { total += w; over += overMinutes(w); }
          const wd = weekday(ymd);
          const missing = d && d.clock_in && !d.clock_out && ymd < today;
          return `<tr class="${wd === 0 ? 'sun' : wd === 6 ? 'sat' : ''} ${ymd === today ? 'today' : ''}">
            <td class="num">${Number(ymd.slice(8))}</td><td>${WD[wd]}</td>
            <td class="num">${d ? fmtTime(d.clock_in) : ''}</td>
            <td class="num">${d && d.clock_out ? fmtTime(d.clock_out) : missing ? '<span class="badge b-red">打刻漏れ</span>' : ''}</td>
            <td class="num r">${d && d.clock_in ? hm(d.break_minutes) : ''}</td>
            <td class="num r">${w == null ? '' : hm(w)}</td>
            <td class="num r hide-sm">${w && overMinutes(w) ? hm(overMinutes(w)) : ''}</td>
            <td class="hint hide-sm">${esc(d ? d.note : '')}${d && d.modified_by ? ' <span class="tag">修正あり</span>' : ''}</td></tr>`;
        }).join('');
        box.innerHTML = `<table class="t"><thead><tr><th>日</th><th>曜</th><th>出勤</th><th>退勤</th><th class="r">休憩</th><th class="r">実働</th><th class="r hide-sm">残業</th><th class="hide-sm">備考</th></tr></thead>
          <tbody>${rows}</tbody><tfoot><tr><td colspan="2">合計</td><td colspan="3">出勤 ${cnt}日</td><td class="num r">${hm(total)}</td><td class="num r hide-sm">${hm(over)}</td><td class="hide-sm"></td></tr></tfoot></table>`;
      } catch (e) { box.innerHTML = `<div class="card-b err">${esc(e.message)}</div>`; }
    }

    await loadToday();
    await loadMonth();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadToday(); });
  });
})();
