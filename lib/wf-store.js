// ワークフロー申請の保存
import { rowToRequest } from './workflow.js';

export async function loadRequest(env, id) {
  const row = await env.DB.prepare('SELECT * FROM wf_requests WHERE id = ?').bind(id).first();
  return row ? rowToRequest(row) : null;
}

/**
 * 申請を保存する。expectedUpdatedAt を渡すと、他の人が先に更新していた場合は false を返す（楽観ロック）
 */
export async function saveRequest(env, r, expectedUpdatedAt, historyEntries) {
  const cols = [
    r.no || null, r.formId, r.formName, JSON.stringify(r.fields), r.title, JSON.stringify(r.values), r.applicantId,
    r.status, r.currentStep, JSON.stringify(r.steps), r.createdAt, r.submittedAt || null, r.updatedAt, r.completedAt || null,
  ];
  const stmt = expectedUpdatedAt
    ? env.DB
        .prepare(
          `UPDATE wf_requests SET no = ?, form_id = ?, form_name = ?, fields_json = ?, title = ?, values_json = ?, applicant_id = ?,
             status = ?, current_step = ?, steps_json = ?, created_at = ?, submitted_at = ?, updated_at = ?, completed_at = ?
           WHERE id = ? AND updated_at = ?`,
        )
        .bind(...cols, r.id, expectedUpdatedAt)
    : env.DB
        .prepare(
          `INSERT INTO wf_requests (no, form_id, form_name, fields_json, title, values_json, applicant_id, status, current_step,
             steps_json, created_at, submitted_at, updated_at, completed_at, id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(...cols, r.id);
  const res = await stmt.run();
  if (!res.meta.changes) return false;
  if (historyEntries.length) {
    await env.DB.batch(
      historyEntries.map((h) =>
        env.DB.prepare('INSERT INTO wf_history (request_id, at, by_id, action, step, comment) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(r.id, h.at, h.by, h.action, h.step || null, h.comment || null),
      ),
    );
  }
  return true;
}
