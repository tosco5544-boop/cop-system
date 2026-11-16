// 申請の作成・下書き保存・申請（再申請）
// body: { id?, form_id, title, values, submit: boolean }
import { json, fail, readBody, str, nowIso, audit } from '../../../../lib/util.js';
import { resolveSteps, advance, genNo, rowToForm, rowToRoute } from '../../../../lib/workflow.js';
import { loadRequest, saveRequest } from '../../../../lib/wf-store.js';

export async function onRequestPost({ request, env, data }) {
  const b = await readBody(request);
  const me = data.user;
  const now = nowIso();
  let r;
  let expected = null;
  const hist = [];

  if (b.id) {
    r = await loadRequest(env, str(b.id, 64));
    if (!r) return fail('申請が見つかりません', 404);
    if (r.applicantId !== me.id) return fail('自分の申請のみ編集できます', 403);
    if (!['draft', 'returned'].includes(r.status)) return fail('この申請は編集できません', 409);
    expected = r.updatedAt;
  } else {
    const fr = await env.DB.prepare('SELECT * FROM wf_forms WHERE id = ? AND active = 1').bind(str(b.form_id, 64)).first();
    if (!fr) return fail('申請書式が見つかりません', 404);
    const form = rowToForm(fr);
    r = {
      id: crypto.randomUUID(), no: null, formId: form.id, formName: form.name, fields: form.fields, applicantId: me.id,
      createdAt: now, status: 'draft', currentStep: -1, steps: [], values: {},
    };
  }

  r.title = str(b.title, 200);
  const values = {};
  const src = b.values && typeof b.values === 'object' ? b.values : {};
  for (const f of r.fields) values[f.id] = str(src[f.id], f.type === 'textarea' ? 4000 : 500);
  r.values = values;
  r.updatedAt = now;

  if (!r.title) return fail('件名を入力してください');

  if (!b.submit) {
    if (r.status !== 'returned') r.status = 'draft';
    if (!expected) hist.push({ at: now, by: me.id, action: 'draft' });
  } else {
    const missing = r.fields.filter((f) => f.required && !values[f.id]).map((f) => f.label);
    if (missing.length) return fail('入力してください：' + missing.join('、'));
    const fr = await env.DB.prepare('SELECT route_id FROM wf_forms WHERE id = ?').bind(r.formId).first();
    const rr = fr && (await env.DB.prepare('SELECT * FROM wf_routes WHERE id = ?').bind(fr.route_id).first());
    // 承認者は「有効な管理者」から選ばれる（ワークフローは管理者専用のため）
    const approvers = (await env.DB.prepare("SELECT id, name, dept, title FROM employees WHERE active = 1 AND role = 'admin'").all()).results;
    const { steps, errors } = resolveSteps(r.fields, rr ? rowToRoute(rr) : null, me, values, approvers);
    if (errors.length) return fail(errors.join('\n'));
    const resubmit = r.status === 'returned';
    r.steps = steps;
    r.no = r.no || genNo();
    r.submittedAt = now;
    r.completedAt = null;
    hist.push({ at: now, by: me.id, action: resubmit ? 'resubmit' : 'submit' });
    advance(r, now);
  }

  if (!(await saveRequest(env, r, expected, hist))) return fail('他の操作と重なりました。画面を更新してやり直してください', 409);
  if (b.submit) await audit(env, { actorId: me.id, action: 'wf.submit', target: `${r.no} ${r.title}`, ip: data.ip });
  return json({ id: r.id, status: r.status, no: r.no });
}
