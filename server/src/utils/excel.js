import ExcelJS from 'exceljs';
import { badRequest } from './errors.js';

export const EXCEL_LIMITS = {
  maxFileBytes: 20 * 1024 * 1024,
  maxWorksheets: 10,
  maxTotalRows: 50000,
  maxColumns: 80
};

const textLikeFields = new Set([
  'project_code',
  'student_no',
  'teacher_no',
  'person_identifier',
  'phone',
  'qq',
  '项目编号',
  '学号',
  '工号',
  '人员编号',
  '电话',
  'QQ'
]);

function dateText(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function plainNumberText(value) {
  if (!Number.isFinite(value)) return '';
  return Number.isInteger(value)
    ? value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 0 })
    : value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
}

function richText(value) {
  return Array.isArray(value?.richText) ? value.richText.map((item) => item.text || '').join('') : '';
}

export function cellText(cell, fieldName = '') {
  const value = cell?.value;
  if (value == null) return '';
  if (value instanceof Date) return dateText(value);
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') {
    const displayText = String(cell.text || '').trim();
    if (textLikeFields.has(fieldName) && displayText && !/[eE][+-]?\d+/.test(displayText)) return displayText;
    return plainNumberText(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') {
    if (value.result != null) return cellText({ ...cell, value: value.result, text: String(value.result ?? '') }, fieldName);
    if (value.text != null) return String(value.text).trim();
    const rich = richText(value);
    if (rich) return rich.trim();
  }
  return String(cell.text || '').trim();
}

function validateWorkbookLimits(workbook) {
  if (workbook.worksheets.length > EXCEL_LIMITS.maxWorksheets) {
    throw badRequest(`Excel 工作表数量不能超过 ${EXCEL_LIMITS.maxWorksheets} 张`, 'VALIDATION_ERROR');
  }
  let totalRows = 0;
  for (const worksheet of workbook.worksheets) {
    totalRows += Math.max(worksheet.actualRowCount || 0, worksheet.rowCount || 0);
    const columnCount = Math.max(worksheet.actualColumnCount || 0, worksheet.columnCount || 0);
    if (columnCount > EXCEL_LIMITS.maxColumns) {
      throw badRequest(`Excel 工作表列数不能超过 ${EXCEL_LIMITS.maxColumns} 列`, 'VALIDATION_ERROR');
    }
  }
  if (totalRows > EXCEL_LIMITS.maxTotalRows) {
    throw badRequest(`Excel 总行数不能超过 ${EXCEL_LIMITS.maxTotalRows} 行`, 'VALIDATION_ERROR');
  }
}

export async function readWorkbook(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > EXCEL_LIMITS.maxFileBytes) {
    throw badRequest('Excel 文件超过 20MB 限制', 'UPLOAD_FILE_SIZE_EXCEEDED');
  }
  if (buffer.length < 4 || buffer.subarray(0, 4).toString('hex') !== '504b0304') {
    throw badRequest('无法读取 Excel 工作簿', 'VALIDATION_ERROR');
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw badRequest('无法读取 Excel 工作簿', 'VALIDATION_ERROR');
  }
  if (!workbook.worksheets.length) {
    throw badRequest('无法读取 Excel 工作簿', 'VALIDATION_ERROR');
  }
  validateWorkbookLimits(workbook);
  return workbook;
}

export function worksheetRows(workbook, sheetName) {
  const worksheet = workbook.getWorksheet(sheetName);
  if (!worksheet) return null;
  const headerRow = worksheet.getRow(1);
  const headers = [];
  const columnCount = Math.min(Math.max(worksheet.columnCount || 0, headerRow.cellCount || 0), EXCEL_LIMITS.maxColumns);
  for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
    headers[columnIndex] = cellText(headerRow.getCell(columnIndex));
  }
  const rows = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const item = { __rowNumber: rowNumber };
    let hasValue = false;
    for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
      const header = headers[columnIndex];
      if (!header) continue;
      const value = cellText(row.getCell(columnIndex), header);
      item[header] = value;
      if (value) hasValue = true;
    }
    if (hasValue) rows.push(item);
  }
  return rows;
}

export async function xlsxBuffer(headers, rows, sheetName = '数据') {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'kexie-server';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet(String(sheetName || '数据').slice(0, 31));
  worksheet.addRow(headers);
  for (const row of rows) {
    worksheet.addRow(row.map((value) => (value == null ? '' : String(value))));
  }
  worksheet.eachRow((row, rowNumber) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.numFmt = '@';
      cell.alignment = { vertical: 'middle', wrapText: true };
      if (rowNumber === 1) cell.font = { bold: true };
    });
  });
  worksheet.columns = headers.map((_header, columnIndex) => ({
    width: Math.min(50, Math.max(12, ...[headers, ...rows].map((row) => String(row[columnIndex] ?? '').length + 2))),
    style: { numFmt: '@' }
  }));
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
