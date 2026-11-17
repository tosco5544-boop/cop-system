(function () {
  'use strict';
  const { api, esc, av, toast, fmtTime, jstDate, WD, weekday, confirmDialog, modal } = UMW;

  // 新着確認の間隔（ミリ秒）。短くするほどリクエスト数が増えます（README参照）
  const POLL_MS = 10000;

  const S = { channels: [], current: null, messages: [], lastId: 0, since: '', hasMore: false, timer: null, busy: false };

  UMW.start({ active: 'chat', title: 'チャット', viewClass: 'chat-view', staffRedirect: '/office/attendance.html' }, async (me, view) => {
    const isAdmin = me.scope === 'admin';
    view.innerHTML = `<div class="chat">
      <div class="card chat-side"><div class="card-h"><h2>チャンネル</h2><div style="flex:1"></div>${isAdmin ? '<button class="btn sm" id="ch-add">＋ 追加</button>' : ''}</div><div class="ch-list" id="chlist"></div></div>
      <div class="card chat-main">
        <div class="card-h" id="chhead"><h2>チャンネルを選択してください</h2></div>
        <div class="msgs" id="msgs"></div>
        <form class="composer" id="comp"><textarea class="inp" id="msg" rows="1" placeholder="メッセージを入力（Enterで送信／Shift+Enterで改行）" maxlength="4000"></textarea><button class="btn pri" type="submit">送信</button></form>
      </div></div>`;
    const $ = (id) => document.getElementById(id);
    const msgsEl = $('msgs');
    const input = $('msg');

    /* ---------- 描画 ---------- */
    const linkify = (s) => esc(s).replace(/https?:\/\/[^\s<>"']+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);

    function renderChannels() {
      $('chlist').innerHTML = S.channels.map((c) => {
        const unread = c.id !== S.current && c.unread > 0;
        return `<button class="ch-item ${c.id === S.current ? 'on' : ''} ${unread ? 'unread' : ''}" data-ch="${c.id}"># ${esc(c.name)}${unread ? `<span class="cnt">${c.unread > 99 ? '99+' : c.unread}</span>` : ''}</button>`;
      }).join('') || '<div class="empty">チャンネルがありません</div>';
      const total = S.channels.reduce((n, c) => n + (c.id !== S.current ? c.unread : 0), 0);
      document.title = `${total ? `(${total}) ` : ''}チャット | UMW 社内システム`;
    }

    function renderHead() {
      const c = S.channels.find((x) => x.id === S.current);
      $('chhead').innerHTML = c
        ? `<h2># ${esc(c.name)}</h2><span class="hint">${esc(c.description)}</span><div style="flex:1"></div>${isAdmin ? '<button class="btn sm ghost" id="ch-edit">設定</button>' : ''}`
        : '<h2>チャンネルを選択してください</h2>';
    }

    function msgHtml(m, prev) {
      const day = jstDate(new Date(m.created_at));
      const prevDay = prev ? jstDate(new Date(prev.created_at)) : null;
      let h = '';
      if (day !== prevDay) h += `<div class="day-sep">${day.replace(/-/g, '/')}（${WD[weekday(day)]}）</div>`;
      const cont = prev && day === prevDay && prev.employee_id === m.employee_id && Date.parse(m.created_at) - Date.parse(prev.created_at) < 5 * 60000;
      const mine = m.employee_id === me.user.id;
      const ops = !m.deleted && (mine || isAdmin)
        ? `<div class="ops">${mine ? `<button class="btn sm" data-edit="${m.id}">編集</button>` : ''}<button class="btn sm ng" data-del="${m.id}">削除</button></div>` : '';
      h += `<div class="msg ${cont ? 'cont' : ''}" id="m${m.id}">${av(m.name, m.employee_id)}<div>
        <div class="meta"><b>${esc(m.name)}</b><span class="hint">${esc(m.dept || '')}</span><span class="hint">${fmtTime(m.created_at)}</span></div>
        <div class="body ${m.deleted ? 'del' : ''}">${m.deleted ? 'このメッセージは削除されました' : linkify(m.body)}${m.edited_at && !m.deleted ? ' <span class="hint">（編集済み）</span>' : ''}</div>
        </div>${ops}</div>`;
      return h;
    }

    function renderMessages(keepScroll) {
      const atBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 60;
      const prevH = msgsEl.scrollHeight;
      let h = S.hasMore ? '<div style="text-align:center;margin:6px 0 12px"><button class="btn sm" id="older">さらに前を読み込む</button></div>' : '';
      if (!S.messages.length) h += '<div class="empty">まだメッセージはありません。最初の投稿をどうぞ。</div>';
      S.messages.forEach((m, i) => { h += msgHtml(m, S.messages[i - 1]); });
      msgsEl.innerHTML = h;
      if (keepScroll === 'top') msgsEl.scrollTop = msgsEl.scrollHeight - prevH;
      else if (keepScroll !== 'stay' || atBottom) msgsEl.scrollTop = msgsEl.scrollHeight;
    }

    /* ---------- データ ---------- */
    async function markRead() {
      if (!S.current || !S.lastId || document.visibilityState !== 'visible') return;
      const c = S.channels.find((x) => x.id === S.current);
      if (c && c.last_read_id >= S.lastId) return;
      if (c) { c.last_read_id = S.lastId; c.unread = 0; }
      try { await api('/api/chat/read', { method: 'POST', body: { channel_id: S.current, last_id: S.lastId } }); } catch (e) { /* 次回 */ }
    }

    async function openChannel(id) {
      S.current = id;
      S.messages = [];
      S.lastId = 0;
      history.replaceState(null, '', '#' + id);
      renderChannels();
      renderHead();
      msgsEl.innerHTML = '<div class="loading" style="height:200px"><div class="spin"></div></div>';
      try {
        const r = await api('/api/chat/messages?channel=' + id);
        if (S.current !== id) return;
        S.messages = r.messages;
        S.hasMore = r.has_more;
        S.lastId = r.messages.length ? r.messages[r.messages.length - 1].id : 0;
        S.since = r.server_time;
        renderMessages();
        markRead();
        renderChannels();
        if (window.innerWidth > 760) input.focus(); // スマホではキーボードを勝手に開かない
      } catch (e) { msgsEl.innerHTML = `<div class="empty err">${esc(e.message)}</div>`; }
    }

    async function loadOlder() {
      if (!S.messages.length) return;
      const r = await api(`/api/chat/messages?channel=${S.current}&before=${S.messages[0].id}`);
      S.messages = r.messages.concat(S.messages);
      S.hasMore = r.has_more;
      renderMessages('top');
    }

    function mergeIn(list) {
      let added = false;
      for (const m of list) {
        if (m.channel_id !== S.current) continue;
        const i = S.messages.findIndex((x) => x.id === m.id);
        if (i >= 0) S.messages[i] = m;
        else { S.messages.push(m); added = true; }
        if (m.id > S.lastId) S.lastId = m.id;
      }
      if (added) S.messages.sort((a, b) => a.id - b.id);
      return added;
    }

    async function poll() {
      if (S.busy) return;
      S.busy = true;
      try {
        const q = S.current ? `?channel=${S.current}&after=${S.lastId}&since=${encodeURIComponent(S.since)}` : '';
        const ch = S.current;
        const r = await api('/api/chat/poll' + q);
        S.channels = r.channels;
        if (S.current && !S.channels.some((c) => c.id === S.current)) { S.current = null; renderHead(); msgsEl.innerHTML = ''; }
        if (ch && ch === S.current) {
          const changed = r.messages.length || r.changed.length;
          mergeIn(r.messages);
          mergeIn(r.changed);
          S.since = r.server_time;
          if (changed) { renderMessages('stay'); markRead(); }
        }
        renderChannels();
      } catch (e) { /* 一時的な通信エラーは次回再試行 */ }
      finally { S.busy = false; }
    }

    function schedule() {
      clearTimeout(S.timer);
      S.timer = setTimeout(async () => {
        if (document.visibilityState === 'visible') await poll();
        schedule();
      }, POLL_MS);
    }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { poll(); markRead(); } });

    /* ---------- 操作 ---------- */
    $('comp').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = input.value.trim();
      if (!body || !S.current) return;
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      try {
        const r = await api('/api/chat/messages', { method: 'POST', body: { channel_id: S.current, body } });
        input.value = '';
        autosize();
        mergeIn([r.message]);
        renderMessages();
      } catch (ex) { toast(ex.message, true); }
      finally { btn.disabled = false; input.focus(); }
    });
    input.addEventListener('keydown', (e) => {
      // 日本語変換中の Enter は送信しない
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        $('comp').requestSubmit();
      }
    });
    const autosize = () => { input.style.height = 'auto'; input.style.height = Math.min(180, input.scrollHeight + 2) + 'px'; };
    input.addEventListener('input', autosize);

    view.addEventListener('click', async (e) => {
      const ch = e.target.closest('[data-ch]');
      if (ch) return openChannel(Number(ch.dataset.ch));
      if (e.target.closest('#older')) return loadOlder().catch((ex) => toast(ex.message, true));
      const ed = e.target.closest('[data-edit]');
      if (ed) return editMessage(Number(ed.dataset.edit));
      const del = e.target.closest('[data-del]');
      if (del) {
        if (!(await confirmDialog('メッセージを削除しますか？', 'この操作は元に戻せません。', '削除する'))) return;
        try { const r = await api('/api/chat/messages/' + del.dataset.del, { method: 'DELETE' }); mergeIn([r.message]); renderMessages('stay'); }
        catch (ex) { toast(ex.message, true); }
        return;
      }
      if (e.target.closest('#ch-add')) return channelDialog(null);
      if (e.target.closest('#ch-edit')) return channelDialog(S.channels.find((c) => c.id === S.current));
    });

    function editMessage(id) {
      const m = S.messages.find((x) => x.id === id);
      if (!m) return;
      const dlg = modal({
        title: 'メッセージを編集', size: 'sm',
        body: `<textarea class="inp" id="ed-body" maxlength="4000" style="min-height:140px">${esc(m.body)}</textarea>`,
        foot: '<button class="btn" data-close>キャンセル</button><button class="btn pri" id="ed-save">保存</button>',
      });
      dlg.querySelector('#ed-save').onclick = async () => {
        try {
          const r = await api('/api/chat/messages/' + id, { method: 'PUT', body: { body: dlg.querySelector('#ed-body').value } });
          mergeIn([r.message]); renderMessages('stay'); dlg.close();
        } catch (ex) { toast(ex.message, true); }
      };
    }

    function channelDialog(c) {
      const dlg = modal({
        title: c ? 'チャンネルの設定' : 'チャンネルを追加', size: 'sm',
        body: `<label class="f"><span>チャンネル名<i class="req">*</i></span><input class="inp" id="cn" maxlength="40" value="${esc(c ? c.name : '')}"></label>
               <label class="f"><span>説明</span><input class="inp" id="cd" maxlength="200" value="${esc(c ? c.description : '')}"></label>
               <p class="hint">チャンネルは全職員が閲覧・投稿できます。</p>`,
        foot: `${c ? '<button class="btn ng" id="c-arch" style="margin-right:auto">アーカイブ</button>' : ''}<button class="btn" data-close>キャンセル</button><button class="btn pri" id="c-save">保存</button>`,
      });
      dlg.querySelector('#c-save').onclick = async () => {
        const body = { name: dlg.querySelector('#cn').value, description: dlg.querySelector('#cd').value };
        try {
          if (c) await api('/api/admin/chat/channels/' + c.id, { method: 'PUT', body });
          else { const r = await api('/api/admin/chat/channels', { method: 'POST', body }); S.current = r.id; }
          dlg.close();
          await poll();
          if (!c) openChannel(S.current); else renderHead();
        } catch (ex) { toast(ex.message, true); }
      };
      const arch = dlg.querySelector('#c-arch');
      if (arch) arch.onclick = async () => {
        if (!(await confirmDialog('アーカイブしますか？', `「${c.name}」は一覧から非表示になり、投稿できなくなります。メッセージは削除されません。`, 'アーカイブ'))) return;
        try { await api('/api/admin/chat/channels/' + c.id, { method: 'PUT', body: { archived: true } }); dlg.close(); S.current = null; await poll(); renderHead(); msgsEl.innerHTML = ''; }
        catch (ex) { toast(ex.message, true); }
      };
    }

    /* ---------- 開始 ---------- */
    await poll();
    const fromHash = Number(location.hash.slice(1));
    const first = S.channels.find((c) => c.id === fromHash) || S.channels[0];
    if (first) await openChannel(first.id);
    schedule();
  });
})();
