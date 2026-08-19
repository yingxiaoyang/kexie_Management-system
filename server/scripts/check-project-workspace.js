import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasAdminPermission } from '../src/utils/adminPermissions.js';
import {
  assertProjectWorkspaceAccess,
  buildProjectTimeline,
  participationSnapshot,
  projectFieldChanges
} from '../src/services/projectWorkspaceService.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const changes = projectFieldChanges(
  { projectYear: 2026, title: '旧名称', status: 'active', approvalDate: new Date('2026-01-02T00:00:00Z') },
  { projectYear: 2026, title: '新名称', status: 'checking', approvalDate: '2026-01-02' }
);
assert.deepEqual(changes, [
  { field: 'title', before: '旧名称', after: '新名称' },
  { field: 'status', before: 'active', after: 'checking' }
], '字段审计应精确记录前后值，且相同日期不应误报变化');

const beforeRelations = participationSnapshot([
  { id: 1, personId: 10, role: 'owner', name: '负责人' },
  { id: 2, personId: 11, role: 'member', name: '旧成员' }
]);
const afterRelations = participationSnapshot([
  { id: 1, personId: 10, role: 'owner', name: '负责人' },
  { id: 3, personId: 12, role: 'advisor', name: '新导师' }
]);
assert.notDeepEqual(beforeRelations, afterRelations, '成员/导师关系修改应形成可比较的前后快照');
assert.equal(beforeRelations.filter((row) => row.role === 'owner').length, 1, '关系快照必须保留唯一负责人');
assert.equal(afterRelations.filter((row) => row.role === 'owner').length, 1, '普通人员维护后仍必须保留唯一负责人');

const timeline = buildProjectTimeline({
  project: { id: 7, createdAt: '2026-01-01T00:00:00Z', approvalDate: '2026-01-02' },
  source: { batchName: '2026 首次立项', approvalRound: 'first', sourceType: 'application', sourceCreatedAt: '2026-01-03T00:00:00Z' },
  auditEvents: [{ id: 8, eventType: 'project_fields_changed', sourceModule: '项目管理', fieldChanges: changes, eventPayload: { summary: '修改项目字段' }, createdAt: '2026-02-01T00:00:00Z', actorName: '管理员' }],
  applicationEvents: [{ id: 9, eventType: 'application_returned', eventPayload: { reason: '补充材料' }, createdAt: '2026-01-04T00:00:00Z', actorName: '审核员' }],
  importEvents: [],
  submissions: [
    { id: 20, taskName: '结项材料', categoryName: '结项书', version: 1, reviewStatus: 'returned', returnReason: '签章缺失', submittedAt: '2026-03-01T00:00:00Z', reviewedAt: '2026-03-02T00:00:00Z', submitterName: '负责人', reviewerName: '审核员' },
    { id: 21, taskName: '结项材料', categoryName: '结项书', version: 2, reviewStatus: 'approved', submittedAt: '2026-03-03T00:00:00Z', reviewedAt: '2026-03-04T00:00:00Z', submitterName: '负责人', reviewerName: '审核员' }
  ]
});
for (const expected of ['application_approved', 'application_returned', 'project_fields_changed', 'material_submitted', 'material_returned', 'material_approved']) {
  assert(timeline.some((event) => event.eventType === expected), `时间轴缺少 ${expected}`);
}
assert(timeline.some((event) => event.eventType === 'material_submitted' && event.summary.includes('第 2 版')), '时间轴应包含材料全部版本');
assert(timeline.some((event) => event.legacyDerived && event.actor === null), '旧项目兼容节点不得伪造操作者');

assert.equal(hasAdminPermission({ role: 'admin', adminLevel: 'super', permissions: [] }, 'project_management'), true);
assert.equal(hasAdminPermission({ role: 'admin', adminLevel: 'limited', permissions: ['project_management'] }, 'project_management'), true);
assert.equal(hasAdminPermission({ role: 'admin', adminLevel: 'limited', permissions: [] }, 'project_management'), false, '无权限小管理员必须被拒绝');

const allowedOwnerConnection = { execute: async () => [[{ id: 7 }]] };
assert.equal(await assertProjectWorkspaceAccess(allowedOwnerConnection, 7, { role: 'project_owner', personId: 10 }), 7);
const deniedOwnerConnection = { execute: async () => [[]] };
await assert.rejects(
  () => assertProjectWorkspaceAccess(deniedOwnerConnection, 8, { role: 'project_owner', personId: 10 }),
  (error) => error.status === 404,
  '负责人查看他人项目必须被拒绝且不泄露项目存在性'
);

const routes = read('server/src/routes/projects.js');
assert.match(routes, /router\.get\('\/:id\/workspace', requireAuth, requireRole\('admin', 'project_owner'\), requirePermissionWhenAdmin\('project_management'\)/);
assert.match(routes, /router\.put\('\/:id', requireAuth, requireRole\('admin'\), requireAdminPermission\('project_management'\)/);
assert.match(routes, /router\.put\('\/:id\/participations', requireAuth, requireRole\('admin'\), requireAdminPermission\('project_management'\)/);
assert.match(routes, /PROJECT_OWNER_CHANGE_REQUIRES_APPROVAL/);
assert.doesNotMatch(routes.slice(routes.indexOf("router.put('/:id/participations'")), /role = 'owner'.*UPDATE/s, '成员维护接口不得更新负责人关系');

const migration011 = read('database/migrations/011_application_approval_loop.sql');
const migration013 = read('database/migrations/013_project_workspace_audit.sql');
assert.match(migration011, /uk_one_owner_per_project/);
assert.match(migration013, /project_audit_events/);
assert.match(migration013, /trg_project_audit_no_update/);
assert.match(migration013, /trg_project_audit_no_delete/);

console.log(JSON.stringify({ verified: [
  '管理员 project_management 权限边界与无权限小管理员拒绝',
  '负责人只可读取归属项目，无法调用管理员修改路由',
  '项目字段级前后值审计',
  '成员/导师关系前后快照与唯一负责人保留',
  '时间轴包含立项、材料多版本、审核退回/通过与项目变更',
  '旧项目兼容节点不伪造操作者',
  '013 项目审计不可变约束'
] }, null, 2));
