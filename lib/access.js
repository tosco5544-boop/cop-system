// 権限の判定
//  hq       : 本部の管理者（部署が施設ではない管理者）… 全機能・全施設
//  admin    : 管理者用の入口からログインした管理者（施設長を含む）… ワークフロー・チャット
//  office   : 勤怠管理ができる（管理者、または事務員用の入口からログインした事務員）
//  facility : 担当範囲。部署が施設名ならその施設だけ。null なら全施設
export async function getAccess(env, user, scope) {
  const row = await env.DB
    .prepare(
      `SELECT (SELECT name FROM facilities WHERE name = ? AND active = 1) AS facility,
              (SELECT 1 FROM clerks WHERE employee_id = ?) AS clerk`,
    )
    .bind(user.dept || '', user.id)
    .first();
  const isAdmin = scope === 'admin' && user.role === 'admin';
  const isClerk = !!(row && row.clerk);
  const facility = row && row.facility ? row.facility : null;
  return {
    admin: isAdmin,
    hq: isAdmin && !facility,
    clerk: isClerk,
    office: isAdmin || (scope === 'staff' && (isClerk || user.role === 'admin')),
    facility,
  };
}

/** 担当範囲の施設名（全施設なら null） */
export const scopeFacility = (data) => data.access.facility;

/** 担当範囲内の社員か */
export function inScope(data, emp) {
  return !data.access.facility || emp.dept === data.access.facility;
}
