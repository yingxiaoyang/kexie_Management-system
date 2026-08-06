import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { badRequest, notFound } from '../utils/errors.js';
import { enumValue, nullableText, paginationFrom, requiredText } from '../utils/query.js';
import { success } from '../utils/response.js';

const router = Router();

function personPayload(body) {
  const personType = enumValue(body.personType, ['student', 'teacher'], 'personType');
  const studentNo = personType === 'student' ? requiredText(body.studentNo, 'studentNo', 40) : null;
  const teacherNo = personType === 'teacher' ? requiredText(body.teacherNo, 'teacherNo', 40) : null;
  return {
    personType,
    name: requiredText(body.name, 'name', 80),
    studentNo,
    teacherNo,
    college: nullableText(body.college, 120),
    unit: nullableText(body.unit, 120),
    phone: nullableText(body.phone, 40),
    qq: nullableText(body.qq, 40),
    email: nullableText(body.email, 120),
    title: nullableText(body.title, 120),
    remark: nullableText(body.remark, 500)
  };
}

router.get('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { page, pageSize, offset } = paginationFrom(req.query);
    const conditions = ['pe.deleted_at IS NULL'];
    const params = [];
    if (req.query.personType) {
      conditions.push('pe.person_type = ?');
      params.push(req.query.personType);
    }
    if (req.query.keyword) {
      const keyword = `%${String(req.query.keyword).trim()}%`;
      conditions.push(`(pe.name LIKE ? OR pe.student_no LIKE ? OR pe.teacher_no LIKE ? OR pe.phone LIKE ?
        OR pe.qq LIKE ? OR pe.email LIKE ? OR pe.college LIKE ? OR pe.unit LIKE ?)`);
      params.push(keyword, keyword, keyword, keyword, keyword, keyword, keyword, keyword);
    }
    const where = conditions.join(' AND ');
    const [[countRow]] = await pool.execute(`SELECT COUNT(*) AS total FROM people pe WHERE ${where}`, params);
    const [items] = await pool.execute(
      `SELECT pe.id, pe.person_type AS personType, pe.name, pe.student_no AS studentNo, pe.teacher_no AS teacherNo,
              COALESCE(pe.student_no, pe.teacher_no) AS identifier, pe.college, pe.unit,
              COALESCE(pe.college, pe.unit) AS organization, pe.phone, pe.qq, pe.email, pe.title,
              pe.account_status AS accountStatus,
              SUM(CASE WHEN pp.role = 'owner' AND pp.deleted_at IS NULL THEN 1 ELSE 0 END) AS ownerProjectCount,
              SUM(CASE WHEN pp.role = 'member' AND pp.deleted_at IS NULL THEN 1 ELSE 0 END) AS memberProjectCount
       FROM people pe
       LEFT JOIN project_participations pp ON pp.person_id = pe.id
       WHERE ${where}
       GROUP BY pe.id
       ORDER BY pe.name, pe.id
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

router.post('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const data = personPayload(req.body);
    const [result] = await pool.execute(
      `INSERT INTO people
       (person_type, name, student_no, teacher_no, college, unit, phone, qq, email, title, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.personType, data.name, data.studentNo, data.teacherNo, data.college, data.unit, data.phone, data.qq, data.email, data.title, data.remark]
    );
    success(res, { id: result.insertId }, 'Person created');
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      error.status = 409;
      error.code = 'DUPLICATE_RESOURCE';
      error.message = 'Student number or teacher number already exists';
    }
    next(error);
  }
});

router.put('/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const data = personPayload(req.body);
    const [result] = await pool.execute(
      `UPDATE people SET person_type = ?, name = ?, student_no = ?, teacher_no = ?, college = ?, unit = ?,
       phone = ?, qq = ?, email = ?, title = ?, remark = ?, updated_at = NOW()
       WHERE id = ? AND deleted_at IS NULL`,
      [data.personType, data.name, data.studentNo, data.teacherNo, data.college, data.unit, data.phone, data.qq, data.email, data.title, data.remark, req.params.id]
    );
    if (!result.affectedRows) throw notFound('Person not found');
    success(res, null, 'Person updated');
  } catch (error) {
    next(error);
  }
});

router.get('/:id/projects', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const [items] = await pool.execute(
      `SELECT p.id, p.project_code AS projectCode, p.title, p.project_year AS projectYear,
              p.project_group AS projectGroup, p.status, pp.role, pp.is_primary_owner AS isPrimaryOwner
       FROM project_participations pp
       JOIN projects p ON p.id = pp.project_id AND p.deleted_at IS NULL
       WHERE pp.person_id = ? AND pp.deleted_at IS NULL
       ORDER BY p.project_year DESC, p.project_code`,
      [req.params.id]
    );
    success(res, items);
  } catch (error) {
    next(error);
  }
});

export default router;
