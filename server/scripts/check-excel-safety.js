import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { EXCEL_LIMITS, readWorkbook, worksheetRows, xlsxBuffer } from '../src/utils/excel.js';

const templatePath = path.resolve('templates/import/科研项目数据标准导入模板.xlsx');
const expectedSheets = ['1_项目', '2_人员', '3_参与关系', '4_检查记录', '5_报销记录'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function workbookBuffer(workbook) {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function checkStandardTemplate() {
  const buffer = await fs.readFile(templatePath);
  assert(buffer.length <= EXCEL_LIMITS.maxFileBytes, 'Standard import template exceeds the Excel file size limit');
  const workbook = await readWorkbook(buffer);
  for (const sheetName of expectedSheets) {
    const rows = worksheetRows(workbook, sheetName);
    assert(Array.isArray(rows), `Standard import template is missing sheet ${sheetName}`);
  }
}

async function checkTextImportValues() {
  const workbook = new ExcelJS.Workbook();
  const projectSheet = workbook.addWorksheet('1_项目');
  projectSheet.addRow(['project_year', 'project_group', 'project_code', 'title', 'category', 'approval_date', 'approval_type', 'status', 'remark']);
  projectSheet.addRow(['2026', '创新组', '001-A-文本', '中文项目', '科创', '2026-08-06', 'first', 'active', '']);

  const peopleSheet = workbook.addWorksheet('2_人员');
  peopleSheet.addRow(['person_type', 'name', 'student_no', 'teacher_no', 'college', 'unit', 'phone', 'qq', 'email', 'title', 'account_status', 'remark']);
  peopleSheet.addRow(['student', '张三', '00012345', '', '计算机学院', '', '013800000000', '00112233', 'zhangsan@example.test', '', 'none', '中文备注']);

  for (const sheetName of ['3_参与关系', '4_检查记录', '5_报销记录']) {
    workbook.addWorksheet(sheetName).addRow(['project_code']);
  }

  const parsed = await readWorkbook(await workbookBuffer(workbook));
  const projectRows = worksheetRows(parsed, '1_项目');
  const peopleRows = worksheetRows(parsed, '2_人员');
  assert(projectRows[0].project_code === '001-A-文本', 'Project code was not imported as text');
  assert(peopleRows[0].student_no === '00012345', 'Student number was not imported as text');
  assert(peopleRows[0].phone === '013800000000', 'Phone number was not imported as text');
  assert(peopleRows[0].qq === '00112233', 'QQ number was not imported as text');
  assert(peopleRows[0].remark === '中文备注', 'Chinese import content was not preserved');
}

async function checkWorkbookLimits() {
  const workbook = new ExcelJS.Workbook();
  for (let index = 1; index <= EXCEL_LIMITS.maxWorksheets + 1; index += 1) {
    workbook.addWorksheet(`sheet${index}`).addRow(['value']);
  }
  let rejected = false;
  try {
    await readWorkbook(await workbookBuffer(workbook));
  } catch (error) {
    rejected = error?.code === 'VALIDATION_ERROR';
  }
  assert(rejected, 'Workbook worksheet count limit was not enforced');
}

async function checkReportExports() {
  const materialList = await xlsxBuffer(
    ['项目编号', '负责人电话', '材料类别', '原文件名'],
    [['001-A-文本', '013800000000', '结题报告', '中文材料.docx']],
    '导出材料清单'
  );
  const missingReport = await xlsxBuffer(
    ['项目编号', '负责人电话', '缺失原因'],
    [['001-A-文本', '013800000000', '未提交：没有任何提交记录']],
    '缺失材料报告'
  );

  for (const [name, buffer] of [['导出材料清单', materialList], ['缺失材料报告', missingReport]]) {
    assert(buffer.subarray(0, 4).toString('hex').startsWith('504b'), `${name} is not a valid XLSX file`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet(name);
    assert(worksheet, `${name} worksheet is missing`);
    assert(worksheet.getCell('A2').value === '001-A-文本', `${name} project code was not preserved`);
    assert(worksheet.getCell('B2').value === '013800000000', `${name} phone was not preserved as text`);
    assert(worksheet.getCell('B2').numFmt === '@', `${name} phone column is not formatted as text`);
  }
}

await checkStandardTemplate();
await checkTextImportValues();
await checkWorkbookLimits();
await checkReportExports();

console.log(JSON.stringify({
  standardTemplate: 'ok',
  textImportValues: 'ok',
  workbookLimits: 'ok',
  reportExports: 'ok'
}, null, 2));
