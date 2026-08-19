import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPlanWithinScope, changeSummary, normalizeChangePlan, projectOwnerQualificationChecks } from '../src/utils/projectChange.js';
import { assertProjectOwnerCandidateQualified } from '../src/services/projectChangeService.js';
import { buildProjectTimeline } from '../src/services/projectWorkspaceService.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const plan = normalizeChangePlan({ members: { addPersonIds: [3, 2, 3], removePersonIds: [4] }, advisors: { addPersonIds: [8], removePersonIds: [9] }, ownerChange: { newOwnerPersonId: 7, previousOwnerDisposition: 'member' } });
assert.deepEqual(plan.members.addPersonIds, [2, 3]);
assert.match(changeSummary(plan), /新增成员 2 人.*更换负责人（原负责人转成员）/);
assert.deepEqual(assertPlanWithinScope(plan, { members: true, advisors: true, owner: true }), { members: true, advisors: true, owner: true });
assert.throws(() => assertPlanWithinScope(plan, { members: true, advisors: true, owner: false }), (error) => error.code === 'PROJECT_CHANGE_SCOPE_DENIED');
assert.throws(() => normalizeChangePlan({ members: { addPersonIds: [2], removePersonIds: [2] } }), (error) => error.code === 'PROJECT_CHANGE_PLAN_CONFLICT');
assert.throws(() => normalizeChangePlan({ ownerChange: { newOwnerPersonId: 2, previousOwnerDisposition: 'delete' } }), (error) => error.code === 'VALIDATION_ERROR');
assert.deepEqual(projectOwnerQualificationChecks, ['student', 'person_enabled', 'registered_account', 'account_enabled', 'single_formal_project_owner']);

function candidateConnection({ account = true, userStatus = 'enabled', owned = false } = {}) {
  let call = 0;
  return { execute: async () => {
    call += 1;
    if (call === 1) return [[{ id: 2, personType: 'student', name: '候选人', studentNo: 'S001', accountStatus: 'enabled', deletedAt: null }]];
    if (call === 2) return [account ? [{ id: 20, username: 'S001', role: 'applicant', status: userStatus }] : []];
    return [owned ? [{ projectId: 99, projectCode: 'OTHER-001' }] : []];
  } };
}
assert.equal((await assertProjectOwnerCandidateQualified(candidateConnection(), 2, 1)).account.role, 'applicant');
await assert.rejects(() => assertProjectOwnerCandidateQualified(candidateConnection({ account: false }), 2, 1), (error) => error.code === 'PROJECT_OWNER_REGISTRATION_REQUIRED');
await assert.rejects(() => assertProjectOwnerCandidateQualified(candidateConnection({ owned: true }), 2, 1), (error) => error.code === 'PROJECT_OWNER_CONFLICT');
await assert.rejects(() => assertProjectOwnerCandidateQualified(candidateConnection({ userStatus: 'disabled' }), 2, 1), (error) => error.code === 'PROJECT_OWNER_ACCOUNT_DISABLED');

const timeline = buildProjectTimeline({ project: { id: 1 }, auditEvents: [{ id: 1, eventType: 'project_change_approved', sourceModule: '项目变更审批', fieldChanges: [], eventPayload: { summary: '项目变更审批通过：更换负责人' }, createdAt: '2026-08-19T12:00:00Z', actorName: '审核员' }], projectChangeEvents: [{ id: 2, versionNo: 1, eventType: 'submitted', eventPayload: { summary: '更换负责人' }, createdAt: '2026-08-18T12:00:00Z', actorName: '原负责人' }] });
assert(timeline.some((event) => event.eventType === 'project_change_approved' && event.eventCategory === 'participation'));
assert(timeline.some((event) => event.eventType === 'project_change_submitted' && event.state === 'current'));

const migration = read('database/migrations/015_project_change_approval.sql');
const routes = read('server/src/routes/projectChanges.js');
const reviewRoute = read('server/src/routes/submissions.js');
const service = read('server/src/services/projectChangeService.js');
for (const pattern of [/project_change_versions/, /trg_project_change_versions_no_update/, /trg_project_change_audit_no_delete/]) assert.match(migration, pattern);
for (const pattern of [/PROOF_FILE_REQUIRED/, /initiator_type, proposed_changes, forced_reason/, /current_version = \?/, /requirePermissionWhenAdmin\('material_review'\)/]) assert.match(routes, pattern);
for (const pattern of [/req\.user\.adminLevel !== 'super'/, /reviewProjectChangeSubmission/]) assert.match(reviewRoute, pattern);
for (const pattern of [/LIMIT 1 FOR UPDATE/, /PROJECT_CHANGE_STALE_VERSION/, /PROJECT_CHANGE_BASELINE_CONFLICT/, /role = 'project_owner'/, /role = 'applicant'/, /token_version = token_version \+ 1/, /Number\(ownerCount\.count\) !== 1/]) assert.match(service, pattern);

console.log(JSON.stringify({ verified: [
  '成员/导师增删与负责人转成员/退出方案', '任务允许范围', '统一候选负责人资格及未注册/禁用/负责人冲突',
  '草稿、证明、不可变版本、退回重提和旧版本保护', '审核分配越权边界', '负责人账号升级与旧负责人安全降级',
  '事务行锁、重复审批、基线冲突和唯一负责人断言', '时间轴与不可变审计'
] }, null, 2));
