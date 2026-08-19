import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import { pool } from '../src/db/pool.js';
import {
  processNextReportExport,
  validateAndEnqueueReportExport
} from '../src/services/reportExportService.js';
import { normalizeReportDesignConfig } from '../src/utils/reportDesign.js';

function unique(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertProject(projectCode, title, year, group) {
  const [result] = await pool.execute(
    `INSERT INTO projects (project_year, project_group, project_code, title, category, approval_date, approval_type, status, remark)
     VALUES (?, ?, ?, ?, '测试类别', '2026-03-01', 'first', 'active', '报表设计器自动验收')`,
    [year, group, projectCode, title]
  );
  return result.insertId;
}

async function insertPerson(personType, name, identifier) {
  const isTeacher = personType === 'teacher';
  const [result] = await pool.execute(
    `INSERT INTO people (person_type, name, student_no, teacher_no, college, unit, phone, qq, email, title, account_status, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', '报表设计器自动验收')`,
    [
      personType,
      name,
      isTeacher ? null : identifier,
      isTeacher ? identifier : null,
      isTeacher ? null : '测试学院',
      isTeacher ? '测试单位' : null,
      `138${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`,
      isTeacher ? null : '10001',
      isTeacher ? `${identifier}@example.test` : null,
      isTeacher ? '教授' : null
    ]
  );
  return result.insertId;
}

async function addParticipation(projectId, personId, role, primary = false) {
  await pool.execute(
    `INSERT INTO project_participations (project_id, person_id, role, is_primary_owner, joined_at, remark)
     VALUES (?, ?, ?, ?, '2026-03-01', '报表设计器自动验收')`,
    [projectId, personId, role, primary ? 1 : 0]
  );
}

async function addCheck(projectId, phase, count, rating) {
  await pool.execute(
    `INSERT INTO project_check_records (project_id, check_phase, research_log_count, rating, checked_at, remark)
     VALUES (?, ?, ?, ?, '2026-07-01', '报表设计器自动验收')`,
    [projectId, phase, count, rating]
  );
}

async function addReimbursement(projectId) {
  await pool.execute(
    `INSERT INTO reimbursement_records
     (project_id, budget_amount, midterm_claim_amount, midterm_actual_amount, stage_claim_amount, stage_actual_amount, remaining_amount, remark)
     VALUES (?, 1000.00, 300.00, 260.00, 200.00, 180.00, 560.00, '报表设计器自动验收')`,
    [projectId]
  );
}

async function readWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return workbook;
}

function findRowByCell(worksheet, column, value) {
  let found = 0;
  worksheet.eachRow((row, rowNumber) => {
    if (String(row.getCell(column).value || '') === value && !found) found = rowNumber;
  });
  return found;
}

async function main() {
  const [[admin]] = await pool.execute(
    "SELECT id FROM users WHERE role = 'admin' AND status = 'enabled' AND deleted_at IS NULL ORDER BY id LIMIT 1"
  );
  if (!admin) throw new Error('Report designer check needs an enabled administrator account');

  const marker = unique('rpt');
  const group = `报表验收${Date.now()}`;
  const longIllegalTitle = '重复/非法:超长项目名称用于验证工作表名称截断与重名处理[]*?重复重复重复重复重复';
  const projectIds = [];
  const personIds = [];
  const exportIds = [];
  let designId;

  const designConfig = {
    version: 1,
    sheet: {
      rowCount: 12,
      columnCount: 6,
      rows: [{ index: 5, height: 24 }, { index: 6, height: 24 }],
      columns: [{ index: 1, width: 18 }, { index: 2, width: 18 }, { index: 3, width: 18 }]
    },
    cells: [
      { row: 1, col: 1, value: '项目编号', style: { bold: true, fill: 'EAF2FF', align: 'center', border: true } },
      { row: 1, col: 2, fieldKey: 'project.code', style: { border: true } },
      { row: 1, col: 3, value: '作品名称', style: { bold: true, fill: 'EAF2FF', align: 'center', border: true } },
      { row: 1, col: 4, fieldKey: 'project.title', style: { border: true } },
      { row: 2, col: 1, value: '负责人', style: { bold: true, border: true } },
      { row: 2, col: 2, fieldKey: 'owner.name', style: { border: true } },
      { row: 3, col: 1, value: '成员汇总', style: { bold: true, border: true } },
      { row: 3, col: 2, fieldKey: 'members.name', fieldMode: 'summary', itemTemplate: '{项目成员.姓名}（{项目成员.学号}）', itemSeparator: '；', style: { border: true } },
      { row: 3, col: 3, value: '成员换行', style: { bold: true, border: true } },
      { row: 3, col: 4, fieldKey: 'members.name', fieldMode: 'lines', style: { border: true, wrap: true } },
      { row: 4, col: 1, value: '重复成员', style: { bold: true, fill: 'F3F6FA', border: true } },
      { row: 5, col: 1, fieldKey: 'project.code', style: { border: true, align: 'center' } },
      { row: 5, col: 2, fieldKey: 'members.name', style: { border: true } },
      { row: 5, col: 3, fieldKey: 'members.studentNo', style: { border: true } },
      { row: 6, col: 2, fieldKey: 'members.phone', style: { border: true } },
      { row: 7, col: 1, value: '指导老师', style: { bold: true, fill: 'F3F6FA', border: true } },
      { row: 8, col: 1, fieldKey: 'advisors.name', style: { border: true } },
      { row: 8, col: 2, fieldKey: 'advisors.unit', style: { border: true } },
      { row: 9, col: 1, value: '检查记录', style: { bold: true, fill: 'F3F6FA', border: true } },
      { row: 10, col: 1, fieldKey: 'checks.phase', style: { border: true } },
      { row: 10, col: 2, fieldKey: 'checks.researchLogCount', style: { border: true } },
      { row: 10, col: 3, fieldKey: 'checks.rating', style: { border: true } },
      { row: 11, col: 1, value: '报销剩余', style: { bold: true, border: true } },
      { row: 11, col: 2, fieldKey: 'reimbursement.remainingAmount', style: { border: true } }
    ],
    merges: [{ startRow: 5, startCol: 1, endRow: 6, endCol: 1 }],
    repeatRegions: [
      { id: 'members', type: 'members', startRow: 5, endRow: 6, emptyMode: 'noneText' },
      { id: 'advisors', type: 'advisors', startRow: 8, endRow: 8, emptyMode: 'noneText' },
      { id: 'checks', type: 'checks', startRow: 10, endRow: 10, emptyMode: 'blank' }
    ],
    export: { layout: 'continuous', gapRows: 1, sheetNameRule: '{作品名称}' }
  };

  try {
    const p0 = await insertProject(`${marker}-P0`, '零成员项目', 2026, group);
    const p1 = await insertProject(`${marker}-P1`, longIllegalTitle, 2026, group);
    const p2 = await insertProject(`${marker}-P2`, longIllegalTitle, 2026, group);
    projectIds.push(p0, p1, p2);

    for (const [index, projectId] of projectIds.entries()) {
      const owner = await insertPerson('student', `负责人${index}`, `${marker}-O${index}`);
      personIds.push(owner);
      await addParticipation(projectId, owner, 'owner', true);
      await addReimbursement(projectId);
    }

    const member1 = await insertPerson('student', '单成员', `${marker}-M1`);
    personIds.push(member1);
    await addParticipation(p1, member1, 'member');

    for (let index = 1; index <= 2; index += 1) {
      const member = await insertPerson('student', `多成员${index}`, `${marker}-M2${index}`);
      personIds.push(member);
      await addParticipation(p2, member, 'member');
    }

    const advisor1 = await insertPerson('teacher', '单导师', `${marker}-T1`);
    personIds.push(advisor1);
    await addParticipation(p1, advisor1, 'advisor');
    for (let index = 1; index <= 2; index += 1) {
      const advisor = await insertPerson('teacher', `多导师${index}`, `${marker}-T2${index}`);
      personIds.push(advisor);
      await addParticipation(p2, advisor, 'advisor');
    }
    await addCheck(p2, 'midterm', 7, 'A');
    await addCheck(p2, 'stage', 9, 'B');

    const [designInsert] = await pool.execute(
      `INSERT INTO report_designs (design_name, design_config, status, created_by)
       VALUES ('报表设计器自动验收方案', ?, 'enabled', ?)`,
      [JSON.stringify(designConfig), admin.id]
    );
    designId = designInsert.insertId;
    const [[storedDesign]] = await pool.execute('SELECT design_config AS designConfig FROM report_designs WHERE id = ?', [designId]);
    const reopenedDesign = normalizeReportDesignConfig(storedDesign.designConfig);
    if (reopenedDesign.cells.find((cell) => cell.row === 3 && cell.col === 2)?.itemTemplate !== '{项目成员.姓名}（{项目成员.学号}）') {
      throw new Error('Saved report design did not reopen with canonical source-qualified tokens');
    }

    const continuous = await validateAndEnqueueReportExport({
      userId: admin.id,
      reportDesignId: designId,
      rawScope: { years: [2026], groups: [group], projectIds: [] },
      layout: 'continuous',
      remark: '报表设计器连续排列自动验收'
    });
    exportIds.push(continuous.id);
    await processNextReportExport('check-report-worker');
    const [[continuousRecord]] = await pool.execute(
      'SELECT export_status AS exportStatus, export_file_path AS exportFilePath FROM report_export_records WHERE id = ?',
      [continuous.id]
    );
    if (continuousRecord.exportStatus !== 'success') throw new Error('Continuous report export did not succeed');
    const continuousWorkbook = await readWorkbook(continuousRecord.exportFilePath);
    const sheet = continuousWorkbook.worksheets[0];
    const p0Row = findRowByCell(sheet, 2, `${marker}-P0`);
    const p1Row = findRowByCell(sheet, 2, `${marker}-P1`);
    const p2Row = findRowByCell(sheet, 2, `${marker}-P2`);
    if (!p0Row || !p1Row || !p2Row || !(p0Row < p1Row && p1Row < p2Row)) {
      throw new Error('Continuous report export did not place all projects in order');
    }
    const summaryCell = sheet.getRow(p2Row + 2).getCell(2).value;
    const lineCell = sheet.getRow(p2Row + 2).getCell(4).value;
    if (!String(summaryCell).includes(`多成员1（${marker}-M21）`) || !String(summaryCell).includes('；多成员2')) {
      throw new Error('Collection item template and separator were not rendered correctly');
    }
    if (!String(lineCell).includes('多成员1\n多成员2')) {
      throw new Error('Summary and newline field modes were not rendered correctly');
    }
    const firstMemberRow = findRowByCell(sheet, 2, '多成员1');
    if (!firstMemberRow || String(sheet.getRow(firstMemberRow).getCell(1).value) !== `${marker}-P2`) {
      throw new Error('Vertical repeated member rows were not rendered correctly');
    }
    if (!sheet.getRow(firstMemberRow).getCell(1).isMerged) {
      throw new Error('Project fixed field was not dynamically merged across the repeated member area');
    }
    const advisorRow = findRowByCell(sheet, 1, '多导师1');
    const checkRow = findRowByCell(sheet, 1, '中期检查');
    if (!advisorRow || !checkRow) {
      throw new Error('Advisor and check repeat regions were not expanded independently');
    }
    const noneRow = findRowByCell(sheet, 2, `${marker}-P0`);
    if (!noneRow || !String(sheet.getRow(noneRow + 4).getCell(2).value || '').includes('无')) {
      throw new Error('Empty member handling did not render the configured no-data value');
    }

    const sheets = await validateAndEnqueueReportExport({
      userId: admin.id,
      reportDesignId: null,
      designConfig,
      rawScope: { years: [2026], groups: [group], projectIds: [] },
      layout: 'sheets',
      remark: '报表设计器分工作表自动验收'
    });
    exportIds.push(sheets.id);
    await processNextReportExport('check-report-worker');
    const [[sheetsRecord]] = await pool.execute(
      'SELECT export_status AS exportStatus, export_file_path AS exportFilePath FROM report_export_records WHERE id = ?',
      [sheets.id]
    );
    if (sheetsRecord.exportStatus !== 'success') throw new Error('Sheet-per-project report export did not succeed');
    const sheetsWorkbook = await readWorkbook(sheetsRecord.exportFilePath);
    const sheetNames = sheetsWorkbook.worksheets.map((worksheet) => worksheet.name);
    if (sheetNames.length !== 3 || new Set(sheetNames).size !== 3) {
      throw new Error('Sheet-per-project export did not create unique worksheet names');
    }
    if (sheetNames.some((name) => name.length > 31 || /[:\\/?*\[\]]/.test(name))) {
      throw new Error('Worksheet name sanitizing did not handle length or illegal characters');
    }

    console.log(JSON.stringify({
      continuousExportId: continuous.id,
      sheetsExportId: sheets.id,
      worksheetNames: sheetNames
    }, null, 2));
  } finally {
    for (const exportId of exportIds) {
      const [[record]] = await pool.execute('SELECT export_file_path AS exportFilePath FROM report_export_records WHERE id = ?', [exportId]);
      if (record?.exportFilePath) await fs.unlink(record.exportFilePath).catch(() => undefined);
      await pool.execute('DELETE FROM report_export_records WHERE id = ?', [exportId]);
    }
    if (designId) await pool.execute('DELETE FROM report_designs WHERE id = ?', [designId]);
    if (projectIds.length) {
      await pool.execute(`DELETE FROM reimbursement_records WHERE project_id IN (${projectIds.map(() => '?').join(',')})`, projectIds);
      await pool.execute(`DELETE FROM project_check_records WHERE project_id IN (${projectIds.map(() => '?').join(',')})`, projectIds);
      await pool.execute(`DELETE FROM project_participations WHERE project_id IN (${projectIds.map(() => '?').join(',')})`, projectIds);
      await pool.execute(`DELETE FROM projects WHERE id IN (${projectIds.map(() => '?').join(',')})`, projectIds);
    }
    if (personIds.length) {
      await pool.execute(`DELETE FROM people WHERE id IN (${personIds.map(() => '?').join(',')})`, personIds);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
