import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'node:url';
import { executeMigrationSql } from '../src/utils/migrationSql.js';
import {
  assertProjectOwnerCandidateQualified,
  loadProjectChangeSnapshot,
  reviewProjectChangeSubmission
} from '../src/services/projectChangeService.js';
import { loadProjectWorkspace } from '../src/services/projectWorkspaceService.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const databaseName = String(process.env.PROJECT_CHANGE_VERIFY_DB || '');
if (!/^kexie_verify_change_[a-z0-9_]{8,40}$/.test(databaseName)) throw new Error('PROJECT_CHANGE_VERIFY_DB must be a unique temporary database name');
const config = { host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', multipleStatements: true };
let admin, db, created = false;

try {
  admin = await mysql.createConnection(config);
  const [existing] = await admin.execute('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [databaseName]);
  if (existing.length) throw new Error(`Refusing to reuse ${databaseName}`);
  await admin.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`); created = true;
  db = await mysql.createConnection({ ...config, database: databaseName });
  for (const name of (await fs.readdir(path.join(projectRoot, 'database/migrations'))).filter((n) => /^\d+_.+\.sql$/.test(n)).sort()) {
    await executeMigrationSql(db, await fs.readFile(path.join(projectRoot, 'database/migrations', name), 'utf8'));
  }
  const hash = '$2a$04$abcdefghijklmnopqrstuuuuuuuuuuuuuuuuuuuuuuuuuuuuu';
  const [superUser] = await db.execute("INSERT INTO users (username,display_name,password_hash,role,admin_level,status,password_reset_required) VALUES ('change_super','变更审核员',?,'admin','super','enabled',0)", [hash]);
  const superAdmin = { id: Number(superUser.insertId), role: 'admin', adminLevel: 'super', displayName: '变更审核员' };
  const createStudent = async (no, name, withAccount = true, role = 'applicant') => {
    const [person] = await db.execute("INSERT INTO people (person_type,name,student_no,account_status) VALUES ('student',?,?,'enabled')", [name, no]);
    let userId = null;
    if (withAccount) userId = Number((await db.execute('INSERT INTO users (username,display_name,password_hash,role,status,person_id,password_reset_required) VALUES (?,?,?, ?,\'enabled\',?,0)', [no, name, hash, role, person.insertId]))[0].insertId);
    return { personId: Number(person.insertId), userId };
  };
  const createTeacher = async (no, name) => Number((await db.execute("INSERT INTO people (person_type,name,teacher_no,account_status) VALUES ('teacher',?,?,'none')", [name, no]))[0].insertId);
  const oldOwner = await createStudent('CHG-OLD-01', '原负责人', true, 'project_owner');
  const newOwner = await createStudent('CHG-NEW-01', '新负责人', true, 'applicant');
  const removedMember = await createStudent('CHG-MEM-OLD', '待移除成员', false);
  const addedMember = await createStudent('CHG-MEM-NEW', '待新增成员', false);
  const unregistered = await createStudent('CHG-NO-ACCOUNT', '未注册候选人', false);
  const oldAdvisor = await createTeacher('T-OLD', '原导师');
  const newAdvisor = await createTeacher('T-NEW', '新导师');
  const [project] = await db.execute("INSERT INTO projects (project_year,project_code,title,status) VALUES (2026,'CHANGE-001','项目变更集成验证','active')");
  const projectId = Number(project.insertId);
  await db.execute("INSERT INTO project_participations (project_id,person_id,role,is_primary_owner) VALUES (?,?,'owner',1),(?,?,'member',0),(?,?,'advisor',0)", [projectId, oldOwner.personId, projectId, removedMember.personId, projectId, oldAdvisor]);
  const [task] = await db.execute("INSERT INTO material_tasks (task_name,task_type,change_phase,change_scope,project_scope_type,status,created_by) VALUES ('阶段检查项目变更','project_change','stage',JSON_OBJECT('members',true,'advisors',true,'owner',true),'all','published',?)", [superAdmin.id]);
  const taskId = Number(task.insertId);
  const [category] = await db.execute("INSERT INTO material_categories (material_task_id,category_name,allowed_extensions,is_required) VALUES (?,'变更证明',JSON_ARRAY('pdf'),1)", [taskId]);
  const plan = { members: { addPersonIds: [addedMember.personId], removePersonIds: [removedMember.personId] }, advisors: { addPersonIds: [newAdvisor], removePersonIds: [oldAdvisor] }, ownerChange: { newOwnerPersonId: newOwner.personId, previousOwnerDisposition: 'member' } };
  const before = await loadProjectChangeSnapshot(db, projectId);
  const [submission] = await db.execute("INSERT INTO material_submissions (material_task_id,project_id,material_category_id,submitter_user_id,submission_status,review_status,submitted_at,assigned_to,assignment_version) VALUES (?,?,?,?,'submitted','pending',NOW(),?,1)", [taskId, projectId, category.insertId, oldOwner.userId, superAdmin.id]);
  const [request] = await db.execute("INSERT INTO project_change_requests (material_task_id,project_id,initiated_by,status,current_version,proposed_changes,latest_submission_id,submitted_at) VALUES (?,?,?,'submitted',1,CAST(? AS JSON),?,NOW())", [taskId, projectId, oldOwner.userId, JSON.stringify(plan), submission.insertId]);
  await db.execute('INSERT INTO project_change_versions (change_request_id,version_no,material_submission_id,before_snapshot,proposed_changes,submitted_by) VALUES (?,1,?,CAST(? AS JSON),CAST(? AS JSON),?)', [request.insertId, submission.insertId, JSON.stringify(before), JSON.stringify(plan), oldOwner.userId]);

  const [[pendingOwner]] = await db.execute("SELECT person_id AS personId FROM project_participations WHERE project_id=? AND role='owner' AND deleted_at IS NULL", [projectId]);
  assert.equal(Number(pendingOwner.personId), oldOwner.personId, '待审期间原负责人权限必须不变');
  await assert.rejects(() => assertProjectOwnerCandidateQualified(db, unregistered.personId, projectId), (error) => error.code === 'PROJECT_OWNER_REGISTRATION_REQUIRED');
  await db.beginTransaction();
  await db.execute("UPDATE material_submissions SET review_status='approved',reviewed_by=?,reviewed_at=NOW() WHERE id=?", [superAdmin.id, submission.insertId]);
  const applied = await reviewProjectChangeSubmission(db, { submissionId: Number(submission.insertId), action: 'approve', reason: '', reviewer: superAdmin, expectedAssignmentVersion: 1 });
  await db.commit();
  assert.equal(applied.effective, true);
  const [relations] = await db.execute('SELECT person_id AS personId,role FROM project_participations WHERE project_id=? AND deleted_at IS NULL ORDER BY role,person_id', [projectId]);
  assert.equal(relations.filter((r) => r.role === 'owner').length, 1);
  assert(relations.some((r) => Number(r.personId) === newOwner.personId && r.role === 'owner'));
  assert(relations.some((r) => Number(r.personId) === oldOwner.personId && r.role === 'member'));
  assert(!relations.some((r) => Number(r.personId) === removedMember.personId));
  assert(relations.some((r) => Number(r.personId) === addedMember.personId && r.role === 'member'));
  assert(relations.some((r) => Number(r.personId) === newAdvisor && r.role === 'advisor'));
  const [[oldAccount], [newAccount]] = await Promise.all([
    db.execute('SELECT role,token_version AS tokenVersion FROM users WHERE id=?', [oldOwner.userId]).then(([rows]) => rows),
    db.execute('SELECT role,token_version AS tokenVersion FROM users WHERE id=?', [newOwner.userId]).then(([rows]) => rows)
  ]);
  assert.equal(oldAccount.role, 'applicant'); assert.equal(newAccount.role, 'project_owner');
  assert(Number(oldAccount.tokenVersion) > 0 && Number(newAccount.tokenVersion) > 0);
  await assert.rejects(() => reviewProjectChangeSubmission(db, { submissionId: Number(submission.insertId), action: 'approve', reason: '', reviewer: superAdmin, expectedAssignmentVersion: 1 }), (error) => error.code === 'PROJECT_CHANGE_STALE_VERSION');
  const workspace = await loadProjectWorkspace(db, projectId, superAdmin);
  assert(workspace.timeline.some((event) => event.eventType === 'project_change_approved'));
  await assert.rejects(() => db.execute('UPDATE project_change_versions SET version_no=2 WHERE change_request_id=?', [request.insertId]), /immutable/);
  await assert.rejects(() => db.execute('DELETE FROM project_change_audit_events WHERE change_request_id=?', [request.insertId]), /immutable/);

  // 退回不生效；重提创建新材料版本，旧版本不可审批；通过后覆盖“原负责人退出”。
  const returnOld = await createStudent('CHG-RETURN-OLD', '退回场景原负责人', true, 'project_owner');
  const returnNew = await createStudent('CHG-RETURN-NEW', '退回场景新负责人', true, 'applicant');
  const [returnProject] = await db.execute("INSERT INTO projects (project_year,project_code,title,status) VALUES (2026,'CHANGE-RETURN','退回重提验证','active')");
  const returnProjectId = Number(returnProject.insertId);
  await db.execute("INSERT INTO project_participations (project_id,person_id,role,is_primary_owner) VALUES (?,?,'owner',1)", [returnProjectId, returnOld.personId]);
  const exitPlan = { members: { addPersonIds: [], removePersonIds: [] }, advisors: { addPersonIds: [], removePersonIds: [] }, ownerChange: { newOwnerPersonId: returnNew.personId, previousOwnerDisposition: 'exit' } };
  const returnBefore = await loadProjectChangeSnapshot(db, returnProjectId);
  const [returnSubmission1] = await db.execute("INSERT INTO material_submissions (material_task_id,project_id,material_category_id,submitter_user_id,submission_status,review_status,submitted_at,assigned_to,assignment_version) VALUES (?,?,?,?,'submitted','pending',NOW(),?,1)", [taskId, returnProjectId, category.insertId, returnOld.userId, superAdmin.id]);
  const [returnRequest] = await db.execute("INSERT INTO project_change_requests (material_task_id,project_id,initiated_by,status,current_version,proposed_changes,latest_submission_id,submitted_at) VALUES (?,?,?,'submitted',1,CAST(? AS JSON),?,NOW())", [taskId, returnProjectId, returnOld.userId, JSON.stringify(exitPlan), returnSubmission1.insertId]);
  await db.execute('INSERT INTO project_change_versions (change_request_id,version_no,material_submission_id,before_snapshot,proposed_changes,submitted_by) VALUES (?,1,?,CAST(? AS JSON),CAST(? AS JSON),?)', [returnRequest.insertId, returnSubmission1.insertId, JSON.stringify(returnBefore), JSON.stringify(exitPlan), returnOld.userId]);
  await db.beginTransaction();
  await db.execute("UPDATE material_submissions SET review_status='returned',submission_status='returned',reviewed_by=?,reviewed_at=NOW() WHERE id=?", [superAdmin.id, returnSubmission1.insertId]);
  await reviewProjectChangeSubmission(db, { submissionId: Number(returnSubmission1.insertId), action: 'return', reason: '依据不完整', reviewer: superAdmin, expectedAssignmentVersion: 1 });
  await db.commit();
  const [[ownerAfterReturn]] = await db.execute("SELECT person_id AS personId FROM project_participations WHERE project_id=? AND role='owner' AND deleted_at IS NULL", [returnProjectId]);
  const [[oldRoleAfterReturn]] = await db.execute('SELECT role FROM users WHERE id=?', [returnOld.userId]);
  assert.equal(Number(ownerAfterReturn.personId), returnOld.personId); assert.equal(oldRoleAfterReturn.role, 'project_owner');
  const [returnSubmission2] = await db.execute("INSERT INTO material_submissions (material_task_id,project_id,material_category_id,submitter_user_id,submission_status,review_status,submitted_at,assigned_to,assignment_version) VALUES (?,?,?,?,'submitted','pending',NOW(),?,1)", [taskId, returnProjectId, category.insertId, returnOld.userId, superAdmin.id]);
  await db.execute('INSERT INTO project_change_versions (change_request_id,version_no,material_submission_id,before_snapshot,proposed_changes,submitted_by) VALUES (?,2,?,CAST(? AS JSON),CAST(? AS JSON),?)', [returnRequest.insertId, returnSubmission2.insertId, JSON.stringify(returnBefore), JSON.stringify(exitPlan), returnOld.userId]);
  await db.execute("UPDATE project_change_requests SET status='submitted',current_version=2,latest_submission_id=?,return_reason=NULL WHERE id=?", [returnSubmission2.insertId, returnRequest.insertId]);
  await assert.rejects(() => reviewProjectChangeSubmission(db, { submissionId: Number(returnSubmission1.insertId), action: 'approve', reason: '', reviewer: superAdmin, expectedAssignmentVersion: 1 }), (error) => error.code === 'PROJECT_CHANGE_VERSION_MISMATCH');
  await db.beginTransaction();
  await db.execute("UPDATE material_submissions SET review_status='approved',reviewed_by=?,reviewed_at=NOW() WHERE id=?", [superAdmin.id, returnSubmission2.insertId]);
  await reviewProjectChangeSubmission(db, { submissionId: Number(returnSubmission2.insertId), action: 'approve', reason: '', reviewer: superAdmin, expectedAssignmentVersion: 1 });
  await db.commit();
  const [exitRelations] = await db.execute('SELECT person_id AS personId,role FROM project_participations WHERE project_id=? AND deleted_at IS NULL', [returnProjectId]);
  assert(exitRelations.some((row) => Number(row.personId) === returnNew.personId && row.role === 'owner'));
  assert(!exitRelations.some((row) => Number(row.personId) === returnOld.personId), '退出场景不得把原负责人转为成员');
  const [[returnOldAccount]] = await db.execute('SELECT role FROM users WHERE id=?', [returnOld.userId]);
  assert.equal(returnOldAccount.role, 'applicant');

  const conflictOwner = await createStudent('CHG-CONFLICT', '冲突候选人', true, 'project_owner');
  const [otherProject] = await db.execute("INSERT INTO projects (project_year,project_code,title,status) VALUES (2026,'CHANGE-OTHER','负责人冲突项目','active')");
  await db.execute("INSERT INTO project_participations (project_id,person_id,role,is_primary_owner) VALUES (?,?,'owner',1)", [otherProject.insertId, conflictOwner.personId]);
  await assert.rejects(() => assertProjectOwnerCandidateQualified(db, conflictOwner.personId, projectId), (error) => error.code === 'PROJECT_OWNER_CONFLICT');
  process.stdout.write('Project change DB integration checks passed: member/advisor changes, owner member/exit transfer, account conversion, pending access, return/resubmit, stale/duplicate approval, candidate conflicts, timeline and immutable audit.\n');
} finally {
  await db?.end().catch(() => undefined);
  if (admin && created) await admin.query(`DROP DATABASE \`${databaseName}\``);
  await admin?.end().catch(() => undefined);
  if (created) process.stdout.write(`Removed temporary database ${databaseName}.\n`);
}
