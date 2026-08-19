import fs from 'node:fs/promises';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import ExcelJS from 'exceljs';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

let apiBase;
let server;
const projectCodes = ['T14-ROLLBACK', 'T14-CONFLICT', 'T14-PART', 'T14-PART-2'];
const studentNo = 'T14-STUDENT-001';
const batchIds = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function adminToken() {
  const [[admin]] = await pool.execute(
    "SELECT id, username, role, person_id, token_version FROM users WHERE role = 'admin' AND status = 'enabled' AND password_reset_required = 0 AND deleted_at IS NULL ORDER BY id LIMIT 1"
  );
  if (!admin) throw new Error('No enabled administrator account is available');
  return jwt.sign(
    { id: admin.id, username: admin.username, role: admin.role, personId: admin.person_id, tokenVersion: admin.token_version },
    env.jwt.secret,
    { expiresIn: '10m' }
  );
}

async function startServer() {
  const app = createApp();
  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  apiBase = `http://127.0.0.1:${server.address().port}/api`;
}

async function closeServer() {
  if (!server) return;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function workbookBuffer(headers, rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('数据导入');
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  sheet.eachRow((row) => row.eachCell({ includeEmpty: true }, (cell) => { cell.numFmt = '@'; }));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function postWorkbook(token, url, buffer, filename) {
  const body = new FormData();
  body.append('file', new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }), filename);
  const response = await fetch(`${apiBase}${url}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body
  });
  const payload = await response.json();
  return { response, payload };
}

async function postJson(token, url) {
  const response = await fetch(`${apiBase}${url}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}'
  });
  const payload = await response.json();
  return { response, payload };
}

async function get(token, url) {
  const response = await fetch(`${apiBase}${url}`, { headers: { Authorization: `Bearer ${token}` } });
  const payload = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
  return { response, payload };
}

async function cleanup() {
  const [batchRows] = await pool.query('SELECT original_file_path FROM import_batches WHERE batch_uuid IN (?)', [batchIds.length ? batchIds : ['none']]);
  for (const row of batchRows) {
    if (row.original_file_path) {
      await fs.unlink(path.resolve(env.upload.root, '../imports', row.original_file_path)).catch(() => undefined);
    }
  }
  await pool.query('DELETE c FROM import_batch_field_changes c JOIN import_batch_records r ON r.id = c.record_id JOIN import_batches b ON b.id = r.batch_id WHERE b.batch_uuid IN (?)', [batchIds.length ? batchIds : ['none']]);
  await pool.query('DELETE r FROM import_batch_records r JOIN import_batches b ON b.id = r.batch_id WHERE b.batch_uuid IN (?)', [batchIds.length ? batchIds : ['none']]);
  await pool.query('DELETE FROM import_batches WHERE batch_uuid IN (?)', [batchIds.length ? batchIds : ['none']]);
  await pool.query('DELETE pp FROM project_participations pp JOIN projects p ON p.id = pp.project_id WHERE p.project_code IN (?)', [projectCodes]);
  await pool.query('DELETE c FROM project_check_records c JOIN projects p ON p.id = c.project_id WHERE p.project_code IN (?)', [projectCodes]);
  await pool.query('DELETE r FROM reimbursement_records r JOIN projects p ON p.id = r.project_id WHERE p.project_code IN (?)', [projectCodes]);
  await pool.query('DELETE FROM projects WHERE project_code IN (?)', [projectCodes]);
  await pool.execute('DELETE FROM people WHERE student_no = ?', [studentNo]);
}

try {
  await startServer();
  const token = await adminToken();
  await cleanup();

  const template = await get(token, '/imports/templates/project-field-update/download?fields=title,remark');
  assert(template.response.ok, 'Dynamic project field template download failed');
  for (const url of [
    '/imports/templates/people/download?fields=name,phone,remark',
    '/imports/templates/project-participations/download?fields=is_primary_owner,joined_at,remark',
    '/imports/templates/checks/download?fields=research_log_count,rating',
    '/imports/templates/reimbursements/download?fields=budget_amount,remaining_amount'
  ]) {
    const moduleTemplate = await get(token, url);
    assert(moduleTemplate.response.ok, `Dynamic module template download failed: ${url}`);
  }
  const fieldOptions = await get(token, '/imports/field-options');
  assert(fieldOptions.response.ok && fieldOptions.payload.data.modules.length === 6, 'Import module field options are incomplete');

  const createHeaders = ['project_code', 'project_year', 'project_group', 'title', 'category', 'approval_date', 'approval_type', 'status', 'remark'];
  const createRows = [
    ['T14-ROLLBACK', '2026', '对话14', '可回滚项目', '测试', '2026-08-07', 'first', 'draft', '初始备注'],
    ['T14-CONFLICT', '2026', '对话14', '冲突项目', '测试', '2026-08-07', 'first', 'draft', '初始备注']
  ];
  const createCheck = await postWorkbook(token, '/imports/simple-projects/validate', await workbookBuffer(createHeaders, createRows), '新建项目.xlsx');
  assert(createCheck.response.ok && createCheck.payload.data.valid, `Simple project validation failed: ${createCheck.payload?.message}`);
  assert(createCheck.payload.data.summary.create === 2, 'Simple project precheck did not report two creates');
  batchIds.push(createCheck.payload.data.batchId);
  const createCommit = await postJson(token, `/imports/${createCheck.payload.data.batchId}/commit`);
  assert(createCommit.response.ok, 'Simple project commit failed');

  const rollbackCreate = await postJson(token, `/imports/${createCheck.payload.data.batchId}/rollback`);
  batchIds.push(rollbackCreate.payload.data.rollbackBatchUuid);
  assert(rollbackCreate.response.ok && rollbackCreate.payload.data.restore === 2, `Normal batch rollback failed: ${JSON.stringify(rollbackCreate.payload)}`);
  const [[rolledBackProject]] = await pool.execute('SELECT deleted_at FROM projects WHERE project_code = ?', ['T14-ROLLBACK']);
  assert(rolledBackProject.deleted_at, 'Project created by import was not soft deleted by rollback');

  const conflictCreate = await postWorkbook(token, '/imports/simple-projects/validate', await workbookBuffer(createHeaders, [
    ['T14-CONFLICT', '2026', '对话14', '冲突项目', '测试', '2026-08-07', 'first', 'draft', '初始备注']
  ]), '冲突项目.xlsx');
  batchIds.push(conflictCreate.payload.data.batchId);
  await postJson(token, `/imports/${conflictCreate.payload.data.batchId}/commit`);

  const updateCheck = await postWorkbook(token, '/imports/project-field-update/validate', await workbookBuffer(['project_code', 'title', 'remark'], [
    ['T14-CONFLICT', '清空备注后的标题', '[清空]']
  ]), '字段更新.xlsx');
  assert(updateCheck.response.ok && updateCheck.payload.data.valid, `Project field update validation failed: ${updateCheck.payload?.message}`);
  assert(updateCheck.payload.data.summary.update === 1, 'Project update precheck did not report one update');
  batchIds.push(updateCheck.payload.data.batchId);
  await postJson(token, `/imports/${updateCheck.payload.data.batchId}/commit`);
  const [[updatedProject]] = await pool.execute('SELECT title, remark FROM projects WHERE project_code = ?', ['T14-CONFLICT']);
  assert(updatedProject.title === '清空备注后的标题' && updatedProject.remark === null, 'Project update did not apply title and clear mark');
  await pool.execute('UPDATE projects SET title = ? WHERE project_code = ?', ['后续人工修改', 'T14-CONFLICT']);
  const conflictRollback = await postJson(token, `/imports/${updateCheck.payload.data.batchId}/rollback`);
  batchIds.push(conflictRollback.payload.data.rollbackBatchUuid);
  assert(conflictRollback.payload.data.conflict === 1, 'Rollback did not detect conflict after later change');

  await pool.execute(
    `INSERT INTO people (person_type, name, student_no, college, phone, account_status, remark) VALUES ('student', '对话14学生', ?, '原学院', '旧电话', 'none', '旧备注')`,
    [studentNo]
  );
  const partCreate = await postWorkbook(token, '/imports/simple-projects/validate', await workbookBuffer(createHeaders, [
    ['T14-PART', '2026', '对话14', '关系项目一', '测试', '2026-08-07', 'first', 'draft', ''],
    ['T14-PART-2', '2026', '对话14', '关系项目二', '测试', '2026-08-07', 'first', 'draft', '']
  ]), '关系项目.xlsx');
  batchIds.push(partCreate.payload.data.batchId);
  await postJson(token, `/imports/${partCreate.payload.data.batchId}/commit`);

  const peopleCheck = await postWorkbook(token, '/imports/people/validate', await workbookBuffer(
    ['人员类型', '人员编号', '电话', '学院', '备注'],
    [['学生', studentNo, '13800000000', '', '[清空]']]
  ), '人员信息.xlsx');
  assert(peopleCheck.response.ok && peopleCheck.payload.data.valid, `People update validation failed: ${peopleCheck.payload?.message}`);
  batchIds.push(peopleCheck.payload.data.batchId);
  await postJson(token, `/imports/${peopleCheck.payload.data.batchId}/commit`);
  const [[updatedPerson]] = await pool.execute('SELECT college, phone, remark FROM people WHERE student_no = ?', [studentNo]);
  assert(updatedPerson.college === '原学院' && updatedPerson.phone === '13800000000' && updatedPerson.remark === null, 'People update did not preserve blank field or apply clear mark');
  const peopleRollback = await postJson(token, `/imports/${peopleCheck.payload.data.batchId}/rollback`);
  batchIds.push(peopleRollback.payload.data.rollbackBatchUuid);
  assert(peopleRollback.payload.data.restore === 1, 'People update rollback failed');
  const [[restoredPerson]] = await pool.execute('SELECT phone, remark FROM people WHERE student_no = ?', [studentNo]);
  assert(restoredPerson.phone === '旧电话' && restoredPerson.remark === '旧备注', 'People rollback did not restore original fields');

  const checkCreate = await postWorkbook(token, '/imports/checks/validate', await workbookBuffer(
    ['项目编号', '检查阶段', '研究日志数量', '评级'],
    [['T14-PART', '中期检查', '3', '良好']]
  ), '检查记录.xlsx');
  assert(checkCreate.response.ok && checkCreate.payload.data.valid, `Check record validation failed: ${checkCreate.payload?.message}`);
  batchIds.push(checkCreate.payload.data.batchId);
  await postJson(token, `/imports/${checkCreate.payload.data.batchId}/commit`);
  const checkUpdate = await postWorkbook(token, '/imports/checks/validate', await workbookBuffer(
    ['项目编号', '检查阶段', '评级'],
    [['T14-PART', '中期检查', '优秀']]
  ), '检查评级.xlsx');
  assert(checkUpdate.response.ok && checkUpdate.payload.data.valid, `Check record update validation failed: ${checkUpdate.payload?.message}`);
  batchIds.push(checkUpdate.payload.data.batchId);
  await postJson(token, `/imports/${checkUpdate.payload.data.batchId}/commit`);
  const [[updatedCheck]] = await pool.execute(
    `SELECT c.research_log_count, c.rating FROM project_check_records c JOIN projects p ON p.id = c.project_id WHERE p.project_code = 'T14-PART' AND c.check_phase = 'midterm'`
  );
  assert(Number(updatedCheck.research_log_count) === 3 && updatedCheck.rating === '优秀', 'Check update changed an unselected field');
  const checkRollback = await postJson(token, `/imports/${checkUpdate.payload.data.batchId}/rollback`);
  batchIds.push(checkRollback.payload.data.rollbackBatchUuid);
  assert(checkRollback.payload.data.restore === 1, 'Check record rollback failed');

  const reimbursementCreate = await postWorkbook(token, '/imports/reimbursements/validate', await workbookBuffer(
    ['项目编号', '报销额度', '中期实际金额', '剩余额度'],
    [['T14-PART', '1000.00', '200.00', '800.00']]
  ), '报销记录.xlsx');
  assert(reimbursementCreate.response.ok && reimbursementCreate.payload.data.valid, `Reimbursement validation failed: ${reimbursementCreate.payload?.message}`);
  batchIds.push(reimbursementCreate.payload.data.batchId);
  await postJson(token, `/imports/${reimbursementCreate.payload.data.batchId}/commit`);
  const reimbursementUpdate = await postWorkbook(token, '/imports/reimbursements/validate', await workbookBuffer(
    ['项目编号', '剩余额度'],
    [['T14-PART', '750.00']]
  ), '剩余额度.xlsx');
  assert(reimbursementUpdate.response.ok && reimbursementUpdate.payload.data.valid, `Reimbursement update validation failed: ${reimbursementUpdate.payload?.message}`);
  batchIds.push(reimbursementUpdate.payload.data.batchId);
  await postJson(token, `/imports/${reimbursementUpdate.payload.data.batchId}/commit`);
  const [[updatedReimbursement]] = await pool.execute(
    `SELECT r.budget_amount, r.remaining_amount FROM reimbursement_records r JOIN projects p ON p.id = r.project_id WHERE p.project_code = 'T14-PART'`
  );
  assert(Number(updatedReimbursement.budget_amount) === 1000 && Number(updatedReimbursement.remaining_amount) === 750, 'Reimbursement update changed an unselected field');
  const reimbursementRollback = await postJson(token, `/imports/${reimbursementUpdate.payload.data.batchId}/rollback`);
  batchIds.push(reimbursementRollback.payload.data.rollbackBatchUuid);
  assert(reimbursementRollback.payload.data.restore === 1, 'Reimbursement rollback failed');

  const participationCheck = await postWorkbook(token, '/imports/project-participations/validate', await workbookBuffer(
    ['项目编号', '人员类型', '人员编号', '项目身份', '操作', '是否主要负责人', '加入日期', '备注'],
    [['T14-PART', '学生', studentNo, '负责人', '', '是', '2026-08-07', '负责人']]
  ), '人员关系.xlsx');
  assert(participationCheck.response.ok && participationCheck.payload.data.valid, `Participation validation failed: ${participationCheck.payload?.message}`);
  batchIds.push(participationCheck.payload.data.batchId);
  await postJson(token, `/imports/${participationCheck.payload.data.batchId}/commit`);
  const [[participation]] = await pool.execute(
    `SELECT pp.id, pp.deleted_at FROM project_participations pp
     JOIN projects p ON p.id = pp.project_id
     JOIN people pe ON pe.id = pp.person_id
     WHERE p.project_code = 'T14-PART' AND pe.student_no = ? AND pp.role = 'owner'`,
    [studentNo]
  );
  assert(participation && !participation.deleted_at, 'Participation import did not create owner relation');
  const partRollback = await postJson(token, `/imports/${participationCheck.payload.data.batchId}/rollback`);
  batchIds.push(partRollback.payload.data.rollbackBatchUuid);
  assert(partRollback.payload.data.restore === 1, 'Participation rollback did not restore one relation');

  const ruleCheck = await postWorkbook(token, '/imports/project-participations/validate', await workbookBuffer(
    ['项目编号', '人员类型', '人员编号', '项目身份', '操作', '是否主要负责人', '加入日期', '备注'],
    [
      ['T14-PART', '学生', studentNo, '负责人', '', '是', '2026-08-07', '负责人'],
      ['T14-PART-2', '学生', studentNo, '负责人', '', '是', '2026-08-07', '负责人']
    ]
  ), '规则违规.xlsx');
  batchIds.push(ruleCheck.payload.data.batchId);
  assert(ruleCheck.response.ok && ruleCheck.payload.data.valid === false, 'Participation rule violation was not blocked');

  const list = await get(token, '/imports?page=1&pageSize=5');
  assert(list.response.ok && Array.isArray(list.payload.data), 'Import record list failed');
  const detail = await get(token, `/imports/${updateCheck.payload.data.batchId}`);
  assert(detail.response.ok && detail.payload.data.records.some((record) => record.fields.length >= 1), 'Import detail did not include field changes');

  console.log(JSON.stringify({
    dynamicTemplate: 'ok',
    simplifiedProjectImport: 'ok',
    clearMark: 'ok',
    normalRollback: 'ok',
    conflictRollback: 'ok',
    participationImport: 'ok',
    participationRollback: 'ok',
    participationRule: 'ok',
    peopleFieldUpdate: 'ok',
    peopleRollback: 'ok',
    checkFieldUpdate: 'ok',
    checkRollback: 'ok',
    reimbursementFieldUpdate: 'ok',
    reimbursementRollback: 'ok',
    importRecords: 'ok'
  }, null, 2));
} finally {
  await cleanup().catch(() => undefined);
  await closeServer();
  await pool.end();
}
