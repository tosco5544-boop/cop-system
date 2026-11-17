// 延べ利用者数：共通処理（集計ルールは元のアプリと同じ）
//  営業日数 ＝ 入力がある日の数（0も営業日に含む）
//  月次平均 ＝ 月の合計 ÷ 営業日数 ／ 3H平均 ＝ 午前平均と午後平均の平均
export const FIELDS = ['am_support', 'am_care', 'pm_support', 'pm_care', 'full_care'];

export const isMonth = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export function isRealDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export const weekdayOf = (date) => new Date(date + 'T00:00:00Z').getUTCDay(); // 0=日

export const newAgg = () => ({ days: 0, am: 0, pm: 0, full: 0 });
export function addRow(a, r) {
  a.days++;
  a.am += (r.am_support || 0) + (r.am_care || 0);
  a.pm += (r.pm_support || 0) + (r.pm_care || 0);
  a.full += r.full_care || 0;
}
export function finish(a, f) {
  if (!a.days) return { days: 0, am: null, pm: null, h3: null, full: null };
  const am = f.use_am ? a.am / a.days : null;
  const pm = f.use_pm ? a.pm / a.days : null;
  const parts = [am, pm].filter((v) => v !== null);
  const h3 = parts.length ? parts.reduce((x, y) => x + y, 0) / parts.length : null;
  return { days: a.days, am, pm, h3, full: f.use_7h ? a.full / a.days : null };
}

/** 入力できる施設か：本部は全施設、施設長は自分の施設（施設名が同じもの）だけ */
export const canEdit = (access, f) => !!access.hq || (!!access.facility && access.facility === f.name);
