import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

const password = 'WorkspaceFlow!123';
const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
let server;
let base;

async function api(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { response, payload: await response.json(), cookie: (response.headers.get('set-cookie') || '').split(';', 1)[0] };
}

async function expect(path, options, status, code = null) {
  const result = await api(path, options);
  assert.equal(result.response.status, status, `${path}: ${JSON.stringify(result.payload)}`);
  if (code) assert.equal(result.payload.code, code, path);
  return result;
}

async function person(type, name, identifier) {
  const column = type === 'student' ? 'student_no' : 'teacher_no';
  const [result] = await pool.execute(
    `INSERT INTO people (person_type, name, ${column}, ${type === 'student' ? 'college' : 'unit'}, account_status)
     VALUES (?, ?, ?, '工作台检查单位', 'enabled')`, [type, name, identifier]
  );
  return Number(result.insertId);
}

async function user(role, username, displayName, personId = null, withPermission = false) {
  const hash = await bcrypt.hash(password, 4);
  const [result] = await pool.execute(
    `INSERT INTO users (username, display_name, password_hash, role, admin_level, status, person_id, password_reset_required)
     VALUES (?, ?, ?, ?, ?, 'enabled', ?, 0)`, [username, displayName, hash, role, role === 'admin' ? 'limited' : null, personId]
  );
  const id = Number(result.insertId);
  if (withPermission) {
    await pool.execute(
      "INSERT INTO admin_user_permissions (user_id, permission_key, granted_by) VALUES (?, 'project_management', ?)", [id, id]
    );
  }
  return { id, username };
}

async function login(account) {
  const result = await expect('/auth/login', { method: 'POST', body: { username: account.username, password } }, 200, 'OK');
  return result.cookie;
}

async function main() {
  const ownerPersonA = await person('student', '负责人甲', `WSA${suffix}`);
  const ownerPersonB = await person('student', '负责人乙', `WSB${suffix}`);
  const memberPerson = await person('student', '项目成员', `WSM${suffix}`);
  const advisorPerson = await person('teacher', '指导教师', `WST${suffix}`);
  const admin = await user('admin', `ws_admin_${suffix}`, '项目管理员', null, true);
  const deniedAdmin = await user('admin', `ws_denied_${suffix}`, '无权限管理员');
  const ownerA = await user('project_owner', `ws_owner_a_${suffix}`, '负责人甲', ownerPersonA);
  const ownerB = await user('project_owner', `ws_owner_b_${suffix}`, '负责人乙', ownerPersonB);

  const [projectAResult] = await pool.execute(
    `INSERT INTO projects (project_year, project_group, project_code, title, category, approval_date, approval_type, status)
     VALUES (2026, '集成检查组', ?, '工作台旧名称', '创新类', '2026-01-10', 'first', 'active')`, [`WS-A-${suffix}`]
  );
  const [projectBResult] = await pool.execute(
    `INSERT INTO projects (project_year, project_code, title, approval_type, status)
     VALUES (2026, ?, '旧项目兼容检查', 'first', 'active')`, [`WS-B-${suffix}`]
  );
  const projectA = Number(projectAResult.insertId), projectB = Number(projectBResult.insertId);
  await pool.execute(
    `INSERT INTO project_participations (project_id, person_id, role, is_primary_owner)
     VALUES (?, ?, 'owner', 1), (?, ?, 'member', 0), (?, ?, 'owner', 1)`,
    [projectA, ownerPersonA, projectA, memberPerson, projectB, ownerPersonB]
  );
  const [task] = await pool.execute(
    `INSERT INTO material_tasks (task_name, project_scope_type, max_file_mb, max_task_project_mb, status, created_by)
     VALUES ('结项材料', 'all', 20, 200, 'published', ?)`, [admin.id]
  );
  const [category] = await pool.execute(
    `INSERT INTO material_categories (material_task_id, category_name, is_required, sort_order)
     VALUES (?, '结项书', 1, 0)`, [task.insertId]
  );
  const [submission1] = await pool.execute(
    `INSERT INTO material_submissions
     (material_task_id, project_id, material_category_id, submitter_user_id, submission_status, review_status, return_reason, submitted_at, reviewed_by, reviewed_at)
     VALUES (?, ?, ?, ?, 'returned', 'returned', '签章缺失', '2026-02-01 10:00:00', ?, '2026-02-02 10:00:00')`,
    [task.insertId, projectA, category.insertId, ownerA.id, admin.id]
  );
  await pool.execute(
    `INSERT INTO material_submissions
     (material_task_id, project_id, material_category_id, submitter_user_id, submission_status, review_status, submitted_at, reviewed_by, reviewed_at)
     VALUES (?, ?, ?, ?, 'submitted', 'approved', '2026-02-03 10:00:00', ?, '2026-02-04 10:00:00')`,
    [task.insertId, projectA, category.insertId, ownerA.id, admin.id]
  );
  await pool.execute(
    `INSERT INTO material_files (submission_id, original_name, storage_path, file_size, mime_type, uploaded_by)
     VALUES (?, '结项书-v1.pdf', 'integration/not-downloaded.pdf', 100, 'application/pdf', ?)`, [submission1.insertId, ownerA.id]
  );
  await pool.execute(
    `INSERT INTO application_audit_events (event_type, actor_user_id, project_id, event_payload)
     VALUES ('school_approved_and_project_created', ?, ?, JSON_OBJECT('schoolResult', 'approved'))`, [admin.id, projectA]
  );

  server = await new Promise((resolve) => {
    const listener = createApp().listen(0, '127.0.0.1', () => resolve(listener));
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
  const adminCookie = await login(admin), deniedCookie = await login(deniedAdmin);
  const ownerACookie = await login(ownerA), ownerBCookie = await login(ownerB);

  const initial = await expect(`/projects/${projectA}/workspace`, { cookie: adminCookie }, 200, 'OK');
  assert.equal(initial.payload.data.materials[0].categories[0].versions.length, 2);
  assert(initial.payload.data.timeline.some((event) => event.eventCategory === 'application'));
  assert(initial.payload.data.timeline.some((event) => event.eventType === 'material_returned'));
  await expect(`/projects/${projectA}/workspace`, { cookie: deniedCookie }, 403, 'ADMIN_PERMISSION_REQUIRED');
  await expect(`/projects/${projectA}/workspace`, { cookie: ownerACookie }, 200, 'OK');
  await expect(`/projects/${projectB}/workspace`, { cookie: ownerACookie }, 404, 'NOT_FOUND');
  await expect(`/projects/${projectA}`, { method: 'PUT', cookie: ownerACookie, body: {} }, 403, 'FORBIDDEN');
  await expect(`/projects/${projectA}/workspace`, { cookie: ownerBCookie }, 404, 'NOT_FOUND');

  await expect(`/projects/${projectA}`, {
    method: 'PUT', cookie: adminCookie,
    body: { projectYear: 2026, projectGroup: '集成检查组', projectCode: `WS-A-${suffix}`, title: '工作台新名称', category: '创新类', approvalDate: '2026-01-10', approvalType: 'first', approvalBatch: '2026 首次立项', status: 'checking', remark: '字段审计检查' }
  }, 200, 'OK');
  await expect(`/projects/${projectA}/participations`, {
    method: 'PUT', cookie: adminCookie, body: { memberPersonIds: [memberPerson], advisorPersonIds: [advisorPerson] }
  }, 200, 'OK');
  await expect(`/projects/${projectA}`, {
    method: 'PUT', cookie: adminCookie,
    body: { projectYear: 2026, projectCode: `WS-A-${suffix}`, title: '工作台新名称', approvalType: 'first', status: 'checking', ownerPersonId: ownerPersonB }
  }, 400, 'PROJECT_OWNER_CHANGE_REQUIRES_APPROVAL');

  const updated = await expect(`/projects/${projectA}/workspace`, { cookie: adminCookie }, 200, 'OK');
  const fieldEvent = updated.payload.data.timeline.find((event) => event.eventType === 'project_status_changed');
  assert(fieldEvent.changes.some((change) => change.field === 'title' && change.before === '工作台旧名称' && change.after === '工作台新名称'));
  const relationEvent = updated.payload.data.timeline.find((event) => event.eventType === 'participations_changed');
  assert.equal(relationEvent.beforeSnapshot.filter((row) => row.role === 'owner').length, 1);
  assert.equal(relationEvent.afterSnapshot.filter((row) => row.role === 'owner').length, 1);
  const legacy = await expect(`/projects/${projectB}/workspace`, { cookie: ownerBCookie }, 200, 'OK');
  assert(legacy.payload.data.timeline.some((event) => event.legacyDerived && event.actor === null));

  console.log(JSON.stringify({ verified: [
    'project_management 管理员可查看和编辑，无权限小管理员被拒绝',
    '两个负责人只能查看自己的项目且不能修改',
    '项目字段审计保存真实前后值',
    '成员/导师关系审计保存前后快照且 owner 始终唯一',
    '时间轴返回立项、材料两个版本、退回/通过和项目变更事件',
    '旧项目生成不伪造操作者的兼容节点'
  ] }, null, 2));
}

try {
  await main();
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
}
