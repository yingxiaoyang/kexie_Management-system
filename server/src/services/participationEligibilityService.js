import { pool } from '../db/pool.js';
import { badRequest, notFound } from '../utils/errors.js';
import { writeProjectAudit } from './projectWorkspaceService.js';

const reasonLabels = Object.freeze({
  missing_required_material: '必填材料逾期未通过',
  project_terminated: '项目终止'
});

function ids(values) {
  return [...new Set((values || []).map(Number).filter((value) => Number.isSafeInteger(value) && value > 0))];
}

export function restrictionYearFor(projectYear) {
  return Number(projectYear) + 1;
}

export function restrictionAppliesToYear(sourceProjectYear, targetYear) {
  return restrictionYearFor(sourceProjectYear) === Number(targetYear);
}

export function canAutoReleaseRestriction(triggerReason) {
  return triggerReason === 'missing_required_material';
}

export function hasActiveRestrictionForYear(records, targetYear) {
  return (records || []).some((record) => record.status === 'active' && Number(record.restrictionYear) === Number(targetYear));
}

export async function activeRestrictions(connection, personIds, targetYear) {
  const people = ids(personIds);
  if (!people.length) return [];
  const [rows] = await connection.execute(
    `SELECT pr.id, pr.person_id AS personId, pe.name, pe.student_no AS studentNo,
            pr.restriction_year AS restrictionYear, pr.trigger_reason AS triggerReason,
            pr.source_project_id AS sourceProjectId, p.project_code AS sourceProjectCode,
            pr.source_material_task_id AS sourceMaterialTaskId, mt.task_name AS sourceTaskName,
            pr.triggered_at AS triggeredAt
     FROM participation_restrictions pr
     JOIN people pe ON pe.id = pr.person_id
     JOIN projects p ON p.id = pr.source_project_id
     LEFT JOIN material_tasks mt ON mt.id = pr.source_material_task_id
     WHERE pr.status = 'active' AND pr.restriction_year = ?
       AND pr.person_id IN (${people.map(() => '?').join(',')})
     ORDER BY pe.name, pr.triggered_at`,
    [targetYear, ...people]
  );
  return rows.map((row) => ({ ...row, reasonLabel: reasonLabels[row.triggerReason] || row.triggerReason }));
}

export async function assertPeopleEligibleForYear(connection, personIds, targetYear, context = '参与项目') {
  const year = Number(targetYear);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw badRequest('目标项目年度无效', 'VALIDATION_ERROR');
  }
  const restrictions = await activeRestrictions(connection, personIds, year);
  if (restrictions.length) {
    const summary = restrictions.slice(0, 5).map((item) =>
      `${item.name}（${item.studentNo || '未登记学号'}）：${item.reasonLabel}，限制年度 ${item.restrictionYear}`
    ).join('；');
    const error = badRequest(`${context}资格校验未通过：${summary}`, 'PARTICIPATION_RESTRICTED');
    error.details = { targetYear: year, restrictions };
    throw error;
  }
  return true;
}

async function insertEvent(connection, restrictionId, eventType, actorUserId, actorSource, reason, payload = null) {
  await connection.execute(
    `INSERT INTO participation_restriction_events
     (restriction_id, event_type, actor_user_id, actor_source, reason, event_payload)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [restrictionId, eventType, actorUserId || null, actorSource, reason, payload ? JSON.stringify(payload) : null]
  );
}

async function createRestriction(connection, {
  personId, restrictionYear, triggerReason, projectId, materialTaskId = null,
  actorUserId = null, triggerSource = 'business_event'
}) {
  const [result] = await connection.execute(
    `INSERT IGNORE INTO participation_restrictions
     (person_id, restriction_year, trigger_reason, source_project_id, source_material_task_id,
      triggered_by_user_id, trigger_source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [personId, restrictionYear, triggerReason, projectId, materialTaskId, actorUserId, triggerSource]
  );
  if (!result.affectedRows) return { created: false };
  const restrictionId = Number(result.insertId);
  const reason = triggerReason === 'project_terminated'
    ? `来源项目已终止，限制 ${restrictionYear} 年度参与资格`
    : `必填材料截止后仍无审核通过版本，限制 ${restrictionYear} 年度参与资格`;
  await insertEvent(connection, restrictionId, 'triggered', actorUserId,
    ['manual_scan', 'manual_action'].includes(triggerSource) ? 'super_admin' : 'system',
    reason, { projectId, materialTaskId, restrictionYear });
  await writeProjectAudit(connection, {
    projectId, eventType: 'participation_restriction_triggered', actorUserId,
    sourceModule: '跨届黑名单', changes: [],
    payload: { summary: `触发跨届限制：${reasonLabels[triggerReason]}（${restrictionYear} 年度）`, restrictionId, personId, materialTaskId }
  });
  return { created: true, restrictionId };
}

async function affectedStudents(connection, projectId) {
  const [rows] = await connection.execute(
    `SELECT DISTINCT person_id AS personId FROM project_participations
     WHERE project_id = ? AND role IN ('owner', 'member') AND deleted_at IS NULL`,
    [projectId]
  );
  return rows.map((row) => Number(row.personId));
}

export async function restrictTerminatedProject(connection, projectId, {
  actorUserId = null, triggerSource = 'business_event'
} = {}) {
  const [[project]] = await connection.execute(
    'SELECT id, project_year AS projectYear, status FROM projects WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [projectId]
  );
  if (!project) throw notFound('Project not found');
  if (!['stopped', 'terminated'].includes(project.status)) return { created: 0 };
  const people = await affectedStudents(connection, projectId);
  let created = 0;
  for (const personId of people) {
    const result = await createRestriction(connection, {
      personId, restrictionYear: restrictionYearFor(project.projectYear), triggerReason: 'project_terminated',
      projectId: Number(project.id), actorUserId, triggerSource
    });
    if (result.created) created += 1;
  }
  return { created };
}

function taskAppliesSql(projectAlias = 'p', taskAlias = 'mt') {
  return `(${taskAlias}.project_scope_type = 'all'
    OR (${taskAlias}.project_scope_type = 'year' AND ${taskAlias}.project_year = ${projectAlias}.project_year)
    OR (${taskAlias}.project_scope_type = 'group' AND ${taskAlias}.project_group = ${projectAlias}.project_group)
    OR (${taskAlias}.project_scope_type = 'custom' AND EXISTS (
      SELECT 1 FROM material_task_projects mtp
      WHERE mtp.material_task_id = ${taskAlias}.id AND mtp.project_id = ${projectAlias}.id
    )))`;
}

export async function scanOverdueRequiredMaterials(connection = pool, {
  materialTaskId = null, projectId = null, actorUserId = null, triggerSource = 'scheduled_scan'
} = {}) {
  const params = [];
  const taskFilter = materialTaskId ? 'AND mt.id = ?' : '';
  if (materialTaskId) params.push(materialTaskId);
  const projectFilter = projectId ? 'AND p.id = ?' : '';
  if (projectId) params.push(projectId);
  const [rows] = await connection.execute(
    `SELECT DISTINCT mt.id AS materialTaskId, p.id AS projectId, p.project_year AS projectYear
     FROM material_tasks mt
     JOIN projects p ON p.deleted_at IS NULL AND ${taskAppliesSql()}
     WHERE mt.deleted_at IS NULL AND mt.task_type = 'standard'
       AND mt.status IN ('published', 'closed') AND mt.deadline_at IS NOT NULL AND mt.deadline_at < NOW()
       ${taskFilter}
       ${projectFilter}
       AND EXISTS (
         SELECT 1 FROM material_categories mc
         WHERE mc.material_task_id = mt.id AND mc.is_required = 1 AND mc.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM material_submissions ms
             WHERE ms.material_task_id = mt.id AND ms.project_id = p.id
               AND ms.material_category_id = mc.id AND ms.review_status = 'approved' AND ms.deleted_at IS NULL
           )
       )`,
    params
  );
  let created = 0;
  for (const row of rows) {
    const people = await affectedStudents(connection, row.projectId);
    for (const personId of people) {
      const result = await createRestriction(connection, {
        personId, restrictionYear: restrictionYearFor(row.projectYear), triggerReason: 'missing_required_material',
        projectId: Number(row.projectId), materialTaskId: Number(row.materialTaskId), actorUserId, triggerSource
      });
      if (result.created) created += 1;
    }
  }
  return { scannedProjectTasks: rows.length, created };
}

export async function scanParticipationRestrictions(connection = pool, options = {}) {
  const material = await scanOverdueRequiredMaterials(connection, options);
  const [terminatedProjects] = await connection.execute(
    "SELECT id FROM projects WHERE status IN ('stopped', 'terminated') AND deleted_at IS NULL ORDER BY id"
  );
  let terminatedCreated = 0;
  for (const project of terminatedProjects) {
    const result = await restrictTerminatedProject(connection, Number(project.id), options);
    terminatedCreated += result.created;
  }
  return {
    ...material,
    scannedTerminatedProjects: terminatedProjects.length,
    terminatedCreated,
    created: material.created + terminatedCreated
  };
}

export async function releaseSatisfiedMaterialRestrictions(connection, projectId, materialTaskId, {
  actorUserId = null, reason = '必填材料已补交并审核通过，系统自动解除'
} = {}) {
  const [[missing]] = await connection.execute(
    `SELECT 1 FROM material_categories mc
     WHERE mc.material_task_id = ? AND mc.is_required = 1 AND mc.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM material_submissions ms
         WHERE ms.material_task_id = ? AND ms.project_id = ? AND ms.material_category_id = mc.id
           AND ms.review_status = 'approved' AND ms.deleted_at IS NULL
       ) LIMIT 1`,
    [materialTaskId, materialTaskId, projectId]
  );
  if (missing) return { released: 0 };
  const [active] = await connection.execute(
    `SELECT id, person_id AS personId FROM participation_restrictions
     WHERE source_project_id = ? AND source_material_task_id = ?
       AND trigger_reason = 'missing_required_material' AND status = 'active' FOR UPDATE`,
    [projectId, materialTaskId]
  );
  for (const row of active) {
    await connection.execute(
      `UPDATE participation_restrictions SET status = 'released', released_at = NOW(),
       released_by_user_id = ?, release_reason = ?, updated_at = NOW() WHERE id = ?`,
      [actorUserId, reason, row.id]
    );
    await insertEvent(connection, row.id, 'auto_released', actorUserId, 'system', reason, { projectId, materialTaskId });
    await writeProjectAudit(connection, {
      projectId, eventType: 'participation_restriction_released', actorUserId,
      sourceModule: '跨届黑名单', changes: [],
      payload: { summary: `解除跨届限制：${reason}`, restrictionId: Number(row.id), personId: Number(row.personId), materialTaskId }
    });
  }
  return { released: active.length };
}

export async function manuallySetRestriction(connection, restrictionId, nextStatus, actorUserId, reason) {
  const [[record]] = await connection.execute(
    'SELECT * FROM participation_restrictions WHERE id = ? LIMIT 1 FOR UPDATE', [restrictionId]
  );
  if (!record) throw notFound('限制记录不存在');
  if (!['active', 'released'].includes(nextStatus) || record.status === nextStatus) {
    throw badRequest('限制记录当前状态不允许该操作', 'RESTRICTION_STATUS_CONFLICT');
  }
  if (nextStatus === 'released') {
    await connection.execute(
      `UPDATE participation_restrictions SET status = 'released', released_at = NOW(),
       released_by_user_id = ?, release_reason = ?, updated_at = NOW() WHERE id = ?`,
      [actorUserId, reason, restrictionId]
    );
    await insertEvent(connection, restrictionId, 'manual_released', actorUserId, 'super_admin', reason);
  } else {
    await connection.execute(
      `UPDATE participation_restrictions SET status = 'active', released_at = NULL,
       released_by_user_id = NULL, release_reason = NULL, updated_at = NOW() WHERE id = ?`,
      [restrictionId]
    );
    await insertEvent(connection, restrictionId, 'manual_restored', actorUserId, 'super_admin', reason);
  }
  await writeProjectAudit(connection, {
    projectId: Number(record.source_project_id),
    eventType: nextStatus === 'active' ? 'participation_restriction_restored' : 'participation_restriction_released',
    actorUserId, sourceModule: '跨届黑名单', changes: [],
    payload: { summary: `${nextStatus === 'active' ? '恢复' : '手工解除'}跨届限制：${reason}`, restrictionId: Number(restrictionId), personId: Number(record.person_id) }
  });
}

export { reasonLabels };
