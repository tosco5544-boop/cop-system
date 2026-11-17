// 延べ利用者数：施設一覧（入力できるかどうか付き）
import { json } from '../../../../lib/util.js';
import { canEdit } from '../../../../lib/usage.js';

export async function onRequestGet({ env, data }) {
  const { results } = await env.DB.prepare('SELECT * FROM ua_facilities ORDER BY sort_order, id').all();
  return json({
    hq: !!data.access.hq,
    own: data.access.facility,
    facilities: results.map((f) => ({ ...f, can_edit: canEdit(data.access, f) })),
  });
}
