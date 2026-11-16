(function () {
  'use strict';
  const { api, esc, toast, modal, fmtTime, jstDate, WD, weekday, hm, daysOfMonth, workMinutes, overMinutes } = UMW;

  UMW.start({ active: 'att-admin', title: '勤怠管理', admin: true }, async (me, view) => {
    let D = { employees: [], days: [], today: jstDate() };
    let q = '';

    view.innerHTML = `<div class="row" style="margin-bottom:14px">
        <button class="btn sm ghost" id="prev">‹ 前月</button><input type="month" class="inp sm" id="ym" style="width:auto"><button class="btn sm ghost" id="next">翌月 ›</button>
        <input class="inp sm" id="q" placeholder="社員ID・氏名・部署で絞り込み" style="max-width:240px">
        <div style="flex:1"></div>
        <button class="btn" id="csv-sum">月次集計CSV</button><button class="btn" id="csv-day">日別明細CSV</button></div>
      <div class="grid g4" style="margin-bottom:16px" id="stats"></div>
      <div class="card tbl-wrap" id="sum"></div>
      <p class="hint">残業は「1日8時間を超えた実働」の単純合計です。就業規則（変形労働時間制・休日出勤など）に合わせた集計が必要な場合は調整してください。</p>`;
    const $ = (id) => document.getElementById(id);
    const ymEl = $('ym');
    ymEl.value = jstDate().slice(0, 7);

    const byEmp = () => {
      const m = new Map(D.employees.map((e) => [e.id, []]));
      for (const d of D.days) { if (!m.has(d.employee_id)) m.set(d.employee_id, []); m.get(d.employee_id).push(d); }
      return m;
    };
    const isMissing = (d) => d.clock_in && !d.clock_out && d.work_date < D.today;
    function summarize(days) {
      let work = 0, over = 0, cnt = 0, missing = 0;
      for (const d of days) {
        if (d.clock_in) cnt++;
        const w = workMinutes(d);
        if (w != null) { work += w; over += overMinutes(w); }
        if (isMissing(d)) missing++;
      }
      return { work, over, cnt, missing };
    }

    async function load() {
      D = await api('/api/admin/attendance/days?ym=' + ymEl.value);
      render();
    }

    function render() {
      const m = byEmp();
      const w = q.toLowerCase();
      const emps = D.employees.filter((e) => !w || [e.employee_code, e.name, e.dept].join(' ').toLowerCase().includes(w));
      const today = D.today;
      const working = D.days.filter((d) => d.work_date >= UMW.jstDate(new Date(Date.now() - 86400000)) && d.clock_in && !d.clock_out && !isMissing(d)).length;
      const todayIn = D.days.filter((d) => d.work_date === today && d.clock_in).length;
      const all = summarize(D.days);
      $('stats').innerHTML = ymEl.value === today.slice(0, 7)
        ? `<div class="card stat"><div class="k">本日の出勤者</div><div class="v">${todayIn}<small>人</small></div></div>
           <div class="card stat"><div class="k">現在勤務中</div><div class="v">${working}<small>人</small></div></div>
           <div class="card stat ${all.missing ? 'hl' : ''}"><div class="k">打刻漏れ（退勤なし）</div><div class="v">${all.missing}<small>件</small></div></div>
           <div class="card stat"><div class="k">今月の残業合計</div><div class="v num" style="font-size:26px">${hm(all.over)}</div></div>`
        : `<div class="card stat"><div class="k">延べ出勤日数</div><div class="v">${all.cnt}<small>日</small></div></div>
           <div class="card stat"><div class="k">実働合計</div><div class="v num" style="font-size:26px">${hm(all.work)}</div></div>
           <div class="card stat ${all.missing ? 'hl' : ''}"><div class="k">打刻漏れ</div><div class="v">${all.missing}<small>件</small></div></div>
           <div class="card stat"><div class="k">残業合計</div><div class="v num" style="font-size:26px">${hm(all.over)}</div></div>`;
      $('sum').innerHTML = emps.length ? `<table class="t"><thead><tr><th>社員ID</th><th>氏名</th><th class="hide-sm">部署</th><th class="r">出勤日数</th><th class="r">実働合計</th><th class="r">残業(8h超)</th><th>打刻漏れ</th><th>本日</th></tr></thead><tbody>
        ${emps.map((e) => {
          const days = m.get(e.id) || [];
          const s = summarize(days);
          const td = days.find((d) => d.work_date === today);
          const st = !td || !td.clock_in ? '<span class="hint">—</span>' : td.clock_out ? `<span class="badge b-blue">退勤 ${fmtTime(td.clock_out)}</span>` : td.break_start ? '<span class="badge b-amber">休憩中</span>' : `<span class="badge b-green">出勤 ${fmtTime(td.clock_in)}</span>`;
          return `<tr class="click" data-emp="${e.id}"><td class="mono">${esc(e.employee_code)}</td><td><b>${esc(e.name)}</b>${e.active ? '' : ' <span class="tag">無効</span>'}</td><td class="hide-sm">${esc(e.dept)}</td>
            <td class="num r">${s.cnt}</td><td class="num r">${hm(s.work)}</td><td class="num r">${s.over ? hm(s.over) : ''}</td>
            <td>${s.missing ? `<span class="badge b-red">${s.missing}件</span>` : ''}</td><td>${st}</td></tr>`;
        }).join('')}</tbody></table>` : '<div class="empty">該当する社員はいません</div>';
    }

    function detail(empId) {
      const e = D.employees.find((x) => x.id === empId);
      const map = new Map((byEmp().get(empId) || []).map((d) => [d.work_date, d]));
      const s = summarize([...map.values()]);
      const rows = daysOfMonth(ymEl.value).map((ymd) => {
        const d = map.get(ymd);
        const w = workMinutes(d);
        const wd = weekday(ymd);
        return `<tr class="${wd === 0 ? 'sun' : wd === 6 ? 'sat' : ''} ${ymd === D.today ? 'today' : ''}">
          <td class="num">${Number(ymd.slice(8))}</td><td>${WD[wd]}</td>
          <td class="num">${d ? fmtTime(d.clock_in) : ''}</td>
          <td class="num">${d && d.clock_out ? fmtTime(d.clock_out) + (jstDate(new Date(d.clock_out)) !== ymd ? '<span class="hint">（翌日）</span>' : '') : d && isMissing(d) ? '<span class="badge b-red">打刻漏れ</span>' : ''}</td>
          <td class="num r">${d && d.clock_in ? hm(d.break_minutes) : ''}</td><td class="num r">${w == null ? '' : hm(w)}</td>
          <td class="hint">${esc(d ? d.note : '')}${d && d.modified_by ? ' <span class="tag">修正</span>' : ''}</td>
          <td style="text-align:right"><button class="btn sm" data-day="${ymd}">修正</button></td></tr>`;
      }).join('');
      const dlg = modal({
        title: `${e.name}（${e.employee_code}）${ymEl.value.replace('-', '年')}月`,
        body: `<div class="row" style="margin-bottom:10px;gap:18px"><span>出勤 <b>${s.cnt}</b>日</span><span>実働 <b class="num">${hm(s.work)}</b></span><span>残業 <b class="num">${hm(s.over)}</b></span>${s.missing ? `<span class="badge b-red">打刻漏れ ${s.missing}件</span>` : ''}</div>
          <div class="tbl-wrap"><table class="t"><thead><tr><th>日</th><th>曜</th><th>出勤</th><th>退勤</th><th class="r">休憩</th><th class="r">実働</th><th>備考</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`,
      });
      dlg.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-day]');
        if (b) editDay(e, b.dataset.day, map.get(b.dataset.day), dlg);
      });
    }

    function editDay(e, ymd, d, parent) {
      const t = (iso) => (iso ? fmtTime(iso) : '');
      const dlg = modal({
        title: `勤怠の修正：${e.name} ${ymd}`, size: 'sm',
        body: `<div class="grid g2"><label class="f"><span>出勤時刻</span><input type="time" class="inp" id="d-in" value="${t(d && d.clock_in)}"></label>
            <label class="f"><span>退勤時刻</span><input type="time" class="inp" id="d-out" value="${t(d && d.clock_out)}"></label></div>
          <label class="f"><span>休憩（分）</span><input type="number" min="0" max="1440" class="inp" id="d-br" value="${d ? d.break_minutes : 60}" style="max-width:140px"></label>
          <label class="f"><span>備考（本人にも表示）</span><input class="inp" id="d-note" maxlength="200" value="${esc(d ? d.note : '')}" placeholder="例：直行直帰、有給"></label>
          <label class="f"><span>修正理由（操作ログに記録）</span><input class="inp" id="d-reason" maxlength="200" placeholder="例：本人からの申告により退勤打刻漏れを修正"></label>
          <p class="hint">退勤が出勤より前の時刻なら翌日の退勤として扱います。出勤・備考を空にして保存すると、この日の記録を削除します。</p>
          <div class="err" id="d-err"></div>`,
        foot: '<button class="btn" data-close>キャンセル</button><button class="btn pri" id="d-save">保存</button>',
      });
      const v = (id) => dlg.querySelector('#' + id);
      v('d-save').onclick = async () => {
        try {
          await api('/api/admin/attendance/days', {
            method: 'PUT',
            body: { employee_id: e.id, work_date: ymd, clock_in: v('d-in').value, clock_out: v('d-out').value, break_minutes: v('d-br').value, note: v('d-note').value, reason: v('d-reason').value },
          });
          dlg.close();
          parent.close();
          toast('修正しました');
          await load();
          detail(e.id);
        } catch (ex) { v('d-err').textContent = ex.message; }
      };
    }

    function csvSummary() {
      const m = byEmp();
      UMW.downloadCsv(`勤怠集計_${ymEl.value}.csv`, [
        ['年月', '社員ID', '氏名', '部署', '出勤日数', '実働(分)', '実働(時:分)', '残業(分)', '残業(時:分)', '打刻漏れ'],
        ...D.employees.map((e) => { const s = summarize(m.get(e.id) || []); return [ymEl.value, e.employee_code, e.name, e.dept, s.cnt, s.work, hm(s.work), s.over, hm(s.over), s.missing]; }),
      ]);
    }
    function csvDaily() {
      const emp = new Map(D.employees.map((e) => [e.id, e]));
      UMW.downloadCsv(`勤怠明細_${ymEl.value}.csv`, [
        ['日付', '社員ID', '氏名', '部署', '出勤', '退勤', '休憩(分)', '実働(分)', '実働(時:分)', '備考', '管理者修正'],
        ...D.days.map((d) => { const e = emp.get(d.employee_id) || {}; const w = workMinutes(d);
          return [d.work_date, e.employee_code, e.name, e.dept, fmtTime(d.clock_in), d.clock_out ? UMW.fmtDateTime(d.clock_out) : '', d.break_minutes, w ?? '', hm(w), d.note, d.modified_by ? '有' : '']; }),
      ]);
    }

    const shift = (n) => { const [y, mo] = ymEl.value.split('-').map(Number); ymEl.value = new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7); load(); };
    $('prev').onclick = () => shift(-1);
    $('next').onclick = () => shift(1);
    ymEl.onchange = load;
    $('q').oninput = (ev) => { q = ev.target.value; render(); };
    $('csv-sum').onclick = csvSummary;
    $('csv-day').onclick = csvDaily;
    $('sum').addEventListener('click', (ev) => { const r = ev.target.closest('[data-emp]'); if (r) detail(Number(r.dataset.emp)); });
    await load();
  });
})();
