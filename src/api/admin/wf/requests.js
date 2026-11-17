// 申請の作成・下書き保存・申請（再申請）
// body: { id?, form_id, title, values, submit: boolean, route?: [{ name, approverId }] }
// route を渡すと、その承認者・順番で回付する（申請ごとに指定）。渡さない場合は書式の標準ルートを使う
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

  // 申請者が指定した承認ルート
  let custom = null;
  if (Array.isArray(b.route)) {
    if (b.route.length > 20) return fail('承認ステップが多すぎます（20まで）');
    const approvers = (await env.DB.prepare("SELECT id, name FROM employees WHERE active = 1 AND role = 'admin'").all()).results;
    custom = [];
    for (const st of b.route) {
      const u = approvers.find((a) => String(a.id) === String(st && st.approverId));
      if (!u) return fail('承認者が選ばれていないステップ、または承認者になれない社員があります（承認者は管理者のみ）');
      if (u.id === me.id) return fail('自分自身を承認者にはできません');
      custom.push({ name: str(st.name, 60) || '承認', approverId: u.id, approverName: u.name });
    }
  }
  const stepsFrom = (list) => list.map((st) => ({ id: crypto.randomUUID(), name: st.name, approverId: st.approverId, status: 'waiting', note: '', comment: '', at: null }));

  if (!b.submit) {
    if (r.status !== 'returned') r.status = 'draft';
    if (custom && r.status === 'draft') r.steps = stepsFrom(custom); // 下書きにも予定のルートを残す
    if (!expected) hist.push({ at: now, by: me.id, action: 'draft' });
  } else {
    const missing = r.fields.filter((f) => f.required && !values[f.id]).map((f) => f.label);
    if (missing.length) return fail('入力してください：' + missing.join('、'));
    let steps;
    if (custom) {
      if (!custom.length) return fail('承認者を1人以上指定してください');
      steps = stepsFrom(custom);
    } else {
      const fr = await env.DB.prepare('SELECT route_id FROM wf_forms WHERE id = ?').bind(r.formId).first();
      const rr = fr && fr.route_id && (await env.DB.prepare('SELECT * FROM wf_routes WHERE id = ?').bind(fr.route_id).first());
      // 承認者は「有効な管理者」から選ばれる（ワークフローは管理者専用のため）
      const approvers = (await env.DB.prepare("SELECT id, name, dept, title FROM employees WHERE active = 1 AND role = 'admin'").all()).results;
      const res = resolveSteps(r.fields, rr ? rowToRoute(rr) : null, me, values, approvers);
      if (res.errors.length) return fail(res.errors.join('\n') + '\n承認ルートを指定して申請してください。');
      steps = res.steps;
    }
    const resubmit = r.status === 'returned';
    r.steps = steps;
    r.no = r.no || genNo();
    r.submittedAt = now;
    r.completedAt = null;
    hist.push({ at: now, by: me.id, action: resubmit ? 'resubmit' : 'submit' });
    advance(r, now);
  }

  if (!(await saveRequest(env, r, expected, hist))) return fail('他の操作と重なりました。画面を更新してやり直してください', 409);
  if (b.submit) {
    await logRoute(env, r, me, now);
    await audit(env, { actorId: me.id, action: 'wf.submit', target: `${r.no} ${r.title}`, ip: data.ip });
  }
  return json({ id: r.id, status: r.status, no: r.no });
}

/** 使われた承認ルートを記録する（同じ並びなら回数を増やす） */
async function logRoute(env, r, me, now) {
  const used = r.steps.filter((s) => s.approverId && s.status !== 'skipped');
  if (!used.length) return;
  const names = new Map((await env.DB.prepare('SELECT id, name FROM employees').all()).results.map((e) => [e.id, e.name]));
  const steps = used.map((s) => ({ name: s.name, approverId: s.approverId, approverName: names.get(s.approverId) || '' }));
  const signature = steps.map((s) => `${s.name}:${s.approverId}`).join('>');
  await env.DB
    .prepare(
      `INSERT INTO wf_route_log (signature, steps_json, used_count, first_used_at, last_used_at, last_used_by, last_form_name)
       VALUES (?, ?, 1, ?, ?, ?, ?)
       ON CONFLICT (signature) DO UPDATE SET used_count = used_count + 1, steps_json = excluded.steps_json,
         last_used_at = excluded.last_used_at, last_used_by = excluded.last_used_by, last_form_name = excluded.last_form_name`,
    )
    .bind(signature, JSON.stringify(steps), now, now, me.id, r.formName)
    .run();
}
