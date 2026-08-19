import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { badRequest, notFound } from '../utils/errors.js';
import { enumValue, nullableText, paginationFrom, requiredText } from '../utils/query.js';
import { success } from '../utils/response.js';
import { assertEligibleProjectOwner, assertFormalProjectOwnership, isFormalProjectStatus } from '../utils/projectOwnership.js';
import { requireAdminPermission, requirePermissionWhenAdmin } from '../utils/adminPermissions.js';

const router = Router();
const statuses = ['draft', 'active', 'checking', 'completed', 'archived', 'stopped'];
const approvalTypes = ['first', 'supplement'];

function projectPayload(body) {
  const year = Number(body.projectYear);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw badRequest('projectYear is invalid', 'VALIDATION_ERROR');
  }
  return {
    projectYear: year,
    projectGroup: nullableText(body.projectGroup, 80),
    projectCode: requiredText(body.projectCode, 'projectCode', 80),
    title: requiredText(body.title, 'title', 255),
    category: nullableText(body.category, 120),
    approvalDate: body.approvalDate || null,
    approvalType: enumValue(body.approvalType, approvalTypes, 'approvalType', 'first'),
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
              p.approval_type AS approvalType, p.status, p.remark,
              GROUP_CONCAT(DISTINCT CASE WHEN pp.role = 'owner' THEN pe.name END ORDER BY pp.is_primary_owner DESC SEPARATOR '、') AS owners,
              GROUP_CONCAT(DISTINCT CASE WHEN pp.role = 'advisor' THEN pe.name END SEPARATOR '、') AS advisors
       FROM projects p
       LEFT JOIN project_participations pp ON pp.project_id = p.id AND pp.deleted_at IS NULL
       LEFT JOIN people pe ON pe.id = pp.person_id AND pe.deleted_at IS NULL
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
    if (isFormalProjectStatus(data.status) && !ownerPersonId) {
      throw badRequest('正式状态项目必须选择且只能选择一名负责人', 'FORMAL_PROJECT_OWNER_REQUIRED');
    }
    connection = await pool.getConnection();
    await connection.beginTransaction();
    if (ownerPersonId) await assertEligibleProjectOwner(connection, ownerPersonId);
    const [result] = await connection.execute(
      `INSERT INTO projects
       (project_year, project_group, project_code, title, category, approval_date, approval_type, status, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.projectYear, data.projectGroup, data.projectCode, data.title, data.category, data.approvalDate, data.approvalType, data.status, data.remark]
    );
    if (ownerPersonId) {
      await connection.execute(
        `INSERT INTO project_participations (project_id, person_id, role, is_primary_owner, joined_at)
         VALUES (?, ?, 'owner', 1, ?)`,
        [result.insertId, ownerPersonId, data.approvalDate]
      );
    }
    await assertFormalProjectOwnership(connection, [Number(result.insertId)]);
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
    const ownerPersonId = Number(req.body.ownerPersonId || 0) || null;
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[project]] = await connection.execute('SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [req.params.id]);
    if (!project) throw notFound('Project not found');
    const [[currentOwner]] = await connection.execute(
      "SELECT person_id FROM project_participations WHERE project_id = ? AND role = 'owner' AND deleted_at IS NULL LIMIT 1 FOR UPDATE",
      [project.id]
    );
    if (ownerPersonId && currentOwner && Number(currentOwner.person_id) !== ownerPersonId) {
      throw badRequest('不能通过项目基础信息接口替换负责人，请使用人员关系变更流程', 'PROJECT_OWNER_CHANGE_REQUIRES_RELATION_FLOW');
    }
    if (ownerPersonId && !currentOwner) {
      await assertEligibleProjectOwner(connection, ownerPersonId, Number(project.id));
      await connection.execute(
        `INSERT INTO project_participations (project_id, person_id, role, is_primary_owner, joined_at)
         VALUES (?, ?, 'owner', 1, ?)`,
        [project.id, ownerPersonId, data.approvalDate]
      );
    }
    const [result] = await connection.execute(
      `UPDATE projects SET project_year = ?, project_group = ?, project_code = ?, title = ?, category = ?,
       approval_date = ?, approval_type = ?, status = ?, remark = ?, updated_at = NOW()
       WHERE id = ? AND deleted_at IS NULL`,
      [data.projectYear, data.projectGroup, data.projectCode, data.title, data.category, data.approvalDate, data.approvalType, data.status, data.remark, req.params.id]
    );
    if (!result.affectedRows) throw notFound('Project not found');
    await assertFormalProjectOwnership(connection, [Number(project.id)]);
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
