export async function assertProjectOwnerMigrationReady(connection) {
  const [multipleOwners] = await connection.query(
    `SELECT p.project_code AS projectCode, COUNT(pp.id) AS ownerCount
     FROM projects p
     JOIN project_participations pp ON pp.project_id = p.id AND pp.role = 'owner' AND pp.deleted_at IS NULL
     WHERE p.deleted_at IS NULL
     GROUP BY p.id, p.project_code HAVING COUNT(pp.id) > 1
     ORDER BY p.id LIMIT 20`
  );
  const [repeatedOwners] = await connection.query(
    `SELECT pe.student_no AS studentNo, pe.name, COUNT(DISTINCT pp.project_id) AS projectCount
     FROM project_participations pp
     JOIN projects p ON p.id = pp.project_id AND p.deleted_at IS NULL
     JOIN people pe ON pe.id = pp.person_id
     WHERE pp.role = 'owner' AND pp.deleted_at IS NULL
     GROUP BY pp.person_id, pe.student_no, pe.name HAVING COUNT(DISTINCT pp.project_id) > 1
     ORDER BY pp.person_id LIMIT 20`
  );
  const [missingOwners] = await connection.query(
    `SELECT p.project_code AS projectCode, p.status
     FROM projects p
     LEFT JOIN project_participations pp ON pp.project_id = p.id AND pp.role = 'owner' AND pp.deleted_at IS NULL
     WHERE p.deleted_at IS NULL AND p.status IN ('active','checking','completed','archived','stopped')
     GROUP BY p.id, p.project_code, p.status HAVING COUNT(pp.id) = 0
     ORDER BY p.id LIMIT 20`
  );
  const conflicts = [
    ['多负责人项目', multipleOwners],
    ['负责人重复（同一学生负责多个未删除项目）', repeatedOwners],
    ['正式项目无负责人', missingOwners]
  ].filter(([, rows]) => rows.length);
  if (conflicts.length) {
    const detail = conflicts.map(([label, rows]) => `${label}: ${JSON.stringify(rows)}`).join('\n');
    throw new Error(`011 迁移负责人完整性预查未通过；请先人工修复遗留数据，系统不会伪造负责人。\n${detail}`);
  }
}
