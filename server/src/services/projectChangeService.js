import { badRequest, conflict, notFound } from '../utils/errors.js';
import { normalizeChangePlan, assertPlanWithinScope, changeSummary } from '../utils/projectChange.js';
import { participationSnapshot, writeProjectAudit } from './projectWorkspaceService.js';
import { assertPeopleEligibleForYear, scanOverdueRequiredMaterials } from './participationEligibilityService.js';

function json(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function relationFingerprint(rows) {
  return (rows || []).map((row) => `${Number(row.personId ?? row.person_id)}:${row.role}`).sort();
}

export async function loadProjectChangeSnapshot(connection, projectId) {
  const [[project]] = await connection.execute(
    `SELECT id, project_code AS projectCode, title, project_year AS projectYear,
            project_group AS projectGroup, category, status
     FROM projects WHERE id = ? AND deleted_at IS NULL LIMIT 1`, [projectId]
  );
  if (!project) throw notFound('项目不存在');
  const [participationRows] = await connection.execute(
    `SELECT pp.id, pp.person_id AS personId, pp.role, pp.joined_at AS joinedAt, pp.remark,
            pe.name, COALESCE(pe.student_no, pe.teacher_no) AS identifier,
            COALESCE(pe.college, pe.unit) AS organization
     FROM project_participations pp
     JOIN people pe ON pe.id = pp.person_id
     WHERE pp.project_id = ? AND pp.deleted_at IS NULL
     ORDER BY FIELD(pp.role, 'owner', 'member', 'advisor'), pe.name`, [projectId]
  );
  const participations = participationSnapshot(participationRows);
  return { project, participations };
}

export async function assertProjectOwnerCandidateQualified(connection, personId, projectId, { lock = false } = {}) {
  const suffix = lock ? ' FOR UPDATE' : '';
  const [[person]] = await connection.execute(
    `SELECT id, person_type AS personType, name, student_no AS studentNo,
            account_status AS accountStatus, deleted_at AS deletedAt
     FROM people WHERE id = ? LIMIT 1${suffix}`, [personId]
  );
  if (!person || person.deletedAt) throw notFound('候选负责人不存在');
  if (person.personType !== 'student') throw badRequest('新负责人必须是学生', 'PROJECT_OWNER_MUST_BE_STUDENT');
  if (person.accountStatus === 'disabled') throw badRequest('候选负责人已被禁用', 'PROJECT_OWNER_PERSON_DISABLED');
  const [[account]] = await connection.execute(
    `SELECT id, username, role, status FROM users
     WHERE person_id = ? AND deleted_at IS NULL LIMIT 1${suffix}`, [personId]
  );
  if (!account) {
    throw badRequest('候选负责人尚无账号，请其先使用学号自行注册', 'PROJECT_OWNER_REGISTRATION_REQUIRED');
  }
  if (!['applicant', 'project_owner'].includes(account.role)) {
    throw badRequest('候选负责人账号角色不兼容，请先处理账号数据', 'PROJECT_OWNER_ACCOUNT_ROLE_INVALID');
  }
  if (account.username !== person.studentNo) {
    throw conflict('候选负责人账号与学号不一致，请先处理账号数据', 'PROJECT_OWNER_ACCOUNT_MISMATCH');
  }
  if (account.status !== 'enabled') throw badRequest('候选负责人账号未启用', 'PROJECT_OWNER_ACCOUNT_DISABLED');
  const [[owned]] = await connection.execute(
    `SELECT pp.project_id AS projectId, p.project_code AS projectCode
     FROM project_participations pp
     JOIN projects p ON p.id = pp.project_id AND p.deleted_at IS NULL
     WHERE pp.person_id = ? AND pp.role = 'owner' AND pp.deleted_at IS NULL AND pp.project_id <> ?
     LIMIT 1${suffix}`, [personId, projectId]
  );
  if (owned) throw conflict(`候选负责人已负责项目 ${owned.projectCode}`, 'PROJECT_OWNER_CONFLICT');
  return { person, account };
}

async function validatePlanPeople(connection, plan, currentOwnerId, projectId, lock = false) {
  const memberIds = [...new Set([...plan.members.addPersonIds, ...plan.members.removePersonIds])];
  const advisorIds = [...new Set([...plan.advisors.addPersonIds, ...plan.advisors.removePersonIds])];
  const allIds = [...new Set([...memberIds, ...advisorIds])];
  if (allIds.length) {
    const [rows] = await connection.execute(
      `SELECT id, person_type AS personType, deleted_at AS deletedAt FROM people
       WHERE id IN (${allIds.map(() => '?').join(',')})${lock ? ' FOR UPDATE' : ''}`, allIds
    );
    const map = new Map(rows.map((row) => [Number(row.id), row]));
    for (const id of memberIds) {
      const person = map.get(id);
      if (!person || person.deletedAt || person.personType !== 'student') throw badRequest('项目成员必须是有效学生', 'PROJECT_MEMBER_INVALID');
    }
    for (const id of advisorIds) {
      const person = map.get(id);
      if (!person || person.deletedAt || person.personType !== 'teacher') throw badRequest('指导教师必须是有效教师', 'PROJECT_ADVISOR_INVALID');
    }
  }
  if (plan.members.removePersonIds.includes(Number(currentOwnerId))) {
    throw badRequest('不能通过成员变更移除当前负责人', 'PROJECT_OWNER_CHANGE_REQUIRED');
  }
  if (plan.ownerChange) {
    if (Number(plan.ownerChange.newOwnerPersonId) === Number(currentOwnerId)) {
      throw badRequest('新负责人不能与当前负责人相同', 'PROJECT_OWNER_UNCHANGED');
    }
    await assertProjectOwnerCandidateQualified(connection, plan.ownerChange.newOwnerPersonId, projectId, { lock });
  }
  const [[project]] = await connection.execute(
    'SELECT project_year AS projectYear FROM projects WHERE id = ? AND deleted_at IS NULL LIMIT 1', [projectId]
  );
  await assertPeopleEligibleForYear(connection,
    [...plan.members.addPersonIds, ...(plan.ownerChange ? [plan.ownerChange.newOwnerPersonId] : [])],
    project.projectYear, '项目变更');
}

export async function validateProjectChangePlan(connection, { projectId, plan: rawPlan, changeScope, lock = false }) {
  const plan = normalizeChangePlan(rawPlan);
  assertPlanWithinScope(plan, json(changeScope));
  const [[owner]] = await connection.execute(
    `SELECT person_id AS personId FROM project_participations
     WHERE project_id = ? AND role = 'owner' AND deleted_at IS NULL LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [projectId]
  );
  if (!owner) throw conflict('项目当前负责人关系异常，无法提交变更', 'PROJECT_OWNER_MISSING');
  await validatePlanPeople(connection, plan, owner.personId, projectId, lock);
  return { plan, currentOwnerId: Number(owner.personId) };
}

async function removeParticipation(connection, projectId, personId, role) {
  await connection.execute(
    `UPDATE project_participations SET deleted_at = NOW(), updated_at = NOW()
     WHERE project_id = ? AND person_id = ? AND role = ? AND deleted_at IS NULL`,
    [projectId, personId, role]
  );
}

async function addParticipation(connection, projectId, personId, role, primary = false) {
  const [[existing]] = await connection.execute(
    `SELECT id FROM project_participations WHERE project_id = ? AND person_id = ? AND role = ? LIMIT 1 FOR UPDATE`,
    [projectId, personId, role]
  );
  if (existing) {
    await connection.execute(
      `UPDATE project_participations SET deleted_at = NULL, is_primary_owner = ?, updated_at = NOW() WHERE id = ?`,
      [primary ? 1 : 0, existing.id]
    );
  } else {
    await connection.execute(
      `INSERT INTO project_participations (project_id, person_id, role, is_primary_owner, joined_at)
       VALUES (?, ?, ?, ?, CURRENT_DATE)`, [projectId, personId, role, primary ? 1 : 0]
    );
  }
}

async function transferOwner(connection, projectId, oldOwnerId, ownerChange) {
  const newOwnerId = Number(ownerChange.newOwnerPersonId);
  const { account: newAccount } = await assertProjectOwnerCandidateQualified(connection, newOwnerId, projectId, { lock: true });
  // 先移除新负责人的成员身份，避免同一人在项目中同时保留 owner/member。
  await removeParticipation(connection, projectId, newOwnerId, 'member');
  await removeParticipation(connection, projectId, oldOwnerId, 'owner');
  if (ownerChange.previousOwnerDisposition === 'member') await addParticipation(connection, projectId, oldOwnerId, 'member');
  await addParticipation(connection, projectId, newOwnerId, 'owner', true);
  await connection.execute(
    `UPDATE users SET role = 'project_owner', admin_level = NULL, token_version = token_version + 1, updated_at = NOW()
     WHERE id = ? AND role IN ('applicant', 'project_owner')`, [newAccount.id]
  );
  const [[oldAccount]] = await connection.execute(
    `SELECT id FROM users WHERE person_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`, [oldOwnerId]
  );
  if (oldAccount) {
    const [[remaining]] = await connection.execute(
      `SELECT id FROM project_participations WHERE person_id = ? AND role = 'owner' AND deleted_at IS NULL LIMIT 1 FOR UPDATE`, [oldOwnerId]
    );
    if (!remaining) {
      await connection.execute(
        `UPDATE users SET role = 'applicant', admin_level = NULL, token_version = token_version + 1, updated_at = NOW()
         WHERE id = ? AND role = 'project_owner'`, [oldAccount.id]
      );
    }
  }
  return { oldOwnerId, newOwnerId, newOwnerUserId: Number(newAccount.id) };
}

export async function reviewProjectChangeSubmission(connection, {
  submissionId, action, reason, reviewer, expectedAssignmentVersion
}) {
  const [[row]] = await connection.execute(
    `SELECT pcr.id, pcr.project_id AS projectId, pcr.status, pcr.current_version AS currentVersion,
            pcr.latest_submission_id AS latestSubmissionId, pcr.proposed_changes AS proposedChanges,
            mt.change_scope AS changeScope, pcv.before_snapshot AS beforeSnapshot
     FROM project_change_requests pcr
     JOIN material_tasks mt ON mt.id = pcr.material_task_id
     JOIN project_change_versions pcv ON pcv.change_request_id = pcr.id
       AND pcv.version_no = pcr.current_version AND pcv.material_submission_id = ?
     WHERE pcr.latest_submission_id = ? LIMIT 1 FOR UPDATE`, [submissionId, submissionId]
  );
  if (!row) throw conflict('变更方案版本与材料版本不匹配，请刷新后重试', 'PROJECT_CHANGE_VERSION_MISMATCH');
  if (row.status !== 'submitted' || Number(row.latestSubmissionId) !== Number(submissionId)) {
    throw conflict('该变更申请不是当前待审版本', 'PROJECT_CHANGE_STALE_VERSION');
  }
  if (action === 'return') {
    await connection.execute(
      `UPDATE project_change_requests SET status = 'returned', return_reason = ?, reviewed_by = ?,
       reviewed_at = NOW(), updated_at = NOW() WHERE id = ? AND status = 'submitted'`,
      [reason, reviewer.id, row.id]
    );
    await connection.execute(
      `INSERT INTO project_change_audit_events
       (change_request_id, project_id, version_no, event_type, actor_user_id, material_submission_id, event_payload)
       VALUES (?, ?, ?, 'returned', ?, ?, CAST(? AS JSON))`,
      [row.id, row.projectId, row.currentVersion, reviewer.id, submissionId, JSON.stringify({ reason, assignmentVersion: expectedAssignmentVersion })]
    );
    return { changeRequestId: Number(row.id), effective: false };
  }
  const { plan, currentOwnerId } = await validateProjectChangePlan(connection, {
    projectId: row.projectId, plan: json(row.proposedChanges), changeScope: json(row.changeScope), lock: true
  });
  const actualBefore = await loadProjectChangeSnapshot(connection, row.projectId);
  const frozenBefore = json(row.beforeSnapshot);
  if (JSON.stringify(relationFingerprint(actualBefore.participations)) !== JSON.stringify(relationFingerprint(frozenBefore.participations))) {
    throw conflict('项目人员关系已在待审期间发生变化，请退回后重新提交', 'PROJECT_CHANGE_BASELINE_CONFLICT');
  }
  for (const id of plan.members.removePersonIds) await removeParticipation(connection, row.projectId, id, 'member');
  for (const id of plan.advisors.removePersonIds) await removeParticipation(connection, row.projectId, id, 'advisor');
  for (const id of plan.members.addPersonIds) await addParticipation(connection, row.projectId, id, 'member');
  for (const id of plan.advisors.addPersonIds) await addParticipation(connection, row.projectId, id, 'advisor');
  let ownershipTransfer = null;
  if (plan.ownerChange) ownershipTransfer = await transferOwner(connection, row.projectId, currentOwnerId, plan.ownerChange);
  const [[ownerCount]] = await connection.execute(
    `SELECT COUNT(*) AS count FROM project_participations
     WHERE project_id = ? AND role = 'owner' AND deleted_at IS NULL`, [row.projectId]
  );
  if (Number(ownerCount.count) !== 1) throw conflict('负责人转移未能保持唯一负责人，操作已回滚', 'PROJECT_OWNER_ATOMICITY_FAILED');
  const after = await loadProjectChangeSnapshot(connection, row.projectId);
  await scanOverdueRequiredMaterials(connection, {
    projectId: Number(row.projectId), actorUserId: reviewer.id, triggerSource: 'business_event'
  });
  await connection.execute(
    `UPDATE project_change_requests SET status = 'approved', return_reason = NULL, reviewed_by = ?,
     reviewed_at = NOW(), effective_at = NOW(), updated_at = NOW() WHERE id = ? AND status = 'submitted'`,
    [reviewer.id, row.id]
  );
  await connection.execute(
    `INSERT INTO project_change_audit_events
     (change_request_id, project_id, version_no, event_type, actor_user_id, material_submission_id, event_payload)
     VALUES (?, ?, ?, 'approved', ?, ?, CAST(? AS JSON))`,
    [row.id, row.projectId, row.currentVersion, reviewer.id, submissionId,
      JSON.stringify({ summary: changeSummary(plan), beforeSnapshot: frozenBefore, afterSnapshot: after, ownershipTransfer, assignmentVersion: expectedAssignmentVersion })]
  );
  await writeProjectAudit(connection, {
    projectId: row.projectId, eventType: 'project_change_approved', actorUserId: reviewer.id,
    sourceModule: '项目变更审批', changes: [],
    payload: { summary: `项目变更审批通过：${changeSummary(plan)}`, changeRequestId: Number(row.id), version: Number(row.currentVersion), beforeSnapshot: frozenBefore, afterSnapshot: after }
  });
  return { changeRequestId: Number(row.id), effective: true, ownershipTransfer };
}

export { json as parseProjectChangeJson };
