// 延べ利用者数：日次実績の取得・入力
import { json, fail, readBody, intOr, nowIso } from '../../../../lib/util.js';
import { FIELDS, isMonth, isRealDate, weekdayOf, canEdit } from '../../../../lib/usage.js';

export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  const month = q.get('month');
  const fid = intOr(q.get('facility_id'));
  if (!isMonth(month) || !fid) return fail('施設と月を指定してください');
  const { results } = await env.DB
    .prepare(
      `SELECT date, am_support, am_care, pm_support, pm_care, full_care
         FROM ua_daily_records WHERE facility_id = ? AND date BETWEEN ? AND ? ORDER BY date`,
    )
    .bind(fid, month + '-01', month + '-31')
    .all();
  return json({ records: results });
}

export async function onRequestPut({ request, env, data }) {
  const b = await readBody(request);
  const fid = intOr(b.facility_id);
  const f = fid && (await env.DB.prepare('SELECT * FROM ua_facilities WHERE id = ?').bind(fid).first());
  if (!f) return fail('施設が見つかりません');
  if (!canEdit(data.access, f)) return fail('自分の施設のみ入力できます', 403);
  if (!isRealDate(b.date)) return fail('日付が正しくありません');
  if (weekdayOf(b.date) === 0) return fail('日曜日は休業日のため入力できません');
  const values = [];
  for (const k of FIELDS) {
    const v = b[k];
    if (v === null || v === undefined || v === '') { values.push(null); continue; }
    if (!Number.isInteger(v) || v < 0 || v > 999) return fail('人数は0〜999の整数で入力してください');
    values.push(v);
  }
  if (values.every((v) => v === null)) {
    // すべて空欄に戻した日は未入力扱い（営業日数に数えない）
    await env.DB.prepare('DELETE FROM ua_daily_records WHERE facility_id = ? AND date = ?').bind(fid, b.date).run();
  } else {
    await env.DB
      .prepare(
        `INSERT INTO ua_daily_records (facility_id, date, am_support, am_care, pm_support, pm_care, full_care, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (facility_id, date) DO UPDATE SET
           am_support = excluded.am_support, am_care = excluded.am_care, pm_support = excluded.pm_support,
           pm_care = excluded.pm_care, full_care = excluded.full_care, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      )
      .bind(fid, b.date, ...values, nowIso(), data.user.id)
      .run();
  }
  return json({ ok: true });
}
