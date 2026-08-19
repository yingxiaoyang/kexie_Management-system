import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';

const templateDir = path.resolve('templates/import');
const outputPath = path.join(templateDir, '科研项目数据标准导入模板.xlsx');

const businessSheets = [
  { name: '1_项目', file: 'projects.csv', textFields: ['project_code'], enums: { approval_type: ['first', 'supplement'], status: ['draft', 'active', 'checking', 'completed', 'archived', 'stopped'] } },
  { name: '2_人员', file: 'people.csv', textFields: ['student_no', 'teacher_no', 'phone', 'qq'], enums: { person_type: ['student', 'teacher'], account_status: ['none', 'enabled', 'disabled'] } },
  { name: '3_参与关系', file: 'project_participations.csv', textFields: ['project_code', 'person_identifier'], enums: { person_type: ['student', 'teacher'], role: ['owner', 'member', 'advisor'], is_primary_owner: ['0', '1'] } },
  { name: '4_检查记录', file: 'project_checks.csv', textFields: ['project_code'], enums: { check_phase: ['midterm', 'stage'] } },
  { name: '5_报销记录', file: 'project_reimbursements.csv', textFields: ['project_code'], enums: {} }
];

const fieldDescriptions = {
  project_year: '项目所属年度；四位年份',
  project_group: '组别；可空',
  project_code: '项目编号；必填且唯一，按文本保存',
  title: '作品或项目名称；必填',
  category: '项目类别；可空',
  approval_date: '立项日期；YYYY-MM-DD',
  approval_type: '立项类型；first / supplement',
  status: '项目状态；draft / active / checking / completed / archived / stopped',
  person_type: '人员类型；student / teacher',
  name: '姓名；必填',
  student_no: '学号；学生必填且唯一，按文本保存',
  teacher_no: '工号；老师必填且唯一，按文本保存',
  college: '学院；可空',
  unit: '单位；可空',
  phone: '电话；按文本保存',
  qq: 'QQ；按文本保存',
  email: '邮箱；可空',
  account_status: '账号状态；none / enabled / disabled',
  person_identifier: '人员编号；学生填学号，老师填工号，按文本保存',
  role: '项目身份；owner / member / advisor',
  is_primary_owner: '是否主要负责人；主要负责人填 1，其他填 0',
  joined_at: '加入日期；YYYY-MM-DD，可空',
  check_phase: '检查阶段；midterm / stage',
  research_log_count: '研究日志数量；非负整数',
  rating: '评级；按原始记录填写',
  checked_at: '检查日期；YYYY-MM-DD',
  budget_amount: '报销额度；数字，最多两位小数',
  midterm_claim_amount: '中期申报金额；数字，最多两位小数',
  midterm_actual_amount: '中期实际金额；数字，最多两位小数',
  stage_claim_amount: '阶段申报金额；数字，最多两位小数',
  stage_actual_amount: '阶段实际金额；数字，最多两位小数',
  remaining_amount: '剩余额度；数字，最多两位小数',
  remark: '备注；可空'
};
const fieldLabels = {
  project_year: '项目所属年度',
  project_group: '组别',
  project_code: '项目编号',
  title: '作品名称',
  category: '项目类别',
  approval_date: '立项日期',
  approval_type: '立项类型',
  status: '项目状态',
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
  remark: '备注'
};
const fieldByLabel = new Map(Object.entries(fieldLabels).map(([field, label]) => [label, field]));

function parseCsv(text) {
  return text.replace(/^\uFEFF/, '').trimEnd().split(/\r?\n/).map((line) => line.split(','));
}

function styleHeader(row) {
  row.font = { bold: true };
  row.alignment = { vertical: 'middle', wrapText: true };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF2F8' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFB7C9D6' } } };
  });
}

function applyColumnStyles(worksheet, headers, definition) {
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = { from: 'A1', to: worksheet.getRow(1).getCell(headers.length).address };
  headers.forEach((header, index) => {
    const fieldName = Object.entries(fieldLabels).find(([, label]) => label === header)?.[0] || header;
    const column = worksheet.getColumn(index + 1);
    column.width = Math.min(42, Math.max(14, header.length + 8));
    if (definition.textFields.includes(fieldName)) column.numFmt = '@';
    if (definition.enums[fieldName]) {
      for (let rowNumber = 2; rowNumber <= 1000; rowNumber += 1) {
        worksheet.getCell(rowNumber, index + 1).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`"${definition.enums[fieldName].join(',')}"`]
        };
      }
    }
  });
}

async function addBusinessSheet(workbook, definition) {
  const csv = parseCsv(await fs.readFile(path.join(templateDir, definition.file), 'utf8'));
  const originalHeaders = csv[0].map((header) => fieldByLabel.get(header) || header);
  const headers = originalHeaders.map((header) => fieldLabels[header] || header);
  const worksheet = workbook.addWorksheet(definition.name);
  worksheet.addRow(headers);
  csv.slice(1).forEach((row) => worksheet.addRow(row));
  styleHeader(worksheet.getRow(1));
  applyColumnStyles(worksheet, headers, definition);
  for (const row of worksheet.getRows(2, worksheet.rowCount - 1) || []) {
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      if (definition.textFields.includes(originalHeaders[columnNumber - 1])) cell.numFmt = '@';
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
  }
}

function addInstructionSheet(workbook) {
  const worksheet = workbook.addWorksheet('导入说明');
  const lines = [
    ['科研项目数据标准导入模板'],
    ['请从第 2 行开始填写数据，第 1 行字段名不要改名、删除或调整含义。'],
    ['学号、工号、项目编号、电话、QQ 必须按文本保存，避免前导零丢失或科学计数法。'],
    ['日期统一使用 YYYY-MM-DD；金额只填写数字，最多两位小数。'],
    ['枚举字段使用下拉列表中的代码值，不填写近义词。'],
    ['工作簿中的 5 张业务表为：1_项目、2_人员、3_参与关系、4_检查记录、5_报销记录。'],
    ['导入说明和字段字典仅供查看，不作为业务数据导入。']
  ];
  lines.forEach((line) => worksheet.addRow(line));
  worksheet.getColumn(1).width = 96;
  worksheet.getRow(1).font = { bold: true, size: 14 };
  worksheet.eachRow((row) => row.eachCell((cell) => {
    cell.alignment = { vertical: 'middle', wrapText: true };
  }));
}

function addDictionarySheet(workbook) {
  const worksheet = workbook.addWorksheet('字段字典');
  worksheet.addRow(['字段名', '模板表头', '说明']);
  for (const [field, description] of Object.entries(fieldDescriptions)) worksheet.addRow([field, fieldLabels[field] || field, description]);
  styleHeader(worksheet.getRow(1));
  worksheet.getColumn(1).width = 28;
  worksheet.getColumn(2).width = 24;
  worksheet.getColumn(3).width = 72;
  worksheet.eachRow((row) => row.eachCell((cell) => {
    cell.alignment = { vertical: 'middle', wrapText: true };
  }));
}

const workbook = new ExcelJS.Workbook();
workbook.creator = 'kexie-server';
workbook.created = new Date();
addInstructionSheet(workbook);
for (const definition of businessSheets) await addBusinessSheet(workbook, definition);
addDictionarySheet(workbook);
await workbook.xlsx.writeFile(outputPath);
console.log(outputPath);
