import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProjectTimeline } from '../src/services/projectWorkspaceService.js';
import { contentDisposition, filePreviewInfo, inspectOriginalFileName, matchesPreviewSignature, normalizeUploadedFileName } from '../src/utils/fileNames.js';
import { sanitizeZipSegment, uniqueZipEntryName } from '../src/utils/materialReview.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const projectRoot = path.resolve(serverRoot, '..');
const read = (relative) => fs.readFileSync(path.join(projectRoot, relative), 'utf8');

const garbled = Buffer.from('中文材料.pdf', 'utf8').toString('latin1');
const repaired = inspectOriginalFileName(garbled);
assert.equal(repaired.displayName, '中文材料.pdf');
assert.equal(repaired.recovered, true);
assert.equal(normalizeUploadedFileName(garbled), '中文材料.pdf');
assert.equal(inspectOriginalFileName('中文材料.pdf').displayName, '中文材料.pdf');
const uncertain = inspectOriginalFileName('历史�材料.pdf');
assert.equal(uncertain.displayName, '历史�材料.pdf');
assert.match(uncertain.warning, /无法可靠判断/);
assert.match(contentDisposition('attachment', '中文材料.pdf'), /filename\*=UTF-8''%E4%B8%AD%E6%96%87/);

assert.deepEqual(filePreviewInfo('图像.png', 'image/png').previewType, 'image');
assert.deepEqual(filePreviewInfo('报告.pdf', 'application/pdf').previewType, 'pdf');
assert.equal(filePreviewInfo('报告.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document').previewable, false);
assert.equal(filePreviewInfo('伪装.pdf', 'text/html').previewable, false);
assert(matchesPreviewSignature(Buffer.from('%PDF-1.4'), 'application/pdf'));
assert(!matchesPreviewSignature(Buffer.from('<html>'), 'application/pdf'));

assert.equal(sanitizeZipSegment('../项目/../../危险'), '_项目_危险');
const used = new Set();
const first = uniqueZipEntryName('../项目/任务', '../中文.pdf', used);
const second = uniqueZipEntryName('../项目/任务', '../中文.pdf', used);
assert(!first.startsWith('/') && !first.includes('..') && !first.includes('\\'));
assert.notEqual(first.toLocaleLowerCase('zh-CN'), second.toLocaleLowerCase('zh-CN'));

const timeline = buildProjectTimeline({
  project: { id: 1 },
  submissions: [],
  materialReviewEvents: [
    { id: 1, submissionId: 10, eventType: 'assigned', actorName: '超级管理员', toAssigneeName: '审核员甲', taskName: '结项', categoryName: '报告', createdAt: '2026-08-19T10:00:00Z' },
    { id: 2, submissionId: 10, eventType: 'reassigned', actorName: '超级管理员', fromAssigneeName: '审核员甲', toAssigneeName: '审核员乙', reason: '工作调整', taskName: '结项', categoryName: '报告', createdAt: '2026-08-19T11:00:00Z' },
    { id: 3, submissionId: 10, eventType: 'returned', actorName: '审核员乙', reason: '缺少签章', taskName: '结项', categoryName: '报告', createdAt: '2026-08-19T12:00:00Z' }
  ]
});
assert(timeline.some((event) => event.eventType === 'material_review_assigned'));
assert(timeline.some((event) => event.eventType === 'material_review_reassigned'));
assert(timeline.some((event) => event.eventType === 'material_review_returned' && event.state === 'exception'));

const migration = read('database/migrations/014_material_review_assignment.sql');
const submissionsRoute = read('server/src/routes/submissions.js');
const uploadRoute = read('server/src/routes/uploads.js');
const taskRoute = read('server/src/routes/materialTasks.js');
assert.match(migration, /material_review_audit_events/);
assert.match(migration, /trg_material_review_audit_no_update/);
assert.match(migration, /trg_material_review_audit_no_delete/);
assert.match(submissionsRoute, /requireAdminPermission\('material_review'\)/);
assert.match(submissionsRoute, /req\.user\.adminLevel !== 'super'/);
assert.match(submissionsRoute, /FOR UPDATE/);
assert.match(submissionsRoute, /assignment_version = \?/);
assert.match(taskRoute, /requireAdminPermission\('material_task'\)/);
assert.match(uploadRoute, /requireAdminPermission\('material_task'\)/);

console.log(JSON.stringify({ verified: [
  '中文文件名上传规范化、旧乱码可靠修复与不确定提示',
  '图片/PDF 安全预览及 Office/伪装类型拒绝',
  'ZIP 中文目录、路径穿越清洗和同名防冲突',
  '分配/改派/退回审计进入项目时间轴',
  'material_review 与 material_task 路由权限保持分离',
  '审核事务行锁和分配版本条件更新'
] }, null, 2));
