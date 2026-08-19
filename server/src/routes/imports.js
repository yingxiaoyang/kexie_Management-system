import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { Router } from 'express';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { badRequest, notFound } from '../utils/errors.js';
import { EXCEL_LIMITS, readWorkbook, worksheetRows, xlsxBuffer } from '../utils/excel.js';
import { affectedProjectIds, assertFormalProjectOwnership, isFormalProjectStatus, ownershipProjectIdsForPeople } from '../utils/projectOwnership.js';
import { success } from '../utils/response.js';
import { resolveDownloadFile } from '../utils/safeFiles.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: EXCEL_LIMITS.maxFileBytes, files: 1 } });
const batchDir = path.resolve(env.upload.root, '../imports/batches');
const importRoot = path.resolve(env.upload.root, '../imports');
const originalDir = path.join(importRoot, 'originals');

const CLEAR_MARK = '[清空]';
const validProjectStatuses = ['draft', 'active', 'checking', 'completed', 'archived', 'stopped'];
const validApprovalTypes = ['first', 'supplement'];
const validPersonTypes = ['student', 'teacher'];
const validAccountStatuses = ['none', 'enabled', 'disabled'];
const validParticipationRoles = ['owner', 'member', 'advisor'];
const validCheckPhases = ['midterm', 'stage'];

const valueAliases = {
  projectStatus: new Map([
    ['草稿', 'draft'], ['进行中', 'active'], ['检查中', 'checking'], ['已完成', 'completed'],
    ['已归档', 'archived'], ['已终止', 'stopped']
  ]),
  approvalType: new Map([['首次立项', 'first'], ['补充立项', 'supplement']]),
  personType: new Map([['学生', 'student'], ['教师', 'teacher'], ['老师', 'teacher']]),
  accountStatus: new Map([['未开通', 'none'], ['已启用', 'enabled'], ['已停用', 'disabled']]),
  role: new Map([['负责人', 'owner'], ['成员', 'member'], ['指导老师', 'advisor'], ['指导教师', 'advisor']]),
  checkPhase: new Map([['中期检查', 'midterm'], ['阶段检查', 'stage']])
};

function aliasValue(group, value) {
  const text = clean(value);
  return valueAliases[group]?.get(text) || text;
}

const projectFields = {
  project_year: { label: '项目所属年度', db: 'project_year', requiredOnCreate: true, validate: validateYear },
  project_group: { label: '组别', db: 'project_group', nullable: true, max: 80 },
  project_code: { label: '项目编号', db: 'project_code', requiredOnCreate: true, max: 80 },
  title: { label: '作品名称', db: 'title', requiredOnCreate: true, max: 255 },
  category: { label: '项目类别', db: 'category', nullable: true, max: 120 },
  approval_date: { label: '立项时间', db: 'approval_date', nullable: true },
  approval_type: { label: '立项类型', db: 'approval_type', allowed: validApprovalTypes, normalize: (value) => aliasValue('approvalType', value), defaultValue: 'first' },
  status: { label: '项目状态', db: 'status', allowed: validProjectStatuses, normalize: (value) => aliasValue('projectStatus', value), defaultValue: 'active' },
  remark: { label: '备注', db: 'remark', nullable: true, max: 1000 }
};
const personFields = {
  name: { label: '姓名', db: 'name', requiredOnCreate: true, max: 80 },
  college: { label: '学院', db: 'college', nullable: true, max: 120 },
  unit: { label: '单位', db: 'unit', nullable: true, max: 120 },
  phone: { label: '电话', db: 'phone', nullable: true, max: 40 },
  qq: { label: 'QQ', db: 'qq', nullable: true, max: 40 },
  email: { label: '邮箱', db: 'email', nullable: true, max: 120 },
  title: { label: '职务或职称', db: 'title', nullable: true, max: 120 },
  account_status: { label: '账号状态', db: 'account_status', allowed: validAccountStatuses, normalize: (value) => aliasValue('accountStatus', value), defaultValue: 'none' },
  remark: { label: '备注', db: 'remark', nullable: true, max: 500 }
};
const participationFields = {
  is_primary_owner: { label: '是否主要负责人', db: 'is_primary_owner', defaultValue: 0, validate: validateBoolean },
  joined_at: { label: '加入日期', db: 'joined_at', nullable: true },
  remark: { label: '备注', db: 'remark', nullable: true, max: 500 }
};
const checkFields = {
  research_log_count: { label: '研究日志数量', db: 'research_log_count', defaultValue: 0, validate: validateNonNegativeInteger },
  rating: { label: '评级', db: 'rating', nullable: true, max: 80 },
  checked_at: { label: '检查日期', db: 'checked_at', nullable: true },
  remark: { label: '备注', db: 'remark', nullable: true, max: 500 }
};
const reimbursementFields = {
  budget_amount: { label: '报销额度', db: 'budget_amount', defaultValue: 0, validate: validateMoney },
  midterm_claim_amount: { label: '中期申报金额', db: 'midterm_claim_amount', defaultValue: 0, validate: validateMoney },
  midterm_actual_amount: { label: '中期实际金额', db: 'midterm_actual_amount', defaultValue: 0, validate: validateMoney },
  stage_claim_amount: { label: '阶段申报金额', db: 'stage_claim_amount', defaultValue: 0, validate: validateMoney },
  stage_actual_amount: { label: '阶段实际金额', db: 'stage_actual_amount', defaultValue: 0, validate: validateMoney },
  remaining_amount: { label: '剩余额度', db: 'remaining_amount', defaultValue: 0, validate: validateMoney },
  remark: { label: '备注', db: 'remark', nullable: true, max: 500 }
};
const fieldLabels = Object.fromEntries(Object.entries(projectFields).map(([field, definition]) => [field, definition.label]));
const extraFieldLabels = {
  person_type: '人员类型',
  name: '姓名',
  student_no: '学号',
  teacher_no: '工号',
  college: '学院',
  unit: '单位',
  phone: '电话',
  qq: 'QQ',
  email: '邮箱',
  account_status: '账号状态',
  person_identifier: '人员编号',
  role: '项目身份',
  is_primary_owner: '是否主要负责人',
  joined_at: '加入日期',
  check_phase: '检查阶段',
  research_log_count: '研究日志数量',
  rating: '评级',
  checked_at: '检查日期',
  budget_amount: '报销额度',
  midterm_claim_amount: '中期申报金额',
  midterm_actual_amount: '中期实际金额',
  stage_claim_amount: '阶段申报金额',
  stage_actual_amount: '阶段实际金额',
  remaining_amount: '剩余额度',
  action: '操作'
};
const headerAliases = new Map([
  ...Object.entries({ ...fieldLabels, ...extraFieldLabels }).map(([field, label]) => [label, field]),
  ['作品或项目名称', 'title'],
  ['项目名称', 'title'],
  ['职务或职称', 'title'],
  ['立项日期', 'approval_date'],
  ['人员身份', 'role'],
  ['身份', 'role'],
  ['项目角色', 'role'],
  ['加入时间', 'joined_at'],
  ['检查日期', 'checked_at'],
  ['中期检查研究日志数量', 'research_log_count'],
  ['中期申报金额', 'midterm_claim_amount'],
  ['中期实际金额', 'midterm_actual_amount'],
  ['中期报销申报金额', 'midterm_claim_amount'],
  ['中期报销实际金额', 'midterm_actual_amount'],
  ['阶段申报金额', 'stage_claim_amount'],
  ['阶段实际金额', 'stage_actual_amount'],
  ['阶段报销申报金额', 'stage_claim_amount'],
  ['阶段报销实际金额', 'stage_actual_amount']
]);
const updatableProjectFields = Object.keys(projectFields).filter((field) => field !== 'project_code');
const importModules = {
  'project-field-update': {
    title: '项目基本信息',
    description: '按项目编号修改项目本身的信息',
    importType: 'project_field_update',
    fixedFields: [{ field: 'project_code', label: '项目编号' }],
    updateFields: projectFields,
    allowedFields: updatableProjectFields,
    defaultFields: ['title', 'status']
  },
  people: {
    title: '人员信息',
    description: '按人员类型和学号或工号修改人员资料',
    importType: 'people_update',
    fixedFields: [{ field: 'person_type', label: '人员类型' }, { field: 'person_identifier', label: '人员编号' }],
    updateFields: personFields,
    allowedFields: Object.keys(personFields),
    defaultFields: ['name', 'college', 'unit', 'phone']
  },
  'project-participations': {
    title: '项目人员关系',
    description: '按项目、人员和项目身份定位一条人员关系',
    importType: 'project_participations',
    fixedFields: [
      { field: 'project_code', label: '项目编号' },
      { field: 'person_type', label: '人员类型' },
      { field: 'person_identifier', label: '人员编号' },
      { field: 'role', label: '项目身份' },
      { field: 'action', label: '操作' }
    ],
    updateFields: participationFields,
    allowedFields: Object.keys(participationFields),
    defaultFields: Object.keys(participationFields)
  },
  checks: {
    title: '检查记录',
    description: '按项目编号和检查阶段定位一条检查记录',
    importType: 'check_record_update',
    fixedFields: [{ field: 'project_code', label: '项目编号' }, { field: 'check_phase', label: '检查阶段' }],
    updateFields: checkFields,
    allowedFields: Object.keys(checkFields),
    defaultFields: Object.keys(checkFields)
  },
  reimbursements: {
    title: '报销记录',
    description: '当前每个项目只有一条报销记录，按项目编号定位',
    importType: 'reimbursement_update',
    fixedFields: [{ field: 'project_code', label: '项目编号' }],
    updateFields: reimbursementFields,
    allowedFields: Object.keys(reimbursementFields),
    defaultFields: Object.keys(reimbursementFields)
  }
};
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

function validateYear(value) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : Number.NaN;
}

function validateNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : Number.NaN;
}

function validateMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && Math.abs(Math.round(number * 100) - number * 100) < 1e-8 ? number : Number.NaN;
}

function validateBoolean(value) {
  const text = clean(value).toLowerCase();
  if (['1', 'true', 'yes', '是', '主要'].includes(text)) return 1;
  if (['0', 'false', 'no', '否', '非主要'].includes(text)) return 0;
  return Number.NaN;
}

function localDateText(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeSnapshotValue(value) {
  if (value instanceof Date) return localDateText(value);
  if (value === undefined) return null;
  return value;
}

function comparable(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return localDateText(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string' && /^-?\d+\.\d+$/.test(value)) return String(Number(value));
  return String(value);
}

function parseJsonField(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

function normalizeJsonSnapshot(row, fields) {
  if (!row) return null;
  const snapshot = {};
  for (const field of fields) snapshot[field] = normalizeSnapshotValue(row[field]);
  return snapshot;
}

function countBy(records) {
  const summary = { total: records.length, create: 0, update: 0, remove: 0, skip: 0, error: 0, restore: 0, conflict: 0 };
  for (const record of records) summary[record.operationType] = (summary[record.operationType] || 0) + 1;
  return summary;
}

function safeFileName(name) {
  return clean(name).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').slice(0, 120) || 'import.xlsx';
}

async function saveOriginalFile(file, batchUuid) {
  if (!file) return { path: null, sha256: null, size: null };
  await fs.promises.mkdir(originalDir, { recursive: true });
  const ext = path.extname(file.originalname).toLowerCase() || '.xlsx';
  const storedName = `${batchUuid}-${safeFileName(path.basename(file.originalname, ext))}${ext}`;
  const storedPath = path.join(originalDir, storedName);
  await fs.promises.writeFile(storedPath, file.buffer);
  return {
    path: path.relative(importRoot, storedPath),
    sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
    size: file.buffer.length
  };
}

function addError(errors, sheet, row, field, value, reason) {
  errors.push({ sheet, row: row?.__rowNumber || 1, field, value: clean(value), reason });
}

function duplicateErrors(rows, sheet, field, errors, keyBuilder) {
  const seen = new Map();
  for (const row of rows || []) {
    const key = keyBuilder(row);
    if (!key) continue;
    if (seen.has(key)) addError(errors, sheet, row, field, key, `与第 ${seen.get(key)} 行重复`);
    else seen.set(key, row.__rowNumber);
  }
}

function firstWorksheetRows(workbook) {
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];
  return canonicalizeRows(worksheetRows(workbook, worksheet.name) || []);
}

function canonicalFieldName(header) {
  const text = clean(header);
  return headerAliases.get(text) || text;
}

function canonicalizeRows(rows) {
  return (rows || []).map((row) => {
    const normalized = { __rowNumber: row.__rowNumber };
    for (const [key, value] of Object.entries(row)) {
      if (key === '__rowNumber') continue;
      normalized[canonicalFieldName(key)] = value;
    }
    return normalized;
  });
}

function validateProjectValue(field, value, row, errors, sheet, { required = false } = {}) {
  const definition = projectFields[field];
  const original = clean(value);
  const raw = definition.normalize ? definition.normalize(original) : original;
  if (!raw) {
    if (required) addError(errors, sheet, row, field, value, '必填字段不能为空');
    return null;
  }
  if (raw === CLEAR_MARK) {
    if (!definition.nullable) addError(errors, sheet, row, field, value, '该字段不能清空');
    return null;
  }
  if (definition.validate) {
    const validated = definition.validate(raw);
    if (Number.isNaN(validated)) addError(errors, sheet, row, field, value, '字段格式不正确');
    return validated;
  }
  if (definition.allowed && !definition.allowed.includes(raw)) {
    addError(errors, sheet, row, field, value, '枚举值不正确');
  }
  if (definition.max && raw.length > definition.max) {
    addError(errors, sheet, row, field, value, `长度不能超过 ${definition.max} 个字符`);
  }
  return raw;
}

function validateModuleValue(definitions, field, value, row, errors, sheet, { required = false } = {}) {
  const definition = definitions[field];
  const original = clean(value);
  const raw = definition.normalize ? definition.normalize(original) : original;
  if (!raw) {
    if (required) addError(errors, sheet, row, field, value, '必填字段不能为空');
    return null;
  }
  if (raw === CLEAR_MARK) {
    if (!definition.nullable) addError(errors, sheet, row, field, value, '该字段不能清空');
    return null;
  }
  if (definition.validate) {
    const validated = definition.validate(raw);
    if (Number.isNaN(validated)) addError(errors, sheet, row, field, value, '字段格式不正确');
    return validated;
  }
  if (definition.allowed && !definition.allowed.includes(raw)) {
    addError(errors, sheet, row, field, value, '填写内容不在允许范围内');
  }
  if (definition.max && raw.length > definition.max) {
    addError(errors, sheet, row, field, value, `长度不能超过 ${definition.max} 个字符`);
  }
  return raw;
}

function selectedModuleFields(rows, module, errors, sheet) {
  const headers = rows.length ? Object.keys(rows[0]).filter((field) => !field.startsWith('__')) : [];
  const fixed = module.fixedFields.map((item) => item.field);
  for (const field of fixed) {
    if (!headers.includes(field)) errors.push({ sheet, row: 1, field, value: '', reason: `模板缺少固定定位列：${extraFieldLabels[field] || fieldLabels[field] || field}` });
  }
  if (fixed[0] && headers[0] !== fixed[0]) {
    errors.push({ sheet, row: 1, field: fixed[0], value: headers[0] || '', reason: `第一列必须是${extraFieldLabels[fixed[0]] || fieldLabels[fixed[0]] || fixed[0]}` });
  }
  const selected = headers.filter((field) => !fixed.includes(field));
  for (const field of selected) {
    if (!module.allowedFields.includes(field)) errors.push({ sheet, row: 1, field, value: field, reason: '模板包含不支持修改的字段' });
  }
  return selected.filter((field) => module.allowedFields.includes(field));
}

async function loadProjectMap(connection, projectCodes) {
  if (!projectCodes.length) return new Map();
  const placeholders = projectCodes.map(() => '?').join(',');
  const [rows] = await connection.execute(
    `SELECT id, project_year, project_group, project_code, title, category, approval_date, approval_type, status, remark, deleted_at
     FROM projects WHERE project_code IN (${placeholders})`,
    projectCodes
  );
  return new Map(rows.map((row) => [row.project_code, row]));
}

async function loadPeopleMap(connection, identifiers) {
  if (!identifiers.length) return new Map();
  const placeholders = identifiers.map(() => '?').join(',');
  const [rows] = await connection.execute(
    `SELECT id, person_type, name, student_no, teacher_no, college, unit, phone, qq, email, title, account_status, remark, deleted_at
     FROM people WHERE student_no IN (${placeholders}) OR teacher_no IN (${placeholders})`,
    [...identifiers, ...identifiers]
  );
  const result = new Map();
  for (const row of rows) {
    const identifier = row.student_no || row.teacher_no;
    result.set(`${row.person_type}|${identifier}`, row);
    if (!result.has(identifier)) result.set(identifier, row);
  }
  return result;
}

async function loadParticipationMap(connection, keys) {
  const result = new Map();
  if (!keys.length) return result;
  const projectIds = [...new Set(keys.map((key) => key.projectId))];
  const personIds = [...new Set(keys.map((key) => key.personId))];
  if (!projectIds.length || !personIds.length) return result;
  const [rows] = await connection.query(
    `SELECT id, project_id, person_id, role, is_primary_owner, joined_at, remark, deleted_at
     FROM project_participations
     WHERE project_id IN (?) AND person_id IN (?)`,
    [projectIds, personIds]
  );
  for (const row of rows) result.set(`${row.project_id}|${row.person_id}|${row.role}`, row);
  return result;
}

async function loadCheckMap(connection, projectIds, phases) {
  if (!projectIds.length || !phases.length) return new Map();
  const [rows] = await connection.query(
    `SELECT id, project_id, check_phase, research_log_count, rating, checked_at, remark, deleted_at
     FROM project_check_records WHERE project_id IN (?) AND check_phase IN (?)`,
    [projectIds, phases]
  );
  return new Map(rows.map((row) => [`${row.project_id}|${row.check_phase}`, row]));
}

async function loadReimbursementMap(connection, projectIds) {
  if (!projectIds.length) return new Map();
  const [rows] = await connection.query(
    `SELECT id, project_id, budget_amount, midterm_claim_amount, midterm_actual_amount,
            stage_claim_amount, stage_actual_amount, remaining_amount, remark, deleted_at
     FROM reimbursement_records WHERE project_id IN (?)`,
    [projectIds]
  );
  return new Map(rows.map((row) => [row.project_id, row]));
}

async function loadParticipationRules(connection) {
  const [rows] = await connection.execute(
    `SELECT rule_key, limit_count, enabled FROM participation_rules
     WHERE rule_key IN ('max_owner_projects_per_person', 'max_member_projects_per_person')`
  );
  const rules = { owner: Number.POSITIVE_INFINITY, member: Number.POSITIVE_INFINITY };
  for (const row of rows) {
    if (!row.enabled) continue;
    if (row.rule_key === 'max_owner_projects_per_person') rules.owner = Number(row.limit_count);
    if (row.rule_key === 'max_member_projects_per_person') rules.member = Number(row.limit_count);
  }
  return rules;
}

async function validateSimpleProjects(workbook, connection) {
  const rows = firstWorksheetRows(workbook);
  const errors = [];
  const records = [];
  const headers = rows.length ? Object.keys(rows[0]).filter((field) => !field.startsWith('__')) : [];
  if (headers[0] !== 'project_code') {
    errors.push({ sheet: '项目导入', row: 1, field: 'project_code', value: headers[0] || '', reason: '第一列必须是项目编号' });
  }
  duplicateErrors(rows, '项目导入', 'project_code', errors, (row) => clean(row.project_code));
  const projectMap = await loadProjectMap(connection, [...new Set(rows.map((row) => clean(row.project_code)).filter(Boolean))]);

  for (const row of rows) {
    const values = {};
    for (const field of Object.keys(projectFields)) {
      values[field] = validateProjectValue(field, row[field], row, errors, '项目导入', { required: projectFields[field].requiredOnCreate });
    }
    const existing = projectMap.get(clean(row.project_code));
    const before = normalizeJsonSnapshot(existing, Object.keys(projectFields));
    const after = {};
    for (const field of Object.keys(projectFields)) {
      const value = values[field];
      after[field] = value ?? projectFields[field].defaultValue ?? null;
    }
    if ((!existing || existing.deleted_at) && isFormalProjectStatus(after.status)) {
      addError(errors, '项目导入', row, 'status', row.status, '简化项目导入不能同时建立负责人关系；请先以 draft 导入，再导入负责人关系后转换为正式状态');
    }
    records.push({
      entityType: 'project',
      entityKey: clean(row.project_code),
      targetTable: 'projects',
      targetId: existing?.id || null,
      operationType: existing && !existing.deleted_at ? 'skip' : 'create',
      rowNumber: row.__rowNumber,
      beforeSnapshot: before,
      afterSnapshot: after,
      message: existing && !existing.deleted_at ? '项目编号已存在，新建项目导入将跳过' : null,
      fields: Object.keys(after).map((field) => ({ field, before: before?.[field] ?? null, after: after[field] }))
    });
  }
  return { rows, records, errors };
}

async function validateProjectFieldUpdate(workbook, connection) {
  const rows = firstWorksheetRows(workbook);
  const errors = [];
  const records = [];
  const selectedFields = selectedModuleFields(rows, importModules['project-field-update'], errors, '项目基本信息');
  duplicateErrors(rows, '项目字段更新', 'project_code', errors, (row) => clean(row.project_code));
  const projectMap = await loadProjectMap(connection, [...new Set(rows.map((row) => clean(row.project_code)).filter(Boolean))]);

  for (const row of rows) {
    const code = clean(row.project_code);
    if (!code) addError(errors, '项目字段更新', row, 'project_code', row.project_code, '必填字段不能为空');
    const existing = projectMap.get(code);
    if (!existing || existing.deleted_at) addError(errors, '项目字段更新', row, 'project_code', row.project_code, '项目编号不存在');
    const before = normalizeJsonSnapshot(existing, Object.keys(projectFields));
    const after = { ...(before || {}) };
    const fields = [];
    for (const field of selectedFields) {
      const raw = clean(row[field]);
      if (!raw) continue;
      const nextValue = validateProjectValue(field, raw, row, errors, '项目字段更新');
      after[field] = nextValue;
      if (comparable(before?.[field]) !== comparable(nextValue)) fields.push({ field, before: before?.[field] ?? null, after: nextValue });
    }
    records.push({
      entityType: 'project',
      entityKey: code,
      targetTable: 'projects',
      targetId: existing?.id || null,
      operationType: fields.length ? 'update' : 'skip',
      rowNumber: row.__rowNumber,
      beforeSnapshot: before,
      afterSnapshot: after,
      message: fields.length ? null : '没有需要修改的字段',
      fields
    });
  }
  return { rows, records, errors };
}

async function validatePeopleUpdate(workbook, connection) {
  const rows = firstWorksheetRows(workbook);
  const errors = [];
  const records = [];
  const module = importModules.people;
  const selectedFields = selectedModuleFields(rows, module, errors, module.title);
  duplicateErrors(rows, module.title, 'person_identifier', errors,
    (row) => `${aliasValue('personType', row.person_type)}|${clean(row.person_identifier)}`);
  const identifiers = [...new Set(rows.map((row) => clean(row.person_identifier)).filter(Boolean))];
  const peopleMap = await loadPeopleMap(connection, identifiers);
  const snapshotFields = ['person_type', 'student_no', 'teacher_no', ...Object.keys(personFields), 'deleted_at'];

  for (const row of rows) {
    const personType = aliasValue('personType', row.person_type);
    const identifier = clean(row.person_identifier);
    if (!validPersonTypes.includes(personType)) addError(errors, module.title, row, 'person_type', row.person_type, '人员类型只能填写学生或教师');
    if (!identifier) addError(errors, module.title, row, 'person_identifier', row.person_identifier, '人员编号不能为空');
    const existing = validPersonTypes.includes(personType) && identifier ? peopleMap.get(`${personType}|${identifier}`) : null;
    const before = normalizeJsonSnapshot(existing, snapshotFields);
    const after = before ? { ...before } : {
      person_type: personType,
      student_no: personType === 'student' ? identifier : null,
      teacher_no: personType === 'teacher' ? identifier : null,
      ...Object.fromEntries(Object.entries(personFields).map(([field, definition]) => [field, definition.defaultValue ?? null])),
      deleted_at: null
    };
    const fields = [];
    for (const field of selectedFields) {
      const raw = clean(row[field]);
      if (!raw) continue;
      const nextValue = validateModuleValue(personFields, field, raw, row, errors, module.title);
      after[field] = nextValue;
      if (comparable(before?.[field]) !== comparable(nextValue)) fields.push({ field, before: before?.[field] ?? null, after: nextValue });
    }
    if ((!existing || existing.deleted_at) && !clean(after.name)) {
      addError(errors, module.title, row, 'name', row.name, '新增人员时必须选择并填写姓名');
    }
    let operationType = fields.length ? 'update' : 'skip';
    let message = fields.length ? null : '没有需要修改的字段';
    if (!existing || existing.deleted_at) {
      operationType = 'create';
      message = null;
    }
    records.push({
      entityType: 'person',
      entityKey: `${personType}|${identifier}`,
      targetTable: 'people',
      targetId: existing?.id || null,
      operationType,
      rowNumber: row.__rowNumber,
      beforeSnapshot: before,
      afterSnapshot: after,
      message,
      fields
    });
  }
  return { rows, records, errors };
}

function parseParticipationAction(value) {
  const text = clean(value).toLowerCase();
  if (!text || ['upsert', '新增', '更新', '保存'].includes(text)) return 'upsert';
  if (['remove', 'delete', '删除', '移除'].includes(text)) return 'remove';
  return 'invalid';
}

function boolValue(value) {
  return ['1', 'true', 'yes', '是', '主要'].includes(clean(value).toLowerCase()) ? 1 : 0;
}

async function validateParticipationRules(records, connection, errors) {
  const rules = await loadParticipationRules(connection);
  const personIds = [...new Set(records
    .filter((record) => ['create', 'update'].includes(record.operationType) && ['owner', 'member'].includes(record.afterSnapshot?.role))
    .map((record) => record.afterSnapshot.person_id))];
  if (!personIds.length) return;
  const [rows] = await connection.query(
    `SELECT id, project_id, person_id, role FROM project_participations
     WHERE deleted_at IS NULL AND person_id IN (?) AND role IN ('owner', 'member')`,
    [personIds]
  );
  const active = new Map();
  for (const row of rows) active.set(`${row.person_id}|${row.project_id}|${row.role}`, row);
  for (const record of records) {
    const after = record.afterSnapshot;
    const before = record.beforeSnapshot;
    if (!after || !['owner', 'member'].includes(after.role)) continue;
    const key = `${after.person_id}|${after.project_id}|${after.role}`;
    if (record.operationType === 'remove') active.delete(key);
    if (['create', 'update'].includes(record.operationType)) active.set(key, after);
    const count = [...active.values()].filter((item) => item.person_id === after.person_id && item.role === after.role).length;
    if (Number.isFinite(rules[after.role]) && count > rules[after.role]) {
      errors.push({
        sheet: '项目人员关系',
        row: record.rowNumber,
        field: 'role',
        value: after.role,
        reason: after.role === 'owner' ? `超出每人最多负责 ${rules.owner} 个项目的规则` : `超出每人最多作为成员参与 ${rules.member} 个项目的规则`
      });
    }
    if (before?.deleted_at && record.operationType === 'update') record.operationType = 'create';
  }
}

async function validateProjectParticipations(workbook, connection) {
  const rows = firstWorksheetRows(workbook);
  const errors = [];
  const records = [];
  const module = importModules['project-participations'];
  const selectedFields = selectedModuleFields(rows, module, errors, module.title);
  duplicateErrors(rows, module.title, 'relation', errors,
    (row) => [clean(row.project_code), aliasValue('personType', row.person_type), clean(row.person_identifier), aliasValue('role', row.role)].join('|'));
  const projectMap = await loadProjectMap(connection, [...new Set(rows.map((row) => clean(row.project_code)).filter(Boolean))]);
  const peopleMap = await loadPeopleMap(connection, [...new Set(rows.map((row) => clean(row.person_identifier)).filter(Boolean))]);
  const relationKeys = [];
  for (const row of rows) {
    const project = projectMap.get(clean(row.project_code));
    const personType = aliasValue('personType', row.person_type);
    const person = peopleMap.get(`${personType}|${clean(row.person_identifier)}`);
    if (project && person) relationKeys.push({ projectId: project.id, personId: person.id });
  }
  const participationMap = await loadParticipationMap(connection, relationKeys);

  for (const row of rows) {
    const action = parseParticipationAction(row.action);
    const project = projectMap.get(clean(row.project_code));
    const personType = aliasValue('personType', row.person_type);
    const person = peopleMap.get(`${personType}|${clean(row.person_identifier)}`);
    const role = aliasValue('role', row.role);
    if (action === 'invalid') addError(errors, module.title, row, 'action', row.action, '操作只能填写新增、更新、移除，留空表示新增或更新');
    if (!project || project.deleted_at) addError(errors, module.title, row, 'project_code', row.project_code, '项目编号不存在');
    if (!validPersonTypes.includes(personType)) addError(errors, module.title, row, 'person_type', row.person_type, '人员类型只能填写学生或教师');
    if (!person || person.deleted_at) addError(errors, module.title, row, 'person_identifier', row.person_identifier, '人员编号不存在');
    if (!validParticipationRoles.includes(role)) addError(errors, module.title, row, 'role', row.role, '项目身份只能填写负责人、成员或指导老师');
    if (!project || !person || person.deleted_at || !validParticipationRoles.includes(role)) continue;
    const key = `${project.id}|${person.id}|${role}`;
    const existing = participationMap.get(key);
    const before = normalizeJsonSnapshot(existing, ['id', 'project_id', 'person_id', 'role', 'is_primary_owner', 'joined_at', 'remark', 'deleted_at']);
    const after = before ? { ...before } : {
      project_id: project.id,
      person_id: person.id,
      role,
      ...Object.fromEntries(Object.entries(participationFields).map(([field, definition]) => [field, definition.defaultValue ?? null])),
      deleted_at: null
    };
    const fields = [];
    for (const field of selectedFields) {
      const raw = clean(row[field]);
      if (!raw) continue;
      const nextValue = validateModuleValue(participationFields, field, raw, row, errors, module.title);
      after[field] = nextValue;
      if (comparable(before?.[field]) !== comparable(nextValue)) fields.push({ field, before: before?.[field] ?? null, after: nextValue });
    }
    let operationType = 'create';
    let message = null;
    if (action === 'remove') {
      operationType = existing && !existing.deleted_at ? 'remove' : 'skip';
      message = operationType === 'skip' ? '未找到可移除的参与关系' : null;
    } else if (existing && !existing.deleted_at) {
      operationType = fields.length ? 'update' : 'skip';
      message = fields.length ? null : '没有需要修改的字段';
    }
    records.push({
      entityType: 'participation',
      entityKey: `${clean(row.project_code)}|${clean(row.person_identifier)}|${role}`,
      targetTable: 'project_participations',
      targetId: existing?.id || null,
      operationType,
      rowNumber: row.__rowNumber,
      beforeSnapshot: before,
      afterSnapshot: after,
      message,
      fields
    });
  }
  await validateParticipationRules(records, connection, errors);
  return { rows, records, errors };
}

async function validateCheckRecords(workbook, connection) {
  const rows = firstWorksheetRows(workbook);
  const errors = [];
  const records = [];
  const module = importModules.checks;
  const selectedFields = selectedModuleFields(rows, module, errors, module.title);
  duplicateErrors(rows, module.title, 'check_phase', errors,
    (row) => `${clean(row.project_code)}|${aliasValue('checkPhase', row.check_phase)}`);
  const projectMap = await loadProjectMap(connection, [...new Set(rows.map((row) => clean(row.project_code)).filter(Boolean))]);
  const phases = [...new Set(rows.map((row) => aliasValue('checkPhase', row.check_phase)).filter((phase) => validCheckPhases.includes(phase)))];
  const projectIds = [...new Set([...projectMap.values()].map((project) => project.id))];
  const checkMap = await loadCheckMap(connection, projectIds, phases);
  const snapshotFields = ['project_id', 'check_phase', ...Object.keys(checkFields), 'deleted_at'];

  for (const row of rows) {
    const project = projectMap.get(clean(row.project_code));
    const phase = aliasValue('checkPhase', row.check_phase);
    if (!project || project.deleted_at) addError(errors, module.title, row, 'project_code', row.project_code, '项目编号不存在');
    if (!validCheckPhases.includes(phase)) addError(errors, module.title, row, 'check_phase', row.check_phase, '检查阶段只能填写中期检查或阶段检查');
    const existing = project && validCheckPhases.includes(phase) ? checkMap.get(`${project.id}|${phase}`) : null;
    const before = normalizeJsonSnapshot(existing, snapshotFields);
    const after = before ? { ...before } : {
      project_id: project?.id || null,
      check_phase: phase,
      ...Object.fromEntries(Object.entries(checkFields).map(([field, definition]) => [field, definition.defaultValue ?? null])),
      deleted_at: null
    };
    const fields = [];
    for (const field of selectedFields) {
      const raw = clean(row[field]);
      if (!raw) continue;
      const nextValue = validateModuleValue(checkFields, field, raw, row, errors, module.title);
      after[field] = nextValue;
      if (comparable(before?.[field]) !== comparable(nextValue)) fields.push({ field, before: before?.[field] ?? null, after: nextValue });
    }
    const isCreate = !existing || existing.deleted_at;
    records.push({
      entityType: 'check_record',
      entityKey: `${clean(row.project_code)}|${phase}`,
      targetTable: 'project_check_records',
      targetId: existing?.id || null,
      operationType: isCreate ? 'create' : fields.length ? 'update' : 'skip',
      rowNumber: row.__rowNumber,
      beforeSnapshot: before,
      afterSnapshot: after,
      message: !isCreate && !fields.length ? '没有需要修改的字段' : null,
      fields
    });
  }
  return { rows, records, errors };
}

async function validateReimbursements(workbook, connection) {
  const rows = firstWorksheetRows(workbook);
  const errors = [];
  const records = [];
  const module = importModules.reimbursements;
  const selectedFields = selectedModuleFields(rows, module, errors, module.title);
  duplicateErrors(rows, module.title, 'project_code', errors, (row) => clean(row.project_code));
  const projectMap = await loadProjectMap(connection, [...new Set(rows.map((row) => clean(row.project_code)).filter(Boolean))]);
  const projectIds = [...new Set([...projectMap.values()].map((project) => project.id))];
  const reimbursementMap = await loadReimbursementMap(connection, projectIds);
  const snapshotFields = ['project_id', ...Object.keys(reimbursementFields), 'deleted_at'];

  for (const row of rows) {
    const project = projectMap.get(clean(row.project_code));
    if (!project || project.deleted_at) addError(errors, module.title, row, 'project_code', row.project_code, '项目编号不存在');
    const existing = project ? reimbursementMap.get(project.id) : null;
    const before = normalizeJsonSnapshot(existing, snapshotFields);
    const after = before ? { ...before } : {
      project_id: project?.id || null,
      ...Object.fromEntries(Object.entries(reimbursementFields).map(([field, definition]) => [field, definition.defaultValue ?? null])),
      deleted_at: null
    };
    const fields = [];
    for (const field of selectedFields) {
      const raw = clean(row[field]);
      if (!raw) continue;
      const nextValue = validateModuleValue(reimbursementFields, field, raw, row, errors, module.title);
      after[field] = nextValue;
      if (comparable(before?.[field]) !== comparable(nextValue)) fields.push({ field, before: before?.[field] ?? null, after: nextValue });
    }
    const isCreate = !existing || existing.deleted_at;
    records.push({
      entityType: 'reimbursement',
      entityKey: clean(row.project_code),
      targetTable: 'reimbursement_records',
      targetId: existing?.id || null,
      operationType: isCreate ? 'create' : fields.length ? 'update' : 'skip',
      rowNumber: row.__rowNumber,
      beforeSnapshot: before,
      afterSnapshot: after,
      message: !isCreate && !fields.length ? '没有需要修改的字段' : null,
      fields
    });
  }
  return { rows, records, errors };
}

async function insertBatch(connection, { batchUuid, importType, mode, file, savedFile, records, errors, userId }) {
  const summary = { valid: errors.length === 0, errorCount: errors.length, ...countBy(records) };
  const [result] = await connection.execute(
    `INSERT INTO import_batches
     (batch_uuid, import_type, mode, status, original_file_name, original_file_path, file_sha256, file_size, summary_json, errors_json, created_by)
     VALUES (?, ?, ?, 'validated', ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?)`,
    [
      batchUuid,
      importType,
      mode,
      file?.originalname || null,
      savedFile.path,
      savedFile.sha256,
      savedFile.size,
      JSON.stringify(summary),
      JSON.stringify(errors),
      userId
    ]
  );
  for (const record of records) {
    const [recordResult] = await connection.execute(
      `INSERT INTO import_batch_records
       (batch_id, entity_type, entity_key, target_table, target_id, operation_type, excel_row_number, status, before_snapshot, after_snapshot, message)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'planned', CAST(? AS JSON), CAST(? AS JSON), ?)`,
      [
        result.insertId,
        record.entityType,
        record.entityKey,
        record.targetTable,
        record.targetId,
        record.operationType,
        record.rowNumber || null,
        JSON.stringify(record.beforeSnapshot),
        JSON.stringify(record.afterSnapshot),
        record.message || null
      ]
    );
    for (const field of record.fields || []) {
      await connection.execute(
        `INSERT INTO import_batch_field_changes (record_id, field_name, before_value, after_value)
         VALUES (?, ?, ?, ?)`,
        [recordResult.insertId, field.field, field.before == null ? null : String(field.before), field.after == null ? null : String(field.after)]
      );
    }
  }
  return { id: result.insertId, batchUuid, summary };
}

async function getBatchByUuid(connection, batchUuid) {
  const [[batch]] = await connection.execute('SELECT * FROM import_batches WHERE batch_uuid = ?', [batchUuid]);
  if (!batch) throw notFound('导入记录不存在');
  return batch;
}

async function permanentBatchExists(batchUuid) {
  const [[batch]] = await pool.execute('SELECT id FROM import_batches WHERE batch_uuid = ?', [batchUuid]);
  return Boolean(batch);
}

async function loadBatchRecords(connection, batchId) {
  const [records] = await connection.execute(
    `SELECT id, entity_type AS entityType, entity_key AS entityKey, target_table AS targetTable, target_id AS targetId,
            operation_type AS operationType, excel_row_number AS rowNumber, status, before_snapshot AS beforeSnapshot, after_snapshot AS afterSnapshot, message
     FROM import_batch_records WHERE batch_id = ? ORDER BY id`,
    [batchId]
  );
  for (const record of records) {
    record.beforeSnapshot = parseJsonField(record.beforeSnapshot);
    record.afterSnapshot = parseJsonField(record.afterSnapshot);
    const [fields] = await connection.execute(
      `SELECT field_name AS fieldName, before_value AS beforeValue, after_value AS afterValue
       FROM import_batch_field_changes WHERE record_id = ? ORDER BY id`,
      [record.id]
    );
    record.fields = fields;
  }
  return records;
}

async function applyProjectRecord(connection, record) {
  const after = record.afterSnapshot;
  if (record.operationType === 'skip') return null;
  const values = [after.project_year, after.project_group, after.project_code, after.title, after.category, after.approval_date, after.approval_type, after.status, after.remark];
  if (record.operationType === 'create') {
    if (record.targetId) {
      await connection.execute(
        `UPDATE projects SET project_year=?, project_group=?, project_code=?, title=?, category=?, approval_date=?, approval_type=?, status=?, remark=?, deleted_at=NULL, updated_at=NOW()
         WHERE id=?`,
        [...values, record.targetId]
      );
      return record.targetId;
    }
    const [result] = await connection.execute(
      `INSERT INTO projects (project_year, project_group, project_code, title, category, approval_date, approval_type, status, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      values
    );
    return result.insertId;
  }
  if (record.operationType === 'update') {
    await connection.execute(
      `UPDATE projects SET project_year=?, project_group=?, project_code=?, title=?, category=?, approval_date=?, approval_type=?, status=?, remark=?, deleted_at=NULL, updated_at=NOW()
       WHERE id=?`,
      [...values, record.targetId]
    );
    return record.targetId;
  }
  return null;
}

async function applyPersonRecord(connection, record) {
  if (record.operationType === 'skip') return null;
  const after = record.afterSnapshot;
  const values = [after.person_type, after.name, after.student_no, after.teacher_no, after.college, after.unit, after.phone, after.qq, after.email, after.title, after.account_status, after.remark];
  if (record.targetId) {
    await connection.execute(
      `UPDATE people SET person_type=?, name=?, student_no=?, teacher_no=?, college=?, unit=?, phone=?, qq=?, email=?, title=?, account_status=?, remark=?, deleted_at=NULL, updated_at=NOW()
       WHERE id=?`,
      [...values, record.targetId]
    );
    return record.targetId;
  }
  const [result] = await connection.execute(
    `INSERT INTO people (person_type, name, student_no, teacher_no, college, unit, phone, qq, email, title, account_status, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values
  );
  return result.insertId;
}

async function applyParticipationRecord(connection, record) {
  const after = record.afterSnapshot;
  if (record.operationType === 'skip') return null;
  if (record.operationType === 'remove') {
    await connection.execute('UPDATE project_participations SET deleted_at = NOW(), updated_at = NOW() WHERE id = ?', [record.targetId]);
    return record.targetId;
  }
  if (record.operationType === 'create') {
    const [result] = await connection.execute(
      `INSERT INTO project_participations (project_id, person_id, role, is_primary_owner, joined_at, remark)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE is_primary_owner=VALUES(is_primary_owner), joined_at=VALUES(joined_at), remark=VALUES(remark), deleted_at=NULL`,
      [after.project_id, after.person_id, after.role, after.is_primary_owner, after.joined_at, after.remark]
    );
    return result.insertId || record.targetId;
  }
  if (record.operationType === 'update') {
    await connection.execute(
      `UPDATE project_participations SET is_primary_owner=?, joined_at=?, remark=?, deleted_at=NULL, updated_at=NOW() WHERE id=?`,
      [after.is_primary_owner, after.joined_at, after.remark, record.targetId]
    );
    return record.targetId;
  }
  return null;
}

async function applyCheckRecord(connection, record) {
  if (record.operationType === 'skip') return null;
  const after = record.afterSnapshot;
  const values = [after.project_id, after.check_phase, after.research_log_count, after.rating, after.checked_at, after.remark];
  if (record.targetId) {
    await connection.execute(
      `UPDATE project_check_records SET project_id=?, check_phase=?, research_log_count=?, rating=?, checked_at=?, remark=?, deleted_at=NULL, updated_at=NOW()
       WHERE id=?`,
      [...values, record.targetId]
    );
    return record.targetId;
  }
  const [result] = await connection.execute(
    `INSERT INTO project_check_records (project_id, check_phase, research_log_count, rating, checked_at, remark)
     VALUES (?, ?, ?, ?, ?, ?)`,
    values
  );
  return result.insertId;
}

async function applyReimbursementRecord(connection, record) {
  if (record.operationType === 'skip') return null;
  const after = record.afterSnapshot;
  const values = [
    after.project_id, after.budget_amount, after.midterm_claim_amount, after.midterm_actual_amount,
    after.stage_claim_amount, after.stage_actual_amount, after.remaining_amount, after.remark
  ];
  if (record.targetId) {
    await connection.execute(
      `UPDATE reimbursement_records SET project_id=?, budget_amount=?, midterm_claim_amount=?, midterm_actual_amount=?,
         stage_claim_amount=?, stage_actual_amount=?, remaining_amount=?, remark=?, deleted_at=NULL, updated_at=NOW()
       WHERE id=?`,
      [...values, record.targetId]
    );
    return record.targetId;
  }
  const [result] = await connection.execute(
    `INSERT INTO reimbursement_records
     (project_id, budget_amount, midterm_claim_amount, midterm_actual_amount, stage_claim_amount, stage_actual_amount, remaining_amount, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    values
  );
  return result.insertId;
}

async function commitPlannedBatch(batchUuid, userId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const batch = await getBatchByUuid(connection, batchUuid);
    const summary = typeof batch.summary_json === 'string' ? JSON.parse(batch.summary_json) : batch.summary_json;
    if (batch.status !== 'validated') throw badRequest('该批次不能重复导入', 'VALIDATION_ERROR');
    if (!summary.valid) throw badRequest('预检查存在错误，不能正式导入', 'VALIDATION_ERROR');
    const records = await loadBatchRecords(connection, batch.id);
    const applied = [];
    for (const record of records) {
      let targetId = record.targetId;
      if (record.entityType === 'project') targetId = await applyProjectRecord(connection, record);
      if (record.entityType === 'person') targetId = await applyPersonRecord(connection, record);
      if (record.entityType === 'participation') targetId = await applyParticipationRecord(connection, record);
      if (record.entityType === 'check_record') targetId = await applyCheckRecord(connection, record);
      if (record.entityType === 'reimbursement') targetId = await applyReimbursementRecord(connection, record);
      const status = record.operationType === 'skip' ? 'skipped' : 'applied';
      await connection.execute('UPDATE import_batch_records SET target_id = COALESCE(?, target_id), status = ? WHERE id = ?', [targetId, status, record.id]);
      applied.push({ ...record, targetId, status });
    }
    const changedPersonIds = applied.filter((record) => record.entityType === 'person' && record.targetId).map((record) => record.targetId);
    const ownerProjectsForPeople = await ownershipProjectIdsForPeople(connection, changedPersonIds);
    await assertFormalProjectOwnership(connection, [...affectedProjectIds(applied), ...ownerProjectsForPeople]);
    const nextSummary = { ...summary, applied: applied.filter((record) => record.status === 'applied').length };
    await connection.execute(
      `UPDATE import_batches SET status = 'committed', committed_by = ?, committed_at = NOW(), summary_json = CAST(? AS JSON) WHERE id = ?`,
      [userId, JSON.stringify(nextSummary), batch.id]
    );
    await connection.commit();
    return nextSummary;
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      error.status = 409;
      error.code = 'DUPLICATE_RESOURCE';
      error.message = '数据库已存在相同唯一编号，请改用更新方式或修正文件';
    }
    throw error;
  } finally {
    connection.release();
  }
}

function currentEqualsAfter(current, after, fields) {
  for (const field of fields) {
    if (comparable(current?.[field]) !== comparable(after?.[field])) return false;
  }
  return true;
}

async function currentProjectSnapshot(connection, targetId) {
  const [[row]] = await connection.execute(
    `SELECT id, project_year, project_group, project_code, title, category, approval_date, approval_type, status, remark, deleted_at
     FROM projects WHERE id = ?`,
    [targetId]
  );
  return normalizeJsonSnapshot(row, ['id', ...Object.keys(projectFields), 'deleted_at']);
}

async function currentParticipationSnapshot(connection, targetId) {
  const [[row]] = await connection.execute(
    `SELECT id, project_id, person_id, role, is_primary_owner, joined_at, remark, deleted_at
     FROM project_participations WHERE id = ?`,
    [targetId]
  );
  return normalizeJsonSnapshot(row, ['id', 'project_id', 'person_id', 'role', 'is_primary_owner', 'joined_at', 'remark', 'deleted_at']);
}

async function currentPersonSnapshot(connection, targetId) {
  const [[row]] = await connection.execute(
    `SELECT id, person_type, name, student_no, teacher_no, college, unit, phone, qq, email, title, account_status, remark, deleted_at
     FROM people WHERE id = ?`,
    [targetId]
  );
  return normalizeJsonSnapshot(row, ['id', 'person_type', 'student_no', 'teacher_no', ...Object.keys(personFields), 'deleted_at']);
}

async function currentCheckSnapshot(connection, targetId) {
  const [[row]] = await connection.execute(
    `SELECT id, project_id, check_phase, research_log_count, rating, checked_at, remark, deleted_at
     FROM project_check_records WHERE id = ?`,
    [targetId]
  );
  return normalizeJsonSnapshot(row, ['id', 'project_id', 'check_phase', ...Object.keys(checkFields), 'deleted_at']);
}

async function currentReimbursementSnapshot(connection, targetId) {
  const [[row]] = await connection.execute(
    `SELECT id, project_id, budget_amount, midterm_claim_amount, midterm_actual_amount, stage_claim_amount, stage_actual_amount, remaining_amount, remark, deleted_at
     FROM reimbursement_records WHERE id = ?`,
    [targetId]
  );
  return normalizeJsonSnapshot(row, ['id', 'project_id', ...Object.keys(reimbursementFields), 'deleted_at']);
}

function rollbackFieldsForEntity(entityType) {
  if (entityType === 'project') return [...Object.keys(projectFields), 'deleted_at'];
  if (entityType === 'person') return ['person_type', 'student_no', 'teacher_no', ...Object.keys(personFields), 'deleted_at'];
  if (entityType === 'participation') return ['project_id', 'person_id', 'role', ...Object.keys(participationFields), 'deleted_at'];
  if (entityType === 'check_record') return ['project_id', 'check_phase', ...Object.keys(checkFields), 'deleted_at'];
  if (entityType === 'reimbursement') return ['project_id', ...Object.keys(reimbursementFields), 'deleted_at'];
  return [];
}

async function currentSnapshotForEntity(connection, entityType, targetId) {
  if (entityType === 'project') return currentProjectSnapshot(connection, targetId);
  if (entityType === 'person') return currentPersonSnapshot(connection, targetId);
  if (entityType === 'participation') return currentParticipationSnapshot(connection, targetId);
  if (entityType === 'check_record') return currentCheckSnapshot(connection, targetId);
  if (entityType === 'reimbursement') return currentReimbursementSnapshot(connection, targetId);
  return null;
}

async function rollbackBatch(batchUuid, userId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const batch = await getBatchByUuid(connection, batchUuid);
    if (batch.status !== 'committed') throw badRequest('只有已正式导入且未回滚的批次可以回滚', 'VALIDATION_ERROR');
    const records = (await loadBatchRecords(connection, batch.id)).filter((record) => record.status === 'applied');
    const rollbackUuid = crypto.randomUUID();
    const rollbackRecords = [];
    for (const record of records.reverse()) {
      const fields = rollbackFieldsForEntity(record.entityType);
      const current = await currentSnapshotForEntity(connection, record.entityType, record.targetId);
      const after = record.afterSnapshot;
      if (!currentEqualsAfter(current, after, fields.filter((field) => field !== 'id'))) {
        rollbackRecords.push({
          entityType: record.entityType,
          entityKey: record.entityKey,
          targetTable: record.targetTable,
          targetId: record.targetId,
          operationType: 'conflict',
          status: 'conflict',
          beforeSnapshot: current,
          afterSnapshot: record.beforeSnapshot,
          message: '当前值已被后续操作修改，自动回滚已跳过'
        });
        continue;
      }
      if (record.entityType === 'project') {
        const before = record.beforeSnapshot;
        if (record.operationType === 'create') {
          await connection.execute('UPDATE projects SET deleted_at = NOW(), updated_at = NOW() WHERE id = ?', [record.targetId]);
        } else if (before) {
          await connection.execute(
            `UPDATE projects SET project_year=?, project_group=?, project_code=?, title=?, category=?, approval_date=?, approval_type=?, status=?, remark=?, deleted_at=?, updated_at=NOW()
             WHERE id=?`,
            [before.project_year, before.project_group, before.project_code, before.title, before.category, before.approval_date, before.approval_type, before.status, before.remark, before.deleted_at, record.targetId]
          );
        }
      }
      if (record.entityType === 'participation') {
        const before = record.beforeSnapshot;
        if (record.operationType === 'create') {
          await connection.execute('UPDATE project_participations SET deleted_at = NOW(), updated_at = NOW() WHERE id = ?', [record.targetId]);
        } else if (record.operationType === 'remove' && before) {
          await connection.execute(
            `UPDATE project_participations SET is_primary_owner=?, joined_at=?, remark=?, deleted_at=?, updated_at=NOW() WHERE id=?`,
            [before.is_primary_owner, before.joined_at, before.remark, before.deleted_at, record.targetId]
          );
        } else if (before) {
          await connection.execute(
            `UPDATE project_participations SET is_primary_owner=?, joined_at=?, remark=?, deleted_at=?, updated_at=NOW() WHERE id=?`,
            [before.is_primary_owner, before.joined_at, before.remark, before.deleted_at, record.targetId]
          );
        }
      }
      if (record.entityType === 'person') {
        const before = record.beforeSnapshot;
        if (record.operationType === 'create' && !before) {
          await connection.execute('UPDATE people SET deleted_at = NOW(), updated_at = NOW() WHERE id = ?', [record.targetId]);
        } else if (before) {
          await connection.execute(
            `UPDATE people SET person_type=?, name=?, student_no=?, teacher_no=?, college=?, unit=?, phone=?, qq=?, email=?, title=?, account_status=?, remark=?, deleted_at=?, updated_at=NOW()
             WHERE id=?`,
            [before.person_type, before.name, before.student_no, before.teacher_no, before.college, before.unit, before.phone, before.qq, before.email, before.title, before.account_status, before.remark, before.deleted_at, record.targetId]
          );
        }
      }
      if (record.entityType === 'check_record') {
        const before = record.beforeSnapshot;
        if (record.operationType === 'create' && !before) {
          await connection.execute('UPDATE project_check_records SET deleted_at = NOW(), updated_at = NOW() WHERE id = ?', [record.targetId]);
        } else if (before) {
          await connection.execute(
            `UPDATE project_check_records SET project_id=?, check_phase=?, research_log_count=?, rating=?, checked_at=?, remark=?, deleted_at=?, updated_at=NOW()
             WHERE id=?`,
            [before.project_id, before.check_phase, before.research_log_count, before.rating, before.checked_at, before.remark, before.deleted_at, record.targetId]
          );
        }
      }
      if (record.entityType === 'reimbursement') {
        const before = record.beforeSnapshot;
        if (record.operationType === 'create' && !before) {
          await connection.execute('UPDATE reimbursement_records SET deleted_at = NOW(), updated_at = NOW() WHERE id = ?', [record.targetId]);
        } else if (before) {
          await connection.execute(
            `UPDATE reimbursement_records SET project_id=?, budget_amount=?, midterm_claim_amount=?, midterm_actual_amount=?,
               stage_claim_amount=?, stage_actual_amount=?, remaining_amount=?, remark=?, deleted_at=?, updated_at=NOW()
             WHERE id=?`,
            [before.project_id, before.budget_amount, before.midterm_claim_amount, before.midterm_actual_amount, before.stage_claim_amount, before.stage_actual_amount, before.remaining_amount, before.remark, before.deleted_at, record.targetId]
          );
        }
      }
      rollbackRecords.push({
        entityType: record.entityType,
        entityKey: record.entityKey,
        targetTable: record.targetTable,
        targetId: record.targetId,
        operationType: 'restore',
        status: 'applied',
        beforeSnapshot: current,
        afterSnapshot: record.beforeSnapshot,
        message: null
      });
    }
    const summary = countBy(rollbackRecords);
    const [rollbackResult] = await connection.execute(
      `INSERT INTO import_batches
       (batch_uuid, import_type, mode, status, summary_json, errors_json, parent_batch_id, created_by, committed_by, committed_at)
       VALUES (?, 'rollback', 'revert', 'committed', CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?, NOW())`,
      [rollbackUuid, JSON.stringify(summary), JSON.stringify([]), batch.id, userId, userId]
    );
    for (const record of rollbackRecords) {
      await connection.execute(
        `INSERT INTO import_batch_records
         (batch_id, entity_type, entity_key, target_table, target_id, operation_type, status, before_snapshot, after_snapshot, message)
         VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?)`,
        [rollbackResult.insertId, record.entityType, record.entityKey, record.targetTable, record.targetId, record.operationType, record.status, JSON.stringify(record.beforeSnapshot), JSON.stringify(record.afterSnapshot), record.message]
      );
    }
    await connection.execute(
      `UPDATE import_batches SET status = ?, rolled_back_by = ?, rolled_back_at = NOW() WHERE id = ?`,
      [summary.conflict ? 'rollback_partial' : 'rolled_back', userId, batch.id]
    );
    const changedPersonIds = records.filter((record) => record.entityType === 'person' && record.targetId).map((record) => record.targetId);
    const ownerProjectsForPeople = await ownershipProjectIdsForPeople(connection, changedPersonIds);
    await assertFormalProjectOwnership(connection, [...affectedProjectIds(records), ...ownerProjectsForPeople]);
    await connection.commit();
    return { rollbackBatchUuid: rollbackUuid, ...summary };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function validateSimplifiedImport(type, file, userId) {
  if (!file) throw badRequest('Excel file is required', 'VALIDATION_ERROR');
  if (path.extname(file.originalname).toLowerCase() !== '.xlsx') throw badRequest('Only .xlsx files are supported', 'VALIDATION_ERROR');
  const batchUuid = crypto.randomUUID();
  const workbook = await readWorkbook(file.buffer);
  const connection = await pool.getConnection();
  let savedFile;
  try {
    savedFile = await saveOriginalFile(file, batchUuid);
    let result;
    if (type === 'simple-projects') result = await validateSimpleProjects(workbook, connection);
    else if (type === 'project-field-update') result = await validateProjectFieldUpdate(workbook, connection);
    else if (type === 'people') result = await validatePeopleUpdate(workbook, connection);
    else if (type === 'project-participations') result = await validateProjectParticipations(workbook, connection);
    else if (type === 'checks') result = await validateCheckRecords(workbook, connection);
    else if (type === 'reimbursements') result = await validateReimbursements(workbook, connection);
    else throw notFound('导入类型不存在');

    await connection.beginTransaction();
    const batch = await insertBatch(connection, {
      batchUuid,
      importType: importModules[type]?.importType || type.replaceAll('-', '_'),
      mode: 'upsert',
      file,
      savedFile,
      records: result.records,
      errors: result.errors,
      userId
    });
    await connection.commit();
    return { batchId: batch.batchUuid, valid: result.errors.length === 0, errorCount: result.errors.length, summary: batch.summary };
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    if (savedFile?.path) await fs.promises.unlink(savedFile.path).catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

function readRows(workbook, definition) {
  const rows = worksheetRows(workbook, definition.name);
  return rows ? canonicalizeRows(rows) : rows;
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

async function validateWorkbook(buffer) {
  const workbook = await readWorkbook(buffer);
  const data = {};
  const errors = [];
  for (const [key, definition] of Object.entries(sheetDefinitions)) {
    data[key] = readRows(workbook, definition);
    validateRequired(data[key], definition, errors);
  }
  duplicateErrors(data.projects, sheetDefinitions.projects.name, sheetDefinitions.projects.key, errors, (row) => clean(row.project_code));
  duplicateErrors(data.people, sheetDefinitions.people.name, sheetDefinitions.people.key, errors, (row) => clean(row.student_no || row.teacher_no));
  duplicateErrors(data.participations, sheetDefinitions.participations.name, sheetDefinitions.participations.key, errors,
    (row) => [clean(row.project_code), clean(row.person_type), clean(row.person_identifier), clean(row.role)].join('|'));
  duplicateErrors(data.checks, sheetDefinitions.checks.name, sheetDefinitions.checks.key, errors,
    (row) => [clean(row.project_code), clean(row.check_phase)].join('|'));
  duplicateErrors(data.reimbursements, sheetDefinitions.reimbursements.name, sheetDefinitions.reimbursements.key, errors, (row) => clean(row.project_code));
  return { data, errors };
}

function batchPath(batchId) {
  return path.join(batchDir, `${batchId}.json`);
}

async function loadTempBatch(batchId) {
  try {
    const batch = JSON.parse(await fs.promises.readFile(batchPath(batchId), 'utf8'));
    if (new Date(batch.expiresAt).getTime() < Date.now()) throw notFound('Import batch has expired');
    return batch;
  } catch (error) {
    if (error.status) throw error;
    throw notFound('Import batch not found');
  }
}

async function commitStandardWorkbook(batch, userId) {
  const connection = await pool.getConnection();
  const records = [];
  try {
    await connection.beginTransaction();
    const data = batch.data;
    for (const row of data.projects || []) {
      const values = [Number(row.project_year), optional(row.project_group), clean(row.project_code), clean(row.title), optional(row.category), optional(row.approval_date), clean(row.approval_type) || 'first', clean(row.status) || 'active', optional(row.remark)];
      const [result] = await connection.execute(
        `INSERT INTO projects (project_year, project_group, project_code, title, category, approval_date, approval_type, status, remark)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE project_year=VALUES(project_year), project_group=VALUES(project_group), title=VALUES(title),
           category=VALUES(category), approval_date=VALUES(approval_date), approval_type=VALUES(approval_type), status=VALUES(status), remark=VALUES(remark), deleted_at=NULL`,
        values
      );
      records.push({ entityType: 'project', entityKey: clean(row.project_code), targetTable: 'projects', targetId: result.insertId || null, operationType: result.insertId ? 'create' : 'update', status: 'applied', beforeSnapshot: null, afterSnapshot: null, message: '标准工作簿兼容导入' });
    }
    for (const row of data.people || []) {
      const values = [clean(row.person_type), clean(row.name), optional(row.student_no), optional(row.teacher_no), optional(row.college), optional(row.unit), optional(row.phone), optional(row.qq), optional(row.email), optional(row.title), clean(row.account_status) || 'none', optional(row.remark)];
      const identifierField = clean(row.person_type) === 'student' ? 'student_no' : 'teacher_no';
      const identifier = clean(row[identifierField]);
      const [[existing]] = await connection.execute(`SELECT id FROM people WHERE ${identifierField} = ? LIMIT 1`, [identifier]);
      if (existing) {
        await connection.execute(
          `UPDATE people SET person_type=?, name=?, student_no=?, teacher_no=?, college=?, unit=?, phone=?, qq=?, email=?, title=?, account_status=?, remark=?, deleted_at=NULL WHERE id=?`,
          [...values, existing.id]
        );
      } else {
        const [result] = await connection.execute(`INSERT INTO people (person_type,name,student_no,teacher_no,college,unit,phone,qq,email,title,account_status,remark) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, values);
        records.push({ entityType: 'person', entityKey: identifier, targetTable: 'people', targetId: result.insertId, operationType: 'create', status: 'applied', beforeSnapshot: null, afterSnapshot: null, message: '标准工作簿兼容导入' });
      }
    }
    const [projectRows] = await connection.execute('SELECT id, project_code FROM projects WHERE deleted_at IS NULL');
    const projectMap = new Map(projectRows.map((row) => [row.project_code, row.id]));
    const [peopleRows] = await connection.execute('SELECT id, student_no, teacher_no FROM people WHERE deleted_at IS NULL');
    const peopleMap = new Map(peopleRows.map((row) => [row.student_no || row.teacher_no, row.id]));
    for (const row of data.participations || []) {
      const values = [projectMap.get(clean(row.project_code)), peopleMap.get(clean(row.person_identifier)), clean(row.role), boolValue(row.is_primary_owner), optional(row.joined_at), optional(row.remark)];
      await connection.execute(
        `INSERT INTO project_participations (project_id, person_id, role, is_primary_owner, joined_at, remark)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE is_primary_owner=VALUES(is_primary_owner), joined_at=VALUES(joined_at), remark=VALUES(remark), deleted_at=NULL`,
        values
      );
    }
    const importedProjectIds = (data.projects || []).map((row) => projectMap.get(clean(row.project_code))).filter(Boolean);
    const importedPersonIds = (data.people || []).map((row) => peopleMap.get(clean(row.student_no || row.teacher_no))).filter(Boolean);
    const ownerProjectsForPeople = await ownershipProjectIdsForPeople(connection, importedPersonIds);
    await assertFormalProjectOwnership(connection, [...importedProjectIds, ...ownerProjectsForPeople]);
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
    const summary = {
      valid: true,
      projects: (data.projects || []).length,
      people: (data.people || []).length,
      participations: (data.participations || []).length,
      checks: (data.checks || []).length,
      reimbursements: (data.reimbursements || []).length
    };
    const [batchResult] = await connection.execute(
      `INSERT INTO import_batches
       (batch_uuid, import_type, mode, status, original_file_name, original_file_path, file_sha256, file_size, summary_json, errors_json, created_by, committed_by, committed_at)
       VALUES (?, 'standard_workbook', ?, 'committed', ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?, NOW())`,
      [crypto.randomUUID(), batch.mode || 'upsert', batch.originalFileName || null, batch.originalFilePath || null, batch.fileSha256 || null, batch.fileSize || null, JSON.stringify(summary), JSON.stringify([]), userId, userId]
    );
    for (const record of records) {
      await connection.execute(
        `INSERT INTO import_batch_records
         (batch_id, entity_type, entity_key, target_table, target_id, operation_type, status, before_snapshot, after_snapshot, message)
         VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?)`,
        [batchResult.insertId, record.entityType, record.entityKey, record.targetTable, record.targetId, record.operationType, record.status, JSON.stringify(record.beforeSnapshot), JSON.stringify(record.afterSnapshot), record.message]
      );
    }
    await connection.commit();
    return summary;
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      error.status = 409;
      error.code = 'DUPLICATE_RESOURCE';
      error.message = '数据库已存在相同唯一编号，请改用更新模式或修正文件';
    }
    throw error;
  } finally {
    connection.release();
  }
}

router.get('/field-options', requireAuth, requireRole('admin'), async (_req, res, next) => {
  try {
    const modules = [
      {
        key: 'simple-projects',
        title: '新建项目',
        description: '一行新建一个项目',
        kind: 'create',
        fixedFields: [],
        fields: ['project_code', ...Object.keys(projectFields).filter((field) => field !== 'project_code')]
          .map((field) => ({ field, label: projectFields[field].label, clearable: false })),
        defaultFields: ['project_code', ...Object.keys(projectFields).filter((field) => field !== 'project_code')]
      },
      ...Object.entries(importModules).map(([key, module]) => ({
        key,
        title: module.title,
        description: module.description,
        kind: 'update',
        fixedFields: module.fixedFields,
        fields: module.allowedFields.map((field) => ({ field, label: module.updateFields[field].label, clearable: Boolean(module.updateFields[field].nullable) })),
        defaultFields: module.defaultFields
      }))
    ];
    success(res, { modules });
  } catch (error) {
    next(error);
  }
});

router.get('/templates/:type/download', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    let headers;
    let rows = [];
    let fileName;
    if (req.params.type === 'simple-projects') {
      headers = ['project_code', ...Object.keys(projectFields).filter((field) => field !== 'project_code')].map((field) => fieldLabels[field]);
      fileName = '新建项目导入模板.xlsx';
    } else if (importModules[req.params.type]) {
      const module = importModules[req.params.type];
      const selected = clean(req.query.fields).split(',').map((item) => item.trim()).filter(Boolean);
      if (!selected.length || selected.some((field) => !module.allowedFields.includes(field))) {
        throw badRequest('请先选择需要修改的字段', 'VALIDATION_ERROR');
      }
      headers = [
        ...module.fixedFields.map((item) => item.label),
        ...selected.map((field) => module.updateFields[field].label)
      ];
      fileName = `${module.title}导入模板.xlsx`;
    } else {
      throw notFound('模板类型不存在');
    }
    const buffer = await xlsxBuffer(headers, rows, '数据导入');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

router.post('/standard-workbook/validate', requireAuth, requireRole('admin'), upload.single('file'), async (req, res, next) => {
  let savedFile;
  let batchId;
  try {
    if (!req.file) throw badRequest('Excel file is required', 'VALIDATION_ERROR');
    if (path.extname(req.file.originalname).toLowerCase() !== '.xlsx') throw badRequest('Only .xlsx files are supported', 'VALIDATION_ERROR');
    const { data, errors } = await validateWorkbook(req.file.buffer);
    batchId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    savedFile = await saveOriginalFile(req.file, batchId);
    await fs.promises.mkdir(batchDir, { recursive: true });
    await fs.promises.writeFile(batchPath(batchId), JSON.stringify({
      batchId,
      expiresAt,
      valid: errors.length === 0,
      errors,
      data,
      originalFileName: req.file.originalname,
      originalFilePath: savedFile.path,
      fileSha256: savedFile.sha256,
      fileSize: savedFile.size
    }), 'utf8');
    const sheets = Object.entries(sheetDefinitions).map(([key, definition]) => {
      const rows = data[key] || [];
      const errorRows = new Set(errors.filter((item) => item.sheet === definition.name).map((item) => item.row)).size;
      return { name: definition.name, totalRows: rows.length, validRows: Math.max(0, rows.length - errorRows), errorRows };
    });
    success(res, { batchId, valid: errors.length === 0, expiresAt, errorCount: errors.length, sheets }, '校验完成');
  } catch (error) {
    if (savedFile?.path) await fs.promises.unlink(savedFile.path).catch(() => undefined);
    if (batchId) await fs.promises.unlink(batchPath(batchId)).catch(() => undefined);
    next(error);
  }
});

router.post('/:type/validate', requireAuth, requireRole('admin'), upload.single('file'), async (req, res, next) => {
  try {
    const data = await validateSimplifiedImport(req.params.type, req.file, req.user.id);
    success(res, data, '预检查完成');
  } catch (error) {
    next(error);
  }
});

router.post('/:batchId/commit', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    if (await permanentBatchExists(req.params.batchId)) {
      const summary = await commitPlannedBatch(req.params.batchId, req.user.id);
      success(res, summary, '导入完成');
      return;
    }
    const batch = await loadTempBatch(req.params.batchId);
    if (!batch.valid) throw badRequest('Import batch contains validation errors', 'VALIDATION_ERROR');
    const mode = req.body.mode || 'create_only';
    if (!['create_only', 'upsert'].includes(mode)) throw badRequest('Import mode is invalid', 'VALIDATION_ERROR');
    batch.mode = mode;
    const summary = await commitStandardWorkbook(batch, req.user.id);
    await fs.promises.unlink(batchPath(req.params.batchId)).catch(() => undefined);
    success(res, summary, '导入完成');
  } catch (error) {
    next(error);
  }
});

router.get('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
    const offset = (page - 1) * pageSize;
    const conditions = ['1=1'];
    const params = [];
    if (req.query.status) {
      conditions.push('b.status = ?');
      params.push(req.query.status);
    }
    if (req.query.type) {
      conditions.push('b.import_type = ?');
      params.push(String(req.query.type).replaceAll('-', '_'));
    }
    const where = conditions.join(' AND ');
    const [[countRow]] = await pool.execute(`SELECT COUNT(*) AS total FROM import_batches b WHERE ${where}`, params);
    const [items] = await pool.execute(
      `SELECT b.batch_uuid AS batchId, b.import_type AS importType, b.mode, b.status,
              b.original_file_name AS originalFileName, b.file_sha256 AS fileSha256, b.file_size AS fileSize,
              b.summary_json AS summary, b.created_at AS createdAt, b.committed_at AS committedAt, b.rolled_back_at AS rolledBackAt,
              u.display_name AS createdByName
       FROM import_batches b
       JOIN users u ON u.id = b.created_by
       WHERE ${where}
       ORDER BY b.created_at DESC
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

router.get('/:batchId', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const connection = await pool.getConnection();
    try {
      const batch = await getBatchByUuid(connection, req.params.batchId);
      const records = await loadBatchRecords(connection, batch.id);
      success(res, {
        batchId: batch.batch_uuid,
        importType: batch.import_type,
        mode: batch.mode,
        status: batch.status,
        originalFileName: batch.original_file_name,
        fileSha256: batch.file_sha256,
        fileSize: batch.file_size,
        summary: batch.summary_json,
        errors: batch.errors_json,
        createdAt: batch.created_at,
        committedAt: batch.committed_at,
        rolledBackAt: batch.rolled_back_at,
        records
      });
    } finally {
      connection.release();
    }
  } catch (error) {
    next(error);
  }
});

router.get('/:batchId/original/download', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const [[batch]] = await pool.execute('SELECT original_file_name, original_file_path FROM import_batches WHERE batch_uuid = ?', [req.params.batchId]);
    if (!batch?.original_file_path) throw notFound('原始文件不存在');
    const filePath = await resolveDownloadFile(importRoot, batch.original_file_path, {
      invalidMessage: '原始文件路径不安全',
      missingMessage: '原始文件不存在'
    });
    res.download(filePath, batch.original_file_name || 'import.xlsx');
  } catch (error) {
    next(error);
  }
});

router.get('/:batchId/errors/download', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    let errors;
    if (await permanentBatchExists(req.params.batchId)) {
      const [[batch]] = await pool.execute('SELECT errors_json FROM import_batches WHERE batch_uuid = ?', [req.params.batchId]);
      if (!batch) throw notFound('导入记录不存在');
      errors = typeof batch.errors_json === 'string' ? JSON.parse(batch.errors_json) : batch.errors_json || [];
    } else {
      const batch = await loadTempBatch(req.params.batchId);
      errors = batch.errors || [];
    }
    const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const lines = ['工作表,Excel行号,字段,原值,错误原因', ...errors.map((item) => [item.sheet, item.row, item.field, item.value, item.reason].map(escape).join(','))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="import-errors-${req.params.batchId}.csv"`);
    res.send(`\uFEFF${lines.join('\r\n')}`);
  } catch (error) {
    next(error);
  }
});

router.get('/:batchId/diff/download', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const [[batch]] = await pool.execute('SELECT id FROM import_batches WHERE batch_uuid = ?', [req.params.batchId]);
    if (!batch) throw notFound('导入记录不存在');
    const [rows] = await pool.execute(
      `SELECT r.excel_row_number, r.entity_type, r.entity_key, r.operation_type, r.status, c.field_name, c.before_value, c.after_value, r.message
       FROM import_batch_records r
       LEFT JOIN import_batch_field_changes c ON c.record_id = r.id
       WHERE r.batch_id = ?
       ORDER BY r.id, c.id`,
      [batch.id]
    );
    const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const lines = ['Excel行号,对象类型,唯一识别,操作,状态,字段,原值,新值,说明', ...rows.map((row) => [
      row.excel_row_number, row.entity_type, row.entity_key, row.operation_type, row.status, row.field_name, row.before_value, row.after_value, row.message
    ].map(escape).join(','))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="import-diff-${req.params.batchId}.csv"`);
    res.send(`\uFEFF${lines.join('\r\n')}`);
  } catch (error) {
    next(error);
  }
});

router.post('/:batchId/rollback', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await rollbackBatch(req.params.batchId, req.user.id);
    success(res, result, '回滚完成');
  } catch (error) {
    next(error);
  }
});

export default router;
