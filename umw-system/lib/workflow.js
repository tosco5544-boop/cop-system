// ワークフローエンジン（サーバー側で承認ルートを確定・進行させる）
import { safeJson, jstDate } from './util.js';

export const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select'];
export const APPROVER_TYPES = ['deptTitle', 'title', 'user'];
export const OPS = { '>=': '以上', '>': 'より大きい', '<=': '以下', '<': '未満', '==': 'と等しい' };

export function describeCond(c) {
  return c && c.label ? `「${c.label}」が ${Number(c.value).toLocaleString()} ${OPS[c.op] || c.op}` : '';
}

export function condOk(c, fields, values) {
  if (!c || !c.label) return true;
  const f = fields.find((x) => x.label === c.label);
  if (!f) return false;
  const raw = values[f.id];
  if (raw === undefined || raw === null || raw === '') return false;
  const v = Number(raw);
  const t = Number(c.value);
  if (Number.isNaN(v)) return false;
  switch (c.op) {
    case '>=': return v >= t;
    case '>': return v > t;
    case '<=': return v <= t;
    case '<': return v < t;
    case '==': return v === t;
  }
  return false;
}

/**
 * 承認ステップを確定する
 * @param approvers 承認者になれる社員（有効な管理者）
 */
export function resolveSteps(fields, route, applicant, values, approvers) {
  const steps = [];
  const errors = [];
  if (!route) return { steps, errors: ['この申請書に承認ルートが設定されていません。'] };
  if (!route.steps || !route.steps.length) return { steps, errors: ['承認ルートにステップがありません。'] };
  for (const st of route.steps) {
    const s = { id: crypto.randomUUID(), name: st.name || '承認', approverId: null, status: 'waiting', note: '', comment: '', at: null };
    if (st.cond && st.cond.label && !condOk(st.cond, fields, values)) {
      s.status = 'skipped';
      s.note = `条件外のため省略（${describeCond(st.cond)}のとき）`;
      steps.push(s);
      continue;
    }
    let u = null;
    if (st.type === 'user') u = approvers.find((x) => String(x.id) === String(st.target));
    else if (st.type === 'deptTitle') u = approvers.find((x) => x.dept === applicant.dept && x.title === st.target);
    else if (st.type === 'title') u = approvers.find((x) => x.title === st.target);
    if (!u) {
      s.note = '承認者が見つかりません';
      errors.push(`「${s.name}」の承認者が見つかりません（${st.type === 'deptTitle' ? '申請者部署の' : ''}${st.type === 'user' ? '指定ユーザー' : st.target}）`);
      steps.push(s);
      continue;
    }
    s.approverId = u.id;
    if (u.id === applicant.id) {
      s.status = 'skipped';
      s.note = '申請者本人のため省略';
    }
    steps.push(s);
  }
  return { steps, errors };
}

export function advance(req, now) {
  const i = req.steps.findIndex((s) => s.status === 'waiting');
  if (i < 0) {
    req.status = 'approved';
    req.currentStep = -1;
    req.completedAt = now;
  } else {
    req.steps[i].status = 'pending';
    req.currentStep = i;
    req.status = 'pending';
  }
}

export const currentApprover = (r) =>
  r.status === 'pending' && r.steps && r.steps[r.currentStep] ? r.steps[r.currentStep].approverId : null;

export function genNo() {
  const d = jstDate().replace(/-/g, '').slice(2);
  const rnd = [...crypto.getRandomValues(new Uint8Array(3))].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `R${d}-${rnd}`;
}

export function rowToRequest(row, history = []) {
  return {
    id: row.id,
    no: row.no,
    formId: row.form_id,
    formName: row.form_name,
    fields: safeJson(row.fields_json, []),
    title: row.title,
    values: safeJson(row.values_json, {}),
    applicantId: row.applicant_id,
    status: row.status,
    currentStep: row.current_step,
    steps: safeJson(row.steps_json, []),
    createdAt: row.created_at,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    history,
  };
}

export const rowToHistory = (h) => ({ at: h.at, by: h.by_id, action: h.action, step: h.step || '', comment: h.comment || '' });

export function rowToForm(r) {
  return {
    id: r.id, name: r.name, description: r.description, routeId: r.route_id,
    active: r.active === 1, order: r.sort_order, fields: safeJson(r.fields_json, []),
  };
}

export const rowToRoute = (r) => ({ id: r.id, name: r.name, steps: safeJson(r.steps_json, []) });

/** 書式の入力検証。問題があればメッセージを返す */
export function validateForm(f) {
  if (!f.name) return '書式名を入力してください';
  if (!f.routeId) return '承認ルートを選択してください';
  if (!Array.isArray(f.fields) || f.fields.length > 50) return '入力項目が不正です';
  const ids = new Set();
  for (const x of f.fields) {
    if (!x.id || ids.has(x.id)) return '項目IDが不正です';
    ids.add(x.id);
    if (!x.label) return '項目名が空の項目があります';
    if (!FIELD_TYPES.includes(x.type)) return '項目の種類が不正です';
  }
  return null;
}

export function validateRoute(r) {
  if (!r.name) return 'ルート名を入力してください';
  if (!Array.isArray(r.steps) || !r.steps.length) return 'ステップを1つ以上追加してください';
  if (r.steps.length > 20) return 'ステップが多すぎます';
  for (const s of r.steps) {
    if (!s.name || !s.target) return 'ステップ名と承認者（役職）をすべて入力してください';
    if (!APPROVER_TYPES.includes(s.type)) return '承認者の決め方が不正です';
    if (s.cond && (!s.cond.label || s.cond.value === '' || s.cond.value == null || !OPS[s.cond.op])) return '条件の項目名と値を入力してください';
  }
  return null;
}

/** クライアントから来た書式を安全な形に整える */
export function cleanForm(b, id) {
  const s = (v, n) => String(v ?? '').trim().slice(0, n);
  return {
    id,
    name: s(b.name, 100),
    description: s(b.description, 300),
    routeId: s(b.routeId, 64),
    active: b.active !== false,
    order: Number.isFinite(Number(b.order)) && b.order !== null && b.order !== '' ? Math.trunc(Number(b.order)) : 99,
    fields: Array.isArray(b.fields)
      ? b.fields.map((x) => {
          const o = { id: s(x.id, 40), label: s(x.label, 60), type: s(x.type, 20), required: !!x.required };
          if (o.type === 'select') o.options = (Array.isArray(x.options) ? x.options : []).map((v) => s(v, 60)).filter(Boolean).slice(0, 50);
          if (o.type === 'number' && x.unit) o.unit = s(x.unit, 10);
          return o;
        })
      : null,
  };
}

export function cleanRoute(b, id) {
  const s = (v, n) => String(v ?? '').trim().slice(0, n);
  return {
    id,
    name: s(b.name, 100),
    steps: Array.isArray(b.steps)
      ? b.steps.map((x) => {
          const o = { name: s(x.name, 60), type: s(x.type, 20), target: s(x.target, 60) };
          if (x.cond && typeof x.cond === 'object') {
            o.cond = { label: s(x.cond.label, 60), op: s(x.cond.op, 2), value: x.cond.value === '' || x.cond.value == null ? '' : Number(x.cond.value) };
          }
          return o;
        })
      : null,
  };
}
