import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  REPORT_FIELDS,
  normalizeReportDesignConfig,
  reportPreviewGrid,
  reportWorkbookBuffer
} from '../src/utils/reportDesign.js';

function baseConfig(cell, repeatRegions = []) {
  return {
    version: 1,
    sheet: { rowCount: 2, columnCount: 2, rows: [], columns: [] },
    cells: [cell],
    merges: [],
    repeatRegions,
    export: { layout: 'continuous', gapRows: 1, sheetNameRule: '{项目编号}' }
  };
}

const fieldTokens = new Set(REPORT_FIELDS.map((field) => field.token));
assert.equal(fieldTokens.size, REPORT_FIELDS.length, 'Every report field token must be unique');
assert.ok(fieldTokens.has('{负责人.姓名}'));
assert.ok(fieldTokens.has('{项目成员.姓名}'));
assert.ok(fieldTokens.has('{指导教师.姓名}'));

const legacy = normalizeReportDesignConfig(baseConfig({
  row: 1,
  col: 1,
  fieldKey: 'members.name',
  fieldMode: 'summary',
  itemTemplate: '{姓名}（{学号}）'
}));
assert.equal(legacy.version, 2);
assert.equal(legacy.cells[0].itemTemplate, '{项目成员.姓名}（{项目成员.学号}）');
assert.equal(legacy.validationIssues, undefined);

const rawProject = {
  projectYear: 2026,
  projectGroup: '测试组',
  projectCode: 'RPT-TEST',
  title: '字段 token 测试',
  owners: [{ name: '负责人甲' }],
  members: [
    { name: '成员甲', studentNo: 'S001' },
    { name: '成员乙', studentNo: 'S002' }
  ],
  advisors: [],
  checks: [],
  materials: []
};
const preview = reportPreviewGrid(legacy, rawProject);
assert.equal(preview[0].cells[0], '成员甲（S001）、成员乙（S002）');

const workbookBuffer = await reportWorkbookBuffer(legacy, [rawProject]);
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(workbookBuffer);
assert.equal(workbook.worksheets[0].getCell(1, 1).value, preview[0].cells[0]);

assert.throws(() => normalizeReportDesignConfig(baseConfig({
  row: 1,
  col: 1,
  fieldKey: 'members.name',
  fieldMode: 'summary',
  itemTemplate: '{项目成员.姓名}（{指导教师.工号}）'
})), /不能混用 \{指导教师\.工号\}/);

assert.throws(() => normalizeReportDesignConfig(baseConfig({
  row: 1,
  col: 1,
  fieldKey: 'members.name',
  fieldMode: 'summary',
  itemTemplate: '{项目成员.不存在}'
})), /无效占位符/);

assert.throws(() => normalizeReportDesignConfig(baseConfig({
  row: 1,
  col: 1,
  fieldKey: 'advisors.name',
  fieldMode: 'single'
}, [{ id: 'members', type: 'members', startRow: 1, endRow: 1, emptyMode: 'noneText' }])), /位于“项目成员”重复区域/);

const pendingRepair = normalizeReportDesignConfig(baseConfig({
  row: 1,
  col: 1,
  fieldKey: 'legacy.unknown',
  fieldMode: 'summary',
  itemTemplate: '{姓名}'
}), { allowInvalid: true });
assert.ok(pendingRepair.validationIssues.some((issue) => issue.includes('无法确定来源')));
assert.throws(() => normalizeReportDesignConfig(pendingRepair), /待修复/);

console.log('Report design token, compatibility, validation, preview and Excel checks passed');
