// 申請への操作
// body: { action: 'approved' | 'returned' | 'rejected' | 'withdrawn' | 'delete_draft', comment? }
import { json, fail, readBody, str, nowIso, audit } from '../../../../../lib/util.js';
import { advance, currentApprover } from '../../../../../lib/workflow.js';
import { loadRequest, saveRequest } from '../../../../../lib/wf-store.js';

export async function onRequestPost({ request, env, data, params }) {
  const b = await readBody(request);
  const me = data.user;
  const r = await loadRequest(env, str(params.id, 64));
  if (!r) return fail('申請が見つかりません', 404);
  const action = b.action;
  const comment = str(b.comment, 2000);
  const now = nowIso();
  const expected = r.updatedAt;
  const hist = [];

  if (action === 'delete_draft') {
    if (r.applicantId !== me.id || r.status !== 'draft') return fail('この申請は削除できません', 409);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM wf_history WHERE request_id = ?').bind(r.id),
      env.DB.prepare('DELETE FROM wf_requests WHERE id = ?').bind(r.id),
    ]);
    return json({ ok: true });
  }

  if (['approved', 'returned', 'rejected'].includes(action)) {
    if (currentApprover(r) !== me.id) return fail('この申請はすでに処理されているか、あなたの承認順ではありません', 409);
    if (action !== 'approved' && !comment) return fail((action === 'rejected' ? '却下' : '差し戻し') + 'の理由をコメントに入力してください');
    const s = r.steps[r.currentStep];
    s.status = action;
    s.comment = comment;
    s.at = now;
    hist.push({ at: now, by: me.id, action, step: s.name, comment });
    if (action === 'approved') advance(r, now);
    else {
      r.status = action;
      if (action === 'rejected') r.completedAt = now;
    }
  } else if (action === 'withdrawn') {
    if (r.applicantId !== me.id || !['pending', 'returned'].includes(r.status)) return fail('この申請は取り下げできません', 409);
    const s = r.steps[r.currentStep];
    if (s && s.status === 'pending') s.status = 'waiting';
    r.status = 'withdrawn';
    r.currentStep = -1;
    hist.push({ at: now, by: me.id, action: 'withdrawn' });
  } else {
    return fail('操作が不正です');
  }

  r.updatedAt = now;
  if (!(await saveRequest(env, r, expected, hist))) return fail('他の操作と重なりました。画面を更新してやり直してください', 409);
  await audit(env, { actorId: me.id, action: 'wf.' + action, target: `${r.no} ${r.title}`, ip: data.ip });
  return json({ ok: true, status: r.status });
}
