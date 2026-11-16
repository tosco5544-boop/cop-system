(function () {
  'use strict';
  const { api, esc, toast, fmtTime, jstDate, WD, weekday, hm, daysOfMonth, workMinutes, overMinutes } = UMW;
  const STATE = {
    off: ['未出勤', 'gray'], working: ['勤務中', 'green'], break: ['休憩中', 'amber'], done: ['退勤済み', 'blue'],
  };

  UMW.start({ active: 'punch', title: '打刻・勤怠履歴' }, async (me, view) => {
    view.innerHTML = `
      <div class="grid g2">
        <div class="card punch-card">
          <div class="clock-date" id="cdate"></div>
          <div class="clock" id="clock">--:--</div>
          <div class="state" id="state"></div>
          <div class="punch-btns">
            <button class="pbtn in" data-p="in" disabled>出勤</button>
            <button class="pbtn out" data-p="out" disabled>退勤</button>
            <button class="pbtn br" data-p="break_start" disabled>休憩開始</button>
            <button class="pbtn br" data-p="break_end" disabled>休憩終了</button>
          </div>
          <div class="err" id="perr" style="margin-top:12px"></div>
        </div>
        <div class="card"><div class="card-h"><h2>本日の記録</h2></div><div class="card-b" id="today"></div></div>
      </div>
      <div class="card" style="margin-top:20px">
        <div class="card-h"><h2>勤怠履歴</h2><div style="flex:1"></div>
          <button class="btn sm ghost" id="prev">‹ 前月</button><input type="month" class="inp sm" id="ym" style="width:auto"><button class="btn sm ghost" id="next">翌月 ›</button></div>
        <div class="tbl-wrap" id="month"></div>
      </div>
      <p class="hint">打刻の修正が必要な場合は管理者に連絡してください。</p>`;

    const $ = (id) => document.getElementById(id);
    let offset = 0; // サーバー時刻との差
    const tick = () => {
      const d = new Date(Date.now() + offset);
      $('clock').textContent = d.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const ymd = jstDate(d);
      $('cdate').textContent = `${ymd.replace(/-/g, '/')}（${WD[weekday(ymd)]}）`;
    };
    tick();
    setInterval(tick, 1000);

    function showToday(r) {
      offset = Date.parse(r.server_time) - Date.now();
      const st = STATE[r.state];
      $('state').innerHTML = `<span class="badge b-${st[1]}">${st[0]}</span>`;
      const en = { in: r.state === 'off', break_start: r.state === 'working', break_end: r.state === 'break', out: r.state === 'working' || r.state === 'break' };
      document.querySelectorAll('[data-p]').forEach((b) => { b.disabled = !en[b.dataset.p]; });
      const d = r.day;
      const w = workMinutes(d);
      $('today').innerHTML = d && d.clock_in ? `<div class="kv">
          <div class="k">勤務日</div><div class="v">${esc(d.work_date)}</div>
          <div class="k">出勤</div><div class="v num">${fmtTime(d.clock_in)}</div>
          <div class="k">退勤</div><div class="v num">${d.clock_out ? fmtTime(d.clock_out) : '—'}</div>
          <div class="k">休憩</div><div class="v num">${hm(d.break_minutes)}${d.break_start ? `（${fmtTime(d.break_start)}から休憩中）` : ''}</div>
          <div class="k">実働</div><div class="v num">${w == null ? '—' : hm(w)}</div>
        </div>` : '<div class="empty">まだ出勤していません</div>';
    }

    async function loadToday() {
      try { showToday(await api('/api/attendance/today')); }
      catch (e) { $('perr').textContent = e.message; }
    }

    document.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', async () => {
      $('perr').textContent = '';
      document.querySelectorAll('[data-p]').forEach((x) => { x.disabled = true; });
      try {
        const r = await api('/api/attendance/punch', { method: 'POST', body: { type: b.dataset.p } });
        toast(`${r.message}（${fmtTime(r.server_time)}）`);
        showToday(r);
        loadMonth();
      } catch (e) {
        $('perr').textContent = e.message;
        loadToday();
      }
    }));

    const ymEl = $('ym');
    ymEl.value = jstDate().slice(0, 7);
    const shift = (n) => {
      const [y, m] = ymEl.value.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1 + n, 1));
      ymEl.value = d.toISOString().slice(0, 7);
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
            <td class="num r">${w && overMinutes(w) ? hm(overMinutes(w)) : ''}</td>
            <td class="hint">${esc(d ? d.note : '')}${d && d.modified_by ? ' <span class="tag">修正あり</span>' : ''}</td></tr>`;
        }).join('');
        box.innerHTML = `<table class="t"><thead><tr><th>日</th><th>曜</th><th>出勤</th><th>退勤</th><th class="r">休憩</th><th class="r">実働</th><th class="r">残業</th><th>備考</th></tr></thead>
          <tbody>${rows}</tbody><tfoot><tr><td colspan="2">合計</td><td colspan="3">出勤 ${cnt}日</td><td class="num r">${hm(total)}</td><td class="num r">${hm(over)}</td><td></td></tr></tfoot></table>`;
      } catch (e) { box.innerHTML = `<div class="card-b err">${esc(e.message)}</div>`; }
    }

    await loadToday();
    await loadMonth();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadToday(); });
  });
})();
