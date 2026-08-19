import fs from 'node:fs/promises';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import ExcelJS from 'exceljs';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

const templatePath = path.resolve('templates/import/科研项目数据标准导入模板.xlsx');
const batchDir = path.resolve(env.upload.root, '../imports/batches');
let apiBase;
let server;

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

async function postWorkbook(token, buffer, filename) {
  const body = new FormData();
  body.append('file', new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }), filename);
  const response = await fetch(`${apiBase}/imports/standard-workbook/validate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body
  });
  const payload = await response.json();
  return { response, payload };
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

async function removeBatch(batchId) {
  if (!batchId) return;
  const tempPath = path.join(batchDir, `${batchId}.json`);
  const batch = await fs.readFile(tempPath, 'utf8').then((text) => JSON.parse(text)).catch(() => null);
  if (batch?.originalFilePath) {
    await fs.unlink(path.resolve(env.upload.root, '../imports', batch.originalFilePath)).catch(() => undefined);
  }
  await fs.unlink(tempPath).catch(() => undefined);
}

async function invalidWorkbookBuffer() {
  const workbook = new ExcelJS.Workbook();
  const sheets = [
    ['1_项目', ['project_year', 'project_group', 'project_code', 'title'], ['2026', '创新组', '', '缺少编号项目']],
    ['2_人员', ['person_type', 'name', 'student_no', 'teacher_no']],
    ['3_参与关系', ['project_code', 'person_type', 'person_identifier', 'role']],
    ['4_检查记录', ['project_code', 'check_phase']],
    ['5_报销记录', ['project_code']]
  ];
  for (const [sheetName, headers, row] of sheets) {
    const worksheet = workbook.addWorksheet(sheetName);
    worksheet.addRow(headers);
    if (row) worksheet.addRow(row);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function downloadErrors(token, batchId) {
  const response = await fetch(`${apiBase}/imports/${batchId}/errors/download`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const text = await response.text();
  assert(response.ok, 'Import error report download failed');
  return text;
}

let validBatchId;
let invalidBatchId;
let parseFailureBatchId;
try {
  await startServer();
  const token = await adminToken();

  const validCheck = await postWorkbook(token, await fs.readFile(templatePath), '科研项目数据标准导入模板.xlsx');
  validBatchId = validCheck.payload?.data?.batchId;
  assert(validCheck.response.ok, `Standard template validation failed: ${validCheck.payload?.message || validCheck.response.status}`);
  assert(validCheck.payload.data.valid === true, 'Standard import template did not validate successfully');
  assert(validCheck.payload.data.sheets.length === 5, 'Standard import template did not return five business sheet summaries');

  const invalidCheck = await postWorkbook(token, await invalidWorkbookBuffer(), '错误导入.xlsx');
  invalidBatchId = invalidCheck.payload?.data?.batchId;
  assert(invalidCheck.response.ok, `Invalid workbook precheck request failed unexpectedly: ${invalidCheck.payload?.message || invalidCheck.response.status}`);
  assert(invalidCheck.payload.data.valid === false, 'Invalid workbook was not reported as invalid');
  const errors = await downloadErrors(token, invalidBatchId);
  assert(errors.includes('工作表,Excel行号,字段,原值,错误原因'), 'Import error report header is missing');
  assert(errors.includes('1_项目') && errors.includes('project_code') && errors.includes('必填字段不能为空'), 'Import error report did not include the expected validation error');

  const parseFailure = await postWorkbook(token, Buffer.from('not an xlsx workbook'), '坏文件.xlsx');
  parseFailureBatchId = parseFailure.payload?.data?.batchId;
  assert(
    parseFailure.response.status === 400,
    `Broken workbook did not return HTTP 400: ${parseFailure.response.status} ${JSON.stringify(parseFailure.payload)}`
  );
  assert(parseFailure.payload?.code === 'VALIDATION_ERROR', 'Broken workbook did not return a validation error code');
  assert(parseFailure.payload?.message === '无法读取 Excel 工作簿', 'Broken workbook did not return the safe parse failure message');
  assert(!JSON.stringify(parseFailure.payload).includes('TypeError') && !JSON.stringify(parseFailure.payload).includes(' at '), 'Broken workbook response exposed server error details');

  console.log(JSON.stringify({
    standardTemplateImport: 'ok',
    importErrorReport: 'ok',
    parseFailureMessage: 'ok'
  }, null, 2));
} finally {
  await removeBatch(validBatchId);
  await removeBatch(invalidBatchId);
  await removeBatch(parseFailureBatchId);
  await closeServer();
  await pool.end();
}
