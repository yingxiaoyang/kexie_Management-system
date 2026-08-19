import fs from 'node:fs';
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { badRequest, notFound } from '../utils/errors.js';
import { enumValue, nullableText, paginationFrom, requiredText } from '../utils/query.js';
import { success } from '../utils/response.js';
import { assertEligibleProjectOwner, assertFormalProjectOwnership, isFormalProjectStatus } from '../utils/projectOwnership.js';
import { requireAdminPermission, requirePermissionWhenAdmin } from '../utils/adminPermissions.js';
import {
  assertProjectWorkspaceAccess,
  loadProjectWorkspace,
  participationSnapshot,
  projectFieldChanges,
  writeProjectAudit
} from '../services/projectWorkspaceService.js';
import { resolveDownloadFile } from '../utils/safeFiles.js';
import { env } from '../config/env.js';
import { inspectOriginalFileName, setFileResponseHeaders } from '../utils/fileNames.js';
import { assertPeopleEligibleForYear, restrictTerminatedProject, scanOverdueRequiredMaterials } from '../services/participationEligibilityService.js';

const router = Router();
const statuses = ['draft', 'active', 'checking', 'completed', 'archived', 'stopped', 'terminated'];
const approvalTypes = ['first', 'supplement'];

function projectPayload(body) {
  const year = Number(body.projectYear);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw badRequest('projectYear is invalid', 'VALIDATION_ERROR');
  }
  const approvalDate = body.approvalDate || null;
  if (approvalDate) {
    const text = String(approvalDate);
    const parsed = new Date(`${text}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
      throw badRequest('approvalDate is invalid', 'VALIDATION_ERROR');
    }
  }
  return {
    projectYear: year,
    projectGroup: nullableText(body.projectGroup, 80),
    projectCode: requiredText(body.projectCode, 'projectCode', 80),
    title: requiredText(body.title, 'title', 255),
    category: nullableText(body.category, 120),
    approvalDate,
    approvalType: enumValue(body.approvalType, approvalTypes, 'approvalType', 'first'),
    approvalBatch: nullableText(body.approvalBatch, 160),
    status: enumValue(body.status, statuses, 'status', 'active'),
    remark: nullableText(body.remark, 1000)
  };
}

router.get('/', requireAuth, requireRole('admin', 'project_owner'), requirePermissionWhenAdmin('project_management'), async (req, res, next) => {
  try {
    const { page, pageSize, offset } = paginationFrom(req.query);
    const conditions = ['p.deleted_at IS NULL'];
    const params = [];
    if (req.user.role === 'project_owner') {
      conditions.push(`EXISTS (
        SELECT 1 FROM project_participations mine
        WHERE mine.project_id = p.id AND mine.person_id = ? AND mine.role = 'owner' AND mine.deleted_at IS NULL
      )`);
      params.push(req.user.personId || 0);
    }
    if (req.query.year) {
      conditions.push('p.project_year = ?');
      params.push(Number(req.query.year));
    }
    if (req.query.status) {
      conditions.push('p.status = ?');
      params.push(req.query.status);
    }
    if (req.query.group) {
      conditions.push('p.project_group = ?');
      params.push(req.query.group);
    }
    if (req.query.category) {
      conditions.push('p.category = ?');
      params.push(req.query.category);
    }
    if (req.query.keyword) {
      const keyword = `%${String(req.query.keyword).trim()}%`;
      conditions.push(`(p.project_code LIKE ? OR p.title LIKE ? OR EXISTS (
        SELECT 1 FROM project_participations owner_rel
        JOIN people owner_person ON owner_person.id = owner_rel.person_id
        WHERE owner_rel.project_id = p.id AND owner_rel.role = 'owner' AND owner_rel.deleted_at IS NULL
          AND owner_person.name LIKE ?
      ))`);
      params.push(keyword, keyword, keyword);
    }
    const where = conditions.join(' AND ');
    const [[countRow]] = await pool.execute(`SELECT COUNT(*) AS total FROM projects p WHERE ${where}`, params);
    const [items] = await pool.execute(
      `SELECT p.id, p.project_year AS projectYear, p.project_group AS projectGroup,
              p.project_code AS projectCode, p.title, p.category, p.approval_date AS approvalDate,
              p.approval_type AS approvalType, p.approval_batch AS approvalBatch, p.status, p.remark,
              GROUP_CONCAT(DISTINCT CASE WHEN pp.role = 'owner' THEN pe.name END ORDER BY pp.is_primary_owner DESC SEPARATOR '、') AS owners,
              GROUP_CONCAT(DISTINCT CASE WHEN pp.role = 'advisor' THEN pe.name END SEPARATOR '、') AS advisors,
              COUNT(DISTINCT CASE WHEN pp.role = 'member' THEN pp.id END) AS memberCount,
              COUNT(DISTINCT CASE WHEN ms.review_status = 'pending' THEN ms.id END) AS pendingMaterialCount,
              COUNT(DISTINCT ms.id) AS submissionVersionCount
       FROM projects p
       LEFT JOIN project_participations pp ON pp.project_id = p.id AND pp.deleted_at IS NULL
       LEFT JOIN people pe ON pe.id = pp.person_id AND pe.deleted_at IS NULL
       LEFT JOIN material_submissions ms ON ms.project_id = p.id AND ms.deleted_at IS NULL
       WHERE ${where}
       GROUP BY p.id
       ORDER BY p.project_year DESC, p.project_code
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    success(res, items, 'ok', {
      pagination: { page, pageSize, total: Number(countRow.total), totalPages: Math.ceil(Number(countRow.total) / pageSize) }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/', requireAuth, requireRole('admin'), requireAdminPermission('project_management'), async (req, res, next) => {
  let connection;
  try {
    const data = projectPayload(req.body);
    const ownerPersonId = Number(req.body.ownerPersonId || 0) || null;
    if (req.body.ownerPersonId && (!Number.isInteger(ownerPersonId) || ownerPersonId <= 0)) {
      throw badRequest('ownerPersonId is invalid', 'VALIDATION_ERROR');
    }
    if (isFormalProjectStatus(data.status) && !ownerPersonId) {
      throw badRequest('正式状态项目必须选择且只能选择一名负责人', 'FORMAL_PROJECT_OWNER_REQUIRED');
    }
    connection = await pool.getConnection();
    await connection.beginTransaction();
    if (ownerPersonId) {
      await assertEligibleProjectOwner(connection, ownerPersonId);
      await assertPeopleEligibleForYear(connection, [ownerPersonId], data.projectYear, '项目负责人');
    }
    const [result] = await connection.execute(
      `INSERT INTO projects
       (project_year, project_group, project_code, title, category, approval_date, approval_type, approval_batch, status, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.projectYear, data.projectGroup, data.projectCode, data.title, data.category, data.approvalDate, data.approvalType, data.approvalBatch, data.status, data.remark]
    );
    if (ownerPersonId) {
      await connection.execute(
        `INSERT INTO project_participations (project_id, person_id, role, is_primary_owner, joined_at)
         VALUES (?, ?, 'owner', 1, ?)`,
        [result.insertId, ownerPersonId, data.approvalDate]
      );
    }
    await assertFormalProjectOwnership(connection, [Number(result.insertId)]);
    await scanOverdueRequiredMaterials(connection, { projectId: Number(result.insertId), actorUserId: req.user.id, triggerSource: 'business_event' });
    await writeProjectAudit(connection, {
      projectId: Number(result.insertId), eventType: 'project_created', actorUserId: req.user.id,
      changes: projectFieldChanges({}, data), payload: { summary: '管理员创建项目记录' }
    });
    await connection.commit();
    success(res, { id: result.insertId }, 'Project created');
  } catch (error) {
    await connection?.rollback().catch(() => undefined);
    if (error.code === 'ER_DUP_ENTRY') {
      error.status = 409;
      error.code = 'DUPLICATE_RESOURCE';
      error.message = '项目编号或负责人关系与现有数据冲突';
    }
    next(error);
  } finally { connection?.release(); }
});

router.put('/:id', requireAuth, requireRole('admin'), requireAdminPermission('project_management'), async (req, res, next) => {
  let connection;
  try {
    const data = projectPayload(req.body);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[project]] = await connection.execute(
      `SELECT id, project_year AS projectYear, project_group AS projectGroup, project_code AS projectCode,
              title, category, approval_date AS approvalDate, approval_type AS approvalType,
              approval_batch AS approvalBatch, status, remark
       FROM projects WHERE id = ? AND deleted_at IS NULL FOR UPDATE`, [req.params.id]
    );
    if (!project) throw notFound('Project not found');
    const [[currentOwner]] = await connection.execute(
      "SELECT person_id FROM project_participations WHERE project_id = ? AND role = 'owner' AND deleted_at IS NULL LIMIT 1 FOR UPDATE",
      [project.id]
    );
    const requestedOwnerId = req.body.ownerPersonId === undefined || req.body.ownerPersonId === null || req.body.ownerPersonId === ''
      ? null : Number(req.body.ownerPersonId);
    if (requestedOwnerId !== null && (!Number.isInteger(requestedOwnerId) || requestedOwnerId <= 0)) {
      throw badRequest('ownerPersonId is invalid', 'VALIDATION_ERROR');
    }
    if (requestedOwnerId && currentOwner && Number(currentOwner.person_id) !== requestedOwnerId) {
      throw badRequest('不能通过项目基础信息接口替换负责人，请走负责人变更审批', 'PROJECT_OWNER_CHANGE_REQUIRES_APPROVAL');
    }
    if (!currentOwner && isFormalProjectStatus(data.status)) {
      throw badRequest('普通项目编辑不能新增或更换负责人，请走负责人变更审批', 'PROJECT_OWNER_CHANGE_REQUIRES_APPROVAL');
    }
    if (requestedOwnerId && !currentOwner) throw badRequest('普通项目编辑不能新增或更换负责人，请走负责人变更审批', 'PROJECT_OWNER_CHANGE_REQUIRES_APPROVAL');
    const [result] = await connection.execute(
      `UPDATE projects SET project_year = ?, project_group = ?, project_code = ?, title = ?, category = ?,
       approval_date = ?, approval_type = ?, approval_batch = ?, status = ?, remark = ?, updated_at = NOW()
       WHERE id = ? AND deleted_at IS NULL`,
      [data.projectYear, data.projectGroup, data.projectCode, data.title, data.category, data.approvalDate, data.approvalType, data.approvalBatch, data.status, data.remark, req.params.id]
    );
    if (!result.affectedRows) throw notFound('Project not found');
    await assertFormalProjectOwnership(connection, [Number(project.id)]);
    if (!['stopped', 'terminated'].includes(project.status) && ['stopped', 'terminated'].includes(data.status)) {
      await restrictTerminatedProject(connection, Number(project.id), { actorUserId: req.user.id, triggerSource: 'business_event' });
    }
    await scanOverdueRequiredMaterials(connection, { projectId: Number(project.id), actorUserId: req.user.id, triggerSource: 'business_event' });
    const changes = projectFieldChanges(project, data);
    if (changes.length) {
      await writeProjectAudit(connection, {
        projectId: Number(project.id), eventType: data.status !== project.status ? 'project_status_changed' : 'project_fields_changed',
        actorUserId: req.user.id, changes,
        payload: { summary: data.status !== project.status ? `项目状态由 ${project.status} 变更为 ${data.status}` : `修改 ${changes.length} 个项目字段` }
      });
    }
    await connection.commit();
    success(res, null, 'Project updated');
  } catch (error) {
    await connection?.rollback().catch(() => undefined);
    if (error.code === 'ER_DUP_ENTRY') {
      error.status = 409;
      error.code = 'DUPLICATE_RESOURCE';
      error.message = '项目编号或负责人关系与现有数据冲突';
    }
    next(error);
  } finally { connection?.release(); }
});

router.get('/:id/workspace', requireAuth, requireRole('admin', 'project_owner'), requirePermissionWhenAdmin('project_management'), async (req, res, next) => {
  try {
    const data = await loadProjectWorkspace(pool, Number(req.params.id), req.user);
    success(res, data);
  } catch (error) {
    next(error);
  }
});

router.get('/:id/material-files/:fileId/download', requireAuth, requireRole('admin', 'project_owner'), requirePermissionWhenAdmin('project_management'), async (req, res, next) => {
  try {
    await assertProjectWorkspaceAccess(pool, Number(req.params.id), req.user);
    const [[file]] = await pool.execute(
      `SELECT mf.original_name AS originalName, mf.storage_path AS storagePath
       FROM material_files mf
       JOIN material_submissions ms ON ms.id = mf.submission_id AND ms.deleted_at IS NULL
       WHERE mf.id = ? AND ms.project_id = ? AND mf.deleted_at IS NULL LIMIT 1`,
      [req.params.fileId, req.params.id]
    );
    if (!file) throw notFound('File not found');
    const filePath = await resolveDownloadFile(env.upload.root, file.storagePath, {
      invalidMessage: 'Submission file path is outside the system upload directory',
      invalidCode: 'SUBMISSION_FILE_PATH_INVALID',
      missingMessage: 'Submission file not found'
    });
    const fileName = inspectOriginalFileName(file.originalName).displayName;
    setFileResponseHeaders(res, { fileName, contentType: 'application/octet-stream' });
    fs.createReadStream(filePath).on('error', next).pipe(res);
  } catch (error) {
    next(error);
  }
});

router.put('/:id/participations', requireAuth, requireRole('admin'), requireAdminPermission('project_management'), async (req, res, next) => {
  let connection;
  try {
    if (!Array.isArray(req.body.memberPersonIds) || !Array.isArray(req.body.advisorPersonIds)) {
      throw badRequest('memberPersonIds 和 advisorPersonIds 必须是数组', 'VALIDATION_ERROR');
    }
    const memberIds = [...new Set((req.body.memberPersonIds || []).map(Number))];
    const advisorIds = [...new Set((req.body.advisorPersonIds || []).map(Number))];
    if (memberIds.some((id) => !Number.isInteger(id) || id <= 0) || advisorIds.some((id) => !Number.isInteger(id) || id <= 0)) {
      throw badRequest('人员编号无效', 'VALIDATION_ERROR');
    }
    if (memberIds.some((id) => advisorIds.includes(id))) throw badRequest('同一人员不能同时作为成员和指导教师', 'VALIDATION_ERROR');
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[project]] = await connection.execute('SELECT id, project_year AS projectYear FROM projects WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [req.params.id]);
    if (!project) throw notFound('Project not found');
    const [beforeRows] = await connection.execute(
      `SELECT pp.id, pp.person_id AS personId, pp.role, pp.joined_at AS joinedAt, pp.remark, pe.name,
              COALESCE(pe.student_no, pe.teacher_no) AS identifier, COALESCE(pe.college, pe.unit) AS organization
       FROM project_participations pp JOIN people pe ON pe.id = pp.person_id
       WHERE pp.project_id = ? AND pp.deleted_at IS NULL ORDER BY pp.role, pp.person_id FOR UPDATE`, [project.id]
    );
    const owner = beforeRows.find((row) => row.role === 'owner');
    if (!owner) throw badRequest('负责人关系缺失，普通人员维护不能补建或更换负责人', 'PROJECT_OWNER_CHANGE_REQUIRES_APPROVAL');
    const requestedIds = [...memberIds, ...advisorIds];
    if (requestedIds.length) {
      const [people] = await connection.execute(
        `SELECT id, person_type AS personType FROM people WHERE id IN (${requestedIds.map(() => '?').join(',')}) AND deleted_at IS NULL FOR UPDATE`, requestedIds
      );
      if (people.length !== requestedIds.length) throw badRequest('成员或指导教师不存在', 'VALIDATION_ERROR');
      const typeMap = new Map(people.map((person) => [Number(person.id), person.personType]));
      if (memberIds.some((id) => typeMap.get(id) !== 'student')) throw badRequest('项目成员必须是学生', 'PROJECT_MEMBER_MUST_BE_STUDENT');
      if (advisorIds.some((id) => typeMap.get(id) !== 'teacher')) throw badRequest('指导教师必须是教师', 'PROJECT_ADVISOR_MUST_BE_TEACHER');
    }
    if (memberIds.includes(Number(owner.personId))) throw badRequest('负责人不能重复添加为项目成员', 'VALIDATION_ERROR');
    await assertPeopleEligibleForYear(connection, memberIds, project.projectYear, '项目成员');
    if (memberIds.length) {
      const [[memberRule]] = await connection.execute(
        "SELECT limit_count AS limitCount FROM participation_rules WHERE rule_key = 'max_member_projects_per_person' AND enabled = 1 LIMIT 1 FOR UPDATE"
      );
      if (memberRule) {
        const [memberCounts] = await connection.execute(
          `SELECT pp.person_id AS personId, COUNT(DISTINCT pp.project_id) AS projectCount
           FROM project_participations pp JOIN projects p ON p.id = pp.project_id AND p.deleted_at IS NULL
           WHERE pp.role = 'member' AND pp.deleted_at IS NULL AND pp.project_id <> ?
             AND pp.person_id IN (${memberIds.map(() => '?').join(',')})
           GROUP BY pp.person_id FOR UPDATE`, [project.id, ...memberIds]
        );
        const overLimit = memberCounts.filter((row) => Number(row.projectCount) >= Number(memberRule.limitCount));
        if (overLimit.length) throw badRequest('所选成员已达到可参与项目数量上限', 'PARTICIPATION_RULE_EXCEEDED');
      }
    }
    await connection.execute("UPDATE project_participations SET deleted_at = NOW(), updated_at = NOW() WHERE project_id = ? AND role IN ('member','advisor') AND deleted_at IS NULL", [project.id]);
    for (const [role, ids] of [['member', memberIds], ['advisor', advisorIds]]) {
      for (const personId of ids) {
        const [[existing]] = await connection.execute('SELECT id FROM project_participations WHERE project_id = ? AND person_id = ? AND role = ? LIMIT 1 FOR UPDATE', [project.id, personId, role]);
        if (existing) {
          await connection.execute('UPDATE project_participations SET deleted_at = NULL, updated_at = NOW() WHERE id = ?', [existing.id]);
        } else {
          await connection.execute('INSERT INTO project_participations (project_id, person_id, role, is_primary_owner) VALUES (?, ?, ?, 0)', [project.id, personId, role]);
        }
      }
    }
    const [afterRows] = await connection.execute(
      `SELECT pp.id, pp.person_id AS personId, pp.role, pp.joined_at AS joinedAt, pp.remark, pe.name,
              COALESCE(pe.student_no, pe.teacher_no) AS identifier, COALESCE(pe.college, pe.unit) AS organization
       FROM project_participations pp JOIN people pe ON pe.id = pp.person_id
       WHERE pp.project_id = ? AND pp.deleted_at IS NULL ORDER BY pp.role, pp.person_id`, [project.id]
    );
    const beforeSnapshot = participationSnapshot(beforeRows);
    const afterSnapshot = participationSnapshot(afterRows);
    if (JSON.stringify(beforeSnapshot) !== JSON.stringify(afterSnapshot)) {
      await writeProjectAudit(connection, {
        projectId: Number(project.id), eventType: 'participations_changed', actorUserId: req.user.id,
        payload: { summary: '管理员维护项目成员/指导教师关系', beforeSnapshot, afterSnapshot }
      });
    }
    await assertFormalProjectOwnership(connection, [Number(project.id)]);
    await scanOverdueRequiredMaterials(connection, { projectId: Number(project.id), actorUserId: req.user.id, triggerSource: 'business_event' });
    await connection.commit();
    success(res, { participations: afterSnapshot }, 'Project participations updated');
  } catch (error) {
    await connection?.rollback().catch(() => undefined);
    next(error);
  } finally { connection?.release(); }
});

router.get('/:id/participations', requireAuth, requireRole('admin', 'project_owner'), requirePermissionWhenAdmin('project_management'), async (req, res, next) => {
  try {
    if (req.user.role === 'project_owner') {
      const [[allowed]] = await pool.execute(
        `SELECT 1 FROM project_participations WHERE project_id = ? AND person_id = ? AND role = 'owner' AND deleted_at IS NULL LIMIT 1`,
        [req.params.id, req.user.personId || 0]
      );
      if (!allowed) throw notFound('Project not found');
    }
    const [items] = await pool.execute(
      `SELECT pp.id, pp.role, pp.is_primary_owner AS isPrimaryOwner, pp.joined_at AS joinedAt,
              pe.id AS personId, pe.person_type AS personType, pe.name,
              COALESCE(pe.student_no, pe.teacher_no) AS identifier,
              COALESCE(pe.college, pe.unit) AS organization, pe.phone, pe.qq, pe.email, pe.title
       FROM project_participations pp
       JOIN people pe ON pe.id = pp.person_id AND pe.deleted_at IS NULL
       WHERE pp.project_id = ? AND pp.deleted_at IS NULL
       ORDER BY FIELD(pp.role, 'owner', 'member', 'advisor'), pp.is_primary_owner DESC, pe.name`,
      [req.params.id]
    );
    success(res, items);
  } catch (error) {
    next(error);
  }
});

export default router;
