import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { Router } from 'express';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { badRequest, notFound } from '../utils/errors.js';
import { EXCEL_LIMITS, readWorkbook, worksheetRows } from '../utils/excel.js';
import { success } from '../utils/response.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: EXCEL_LIMITS.maxFileBytes, files: 1 } });
const batchDir = path.resolve(env.upload.root, '../imports/batches');
const sheetDefinitions = {
  projects: { name: '1_项目', key: 'project_code', required: ['project_year', 'project_code', 'title'] },
  people: { name: '2_人员', key: 'identifier', required: ['person_type', 'name'] },
  participations: { name: '3_参与关系', key: 'relation', required: ['project_code', 'person_type', 'person_identifier', 'role'] },
  checks: { name: '4_检查记录', key: 'check', required: ['project_code', 'check_phase'] },
  reimbursements: { name: '5_报销记录', key: 'project_code', required: ['project_code'] }
};

function clean(value) {
  return String(value ?? '').trim();
}

function optional(value) {
  const text = clean(value);
  return text || null;
}

function numeric(value, fallback = 0) {
  if (value === '' || value === null || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.NaN;
}

function readRows(workbook, definition) {
  return worksheetRows(workbook, definition.name);
}

function addError(errors, sheet, row, field, value, reason) {
  errors.push({ sheet, row: row.__rowNumber || 1, field, value: clean(value), reason });
}

function validateRequired(rows, definition, errors) {
  if (!rows) {
    errors.push({ sheet: definition.name, row: 1, field: '', value: '', reason: '缺少工作表' });
    return;
  }
  for (const row of rows) {
    for (const field of definition.required) {
      if (!clean(row[field])) addError(errors, definition.name, row, field, row[field], '必填字段不能为空');
    }
  }
}

function duplicateErrors(rows, definition, errors, keyBuilder) {
  const seen = new Map();
  for (const row of rows || []) {
    const key = keyBuilder(row);
    if (!key) continue;
    if (seen.has(key)) addError(errors, definition.name, row, definition.key, key, `与第 ${seen.get(key)} 行重复`);
    else seen.set(key, row.__rowNumber);
  }
}

async function validateWorkbook(buffer) {
  const workbook = await readWorkbook(buffer);
  const data = {};
  const errors = [];
  for (const [key, definition] of Object.entries(sheetDefinitions)) {
    data[key] = readRows(workbook, definition);
    validateRequired(data[key], definition, errors);
  }

  duplicateErrors(data.projects, sheetDefinitions.projects, errors, (row) => clean(row.project_code));
  duplicateErrors(data.people, sheetDefinitions.people, errors, (row) => clean(row.student_no || row.teacher_no));
  duplicateErrors(data.participations, sheetDefinitions.participations, errors,
    (row) => [clean(row.project_code), clean(row.person_type), clean(row.person_identifier), clean(row.role)].join('|'));
  duplicateErrors(data.checks, sheetDefinitions.checks, errors,
    (row) => [clean(row.project_code), clean(row.check_phase)].join('|'));
  duplicateErrors(data.reimbursements, sheetDefinitions.reimbursements, errors, (row) => clean(row.project_code));

  const projectCodes = new Set((data.projects || []).map((row) => clean(row.project_code)).filter(Boolean));
  const identifiers = new Set((data.people || []).map((row) => clean(row.student_no || row.teacher_no)).filter(Boolean));
  const referencedProjectCodes = [...new Set([
    ...(data.participations || []).map((row) => clean(row.project_code)),
    ...(data.checks || []).map((row) => clean(row.project_code)),
    ...(data.reimbursements || []).map((row) => clean(row.project_code))
  ].filter(Boolean))];
  const referencedIdentifiers = [...new Set((data.participations || []).map((row) => clean(row.person_identifier)).filter(Boolean))];
  if (referencedProjectCodes.length) {
    const placeholders = referencedProjectCodes.map(() => '?').join(',');
    const [rows] = await pool.execute(`SELECT project_code FROM projects WHERE project_code IN (${placeholders}) AND deleted_at IS NULL`, referencedProjectCodes);
    rows.forEach((row) => projectCodes.add(row.project_code));
  }
  if (referencedIdentifiers.length) {
    const placeholders = referencedIdentifiers.map(() => '?').join(',');
    const [rows] = await pool.execute(
      `SELECT student_no, teacher_no FROM people WHERE student_no IN (${placeholders}) OR teacher_no IN (${placeholders})`,
      [...referencedIdentifiers, ...referencedIdentifiers]
    );
    rows.forEach((row) => identifiers.add(row.student_no || row.teacher_no));
  }

  for (const row of data.projects || []) {
    const year = Number(row.project_year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) addError(errors, sheetDefinitions.projects.name, row, 'project_year', row.project_year, '必须是四位年份');
    if (row.approval_type && !['first', 'supplement'].includes(clean(row.approval_type))) addError(errors, sheetDefinitions.projects.name, row, 'approval_type', row.approval_type, '枚举值不正确');
    if (row.status && !['draft', 'active', 'checking', 'completed', 'archived', 'stopped'].includes(clean(row.status))) addError(errors, sheetDefinitions.projects.name, row, 'status', row.status, '枚举值不正确');
  }
  for (const row of data.people || []) {
    const type = clean(row.person_type);
    if (!['student', 'teacher'].includes(type)) addError(errors, sheetDefinitions.people.name, row, 'person_type', row.person_type, '必须是 student 或 teacher');
    if (type === 'student' && !clean(row.student_no)) addError(errors, sheetDefinitions.people.name, row, 'student_no', row.student_no, '学生必须填写学号');
    if (type === 'teacher' && !clean(row.teacher_no)) addError(errors, sheetDefinitions.people.name, row, 'teacher_no', row.teacher_no, '老师必须填写工号');
  }
  for (const row of data.participations || []) {
    if (!projectCodes.has(clean(row.project_code))) addError(errors, sheetDefinitions.participations.name, row, 'project_code', row.project_code, '项目编号不存在');
    if (!identifiers.has(clean(row.person_identifier))) addError(errors, sheetDefinitions.participations.name, row, 'person_identifier', row.person_identifier, '人员编号不存在');
    if (!['owner', 'member', 'advisor'].includes(clean(row.role))) addError(errors, sheetDefinitions.participations.name, row, 'role', row.role, '枚举值不正确');
  }
  for (const row of data.checks || []) {
    if (!projectCodes.has(clean(row.project_code))) addError(errors, sheetDefinitions.checks.name, row, 'project_code', row.project_code, '项目编号不存在');
    if (!['midterm', 'stage'].includes(clean(row.check_phase))) addError(errors, sheetDefinitions.checks.name, row, 'check_phase', row.check_phase, '枚举值不正确');
    if (Number.isNaN(numeric(row.research_log_count))) addError(errors, sheetDefinitions.checks.name, row, 'research_log_count', row.research_log_count, '必须是数字');
  }
  for (const row of data.reimbursements || []) {
    if (!projectCodes.has(clean(row.project_code))) addError(errors, sheetDefinitions.reimbursements.name, row, 'project_code', row.project_code, '项目编号不存在');
    for (const field of ['budget_amount', 'midterm_claim_amount', 'midterm_actual_amount', 'stage_claim_amount', 'stage_actual_amount', 'remaining_amount']) {
      if (Number.isNaN(numeric(row[field]))) addError(errors, sheetDefinitions.reimbursements.name, row, field, row[field], '必须是数字');
    }
  }
  return { data, errors };
}

function batchPath(batchId) {
  return path.join(batchDir, `${batchId}.json`);
}

async function loadBatch(batchId) {
  try {
    const batch = JSON.parse(await fs.promises.readFile(batchPath(batchId), 'utf8'));
    if (new Date(batch.expiresAt).getTime() < Date.now()) throw notFound('Import batch has expired');
    return batch;
  } catch (error) {
    if (error.status) throw error;
    throw notFound('Import batch not found');
  }
}

router.post('/standard-workbook/validate', requireAuth, requireRole('admin'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw badRequest('Excel file is required', 'VALIDATION_ERROR');
    if (path.extname(req.file.originalname).toLowerCase() !== '.xlsx') throw badRequest('Only .xlsx files are supported', 'VALIDATION_ERROR');
    const { data, errors } = await validateWorkbook(req.file.buffer);
    const batchId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await fs.promises.mkdir(batchDir, { recursive: true });
    await fs.promises.writeFile(batchPath(batchId), JSON.stringify({ batchId, expiresAt, valid: errors.length === 0, errors, data }), 'utf8');
    const sheets = Object.entries(sheetDefinitions).map(([key, definition]) => {
      const rows = data[key] || [];
      const errorRows = new Set(errors.filter((item) => item.sheet === definition.name).map((item) => item.row)).size;
      return { name: definition.name, totalRows: rows.length, validRows: Math.max(0, rows.length - errorRows), errorRows };
    });
    success(res, { batchId, valid: errors.length === 0, expiresAt, errorCount: errors.length, sheets }, '校验完成');
  } catch (error) {
    next(error);
  }
});

router.get('/:batchId/errors/download', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const batch = await loadBatch(req.params.batchId);
    const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const lines = ['工作表,Excel行号,字段,原值,错误原因', ...batch.errors.map((item) => [item.sheet, item.row, item.field, item.value, item.reason].map(escape).join(','))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="import-errors-${req.params.batchId}.csv"`);
    res.send(`\uFEFF${lines.join('\r\n')}`);
  } catch (error) {
    next(error);
  }
});

router.post('/:batchId/commit', requireAuth, requireRole('admin'), async (req, res, next) => {
  let connection;
  try {
    const batch = await loadBatch(req.params.batchId);
    if (!batch.valid) throw badRequest('Import batch contains validation errors', 'VALIDATION_ERROR');
    const mode = req.body.mode || 'create_only';
    if (!['create_only', 'upsert'].includes(mode)) throw badRequest('Import mode is invalid', 'VALIDATION_ERROR');
    const data = batch.data;
    connection = await pool.getConnection();
    await connection.beginTransaction();

    for (const row of data.projects || []) {
      const values = [Number(row.project_year), optional(row.project_group), clean(row.project_code), clean(row.title), optional(row.category), optional(row.approval_date), clean(row.approval_type) || 'first', clean(row.status) || 'active', optional(row.remark)];
      if (mode === 'upsert') {
        await connection.execute(
          `INSERT INTO projects (project_year, project_group, project_code, title, category, approval_date, approval_type, status, remark)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE project_year=VALUES(project_year), project_group=VALUES(project_group), title=VALUES(title),
             category=VALUES(category), approval_date=VALUES(approval_date), approval_type=VALUES(approval_type), status=VALUES(status), remark=VALUES(remark), deleted_at=NULL`,
          values
        );
      } else {
        await connection.execute(
          `INSERT INTO projects (project_year, project_group, project_code, title, category, approval_date, approval_type, status, remark)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, values);
      }
    }
    for (const row of data.people || []) {
      const values = [clean(row.person_type), clean(row.name), optional(row.student_no), optional(row.teacher_no), optional(row.college), optional(row.unit), optional(row.phone), optional(row.qq), optional(row.email), optional(row.title), clean(row.account_status) || 'none', optional(row.remark)];
      if (mode === 'upsert') {
        const identifierField = clean(row.person_type) === 'student' ? 'student_no' : 'teacher_no';
        const identifier = clean(row[identifierField]);
        const [[existing]] = await connection.execute(`SELECT id FROM people WHERE ${identifierField} = ? LIMIT 1`, [identifier]);
        if (existing) {
          await connection.execute(
            `UPDATE people SET person_type=?, name=?, student_no=?, teacher_no=?, college=?, unit=?, phone=?, qq=?, email=?, title=?, account_status=?, remark=?, deleted_at=NULL WHERE id=?`,
            [...values, existing.id]
          );
        } else {
          await connection.execute(`INSERT INTO people (person_type,name,student_no,teacher_no,college,unit,phone,qq,email,title,account_status,remark) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, values);
        }
      } else {
        await connection.execute(`INSERT INTO people (person_type,name,student_no,teacher_no,college,unit,phone,qq,email,title,account_status,remark) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, values);
      }
    }
    const [projectRows] = await connection.execute('SELECT id, project_code FROM projects WHERE deleted_at IS NULL');
    const projectMap = new Map(projectRows.map((row) => [row.project_code, row.id]));
    const [peopleRows] = await connection.execute('SELECT id, student_no, teacher_no FROM people WHERE deleted_at IS NULL');
    const peopleMap = new Map(peopleRows.map((row) => [row.student_no || row.teacher_no, row.id]));
    for (const row of data.participations || []) {
      const values = [projectMap.get(clean(row.project_code)), peopleMap.get(clean(row.person_identifier)), clean(row.role), ['1', 'true', '是'].includes(clean(row.is_primary_owner).toLowerCase()) ? 1 : 0, optional(row.joined_at), optional(row.remark)];
      await connection.execute(
        `INSERT INTO project_participations (project_id, person_id, role, is_primary_owner, joined_at, remark)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE is_primary_owner=VALUES(is_primary_owner), joined_at=VALUES(joined_at), remark=VALUES(remark), deleted_at=NULL`, values);
    }
    for (const row of data.checks || []) {
      await connection.execute(
        `INSERT INTO project_check_records (project_id, check_phase, research_log_count, rating, checked_at, remark)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE research_log_count=VALUES(research_log_count), rating=VALUES(rating), checked_at=VALUES(checked_at), remark=VALUES(remark), deleted_at=NULL`,
        [projectMap.get(clean(row.project_code)), clean(row.check_phase), numeric(row.research_log_count), optional(row.rating), optional(row.checked_at), optional(row.remark)]
      );
    }
    for (const row of data.reimbursements || []) {
      await connection.execute(
        `INSERT INTO reimbursement_records
         (project_id,budget_amount,midterm_claim_amount,midterm_actual_amount,stage_claim_amount,stage_actual_amount,remaining_amount,remark)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE budget_amount=VALUES(budget_amount), midterm_claim_amount=VALUES(midterm_claim_amount),
           midterm_actual_amount=VALUES(midterm_actual_amount), stage_claim_amount=VALUES(stage_claim_amount),
           stage_actual_amount=VALUES(stage_actual_amount), remaining_amount=VALUES(remaining_amount), remark=VALUES(remark), deleted_at=NULL`,
        [projectMap.get(clean(row.project_code)), numeric(row.budget_amount), numeric(row.midterm_claim_amount), numeric(row.midterm_actual_amount), numeric(row.stage_claim_amount), numeric(row.stage_actual_amount), numeric(row.remaining_amount), optional(row.remark)]
      );
    }
    await connection.commit();
    await fs.promises.unlink(batchPath(req.params.batchId)).catch(() => undefined);
    success(res, {
      projects: (data.projects || []).length,
      people: (data.people || []).length,
      participations: (data.participations || []).length,
      checks: (data.checks || []).length,
      reimbursements: (data.reimbursements || []).length
    }, '导入完成');
  } catch (error) {
    await connection?.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      error.status = 409;
      error.code = 'DUPLICATE_RESOURCE';
      error.message = '数据库已存在相同唯一编号，请改用更新模式或修正文件';
    }
    next(error);
  } finally {
    connection?.release();
  }
});

export default router;
