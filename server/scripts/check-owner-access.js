import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { pool } from '../src/db/pool.js';

const password = 'OwnerAccess!123';
const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const created = {
  users: [],
  people: [],
  projects: [],
  tasks: [],
  categories: [],
  submissions: [],
  files: [],
  templates: []
};
const testDir = path.join(env.upload.root, 'owner-access-check', suffix);
const outsideDir = path.resolve(env.upload.root, '..', 'owner-access-outside', suffix);
let server;
let apiBase;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(requestPath, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${apiBase}${requestPath}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : Buffer.from(await response.arrayBuffer());
  return {
    response,
    payload,
    cookie: (response.headers.get('set-cookie') || '').split(';', 1)[0]
  };
}

async function expectJsonStatus(requestPath, options, status, code) {
  const result = await request(requestPath, options);
  assert(result.response.status === status,
    `${requestPath} expected HTTP ${status}, got ${result.response.status}`);
  assert(result.payload && typeof result.payload === 'object' && !Buffer.isBuffer(result.payload),
    `${requestPath} expected a JSON response`);
  if (code) {
    assert(result.payload.code === code,
      `${requestPath} expected code ${code}, got ${result.payload.code}`);
  }
  return result;
}

async function expectDownload(requestPath, cookie, expectedText) {
  const result = await request(requestPath, { cookie });
  assert(result.response.status === 200,
    `${requestPath} expected a successful download, got HTTP ${result.response.status}`);
  assert(Buffer.isBuffer(result.payload), `${requestPath} did not return file content`);
  assert(result.payload.toString('utf8') === expectedText, `${requestPath} returned the wrong file`);
}

async function createUser(username, displayName, role, personId = null) {
  const hash = await bcrypt.hash(password, 4);
  const [result] = await pool.execute(
    `INSERT INTO users
       (username, display_name, password_hash, role, admin_level, status, person_id, password_reset_required)
     VALUES (?, ?, ?, ?, ?, 'enabled', ?, 0)`,
    [username, displayName, hash, role, role === 'admin' ? 'limited' : null, personId]
  );
  const id = Number(result.insertId);
  if (role === 'admin') {
    for (const permissionKey of ['project_management', 'material_task', 'material_review']) {
      await pool.execute(
        'INSERT INTO admin_user_permissions (user_id, permission_key, granted_by) VALUES (?, ?, ?)',
        [id, permissionKey, id]
      );
    }
  }
  created.users.push(id);
  return { id, username };
}

async function login(user) {
  const result = await expectJsonStatus('/auth/login', {
    method: 'POST',
    body: { username: user.username, password }
  }, 200, 'OK');
  assert(result.cookie.startsWith(`${env.authCookie.name}=`), 'Login did not return the session cookie');
  return result.cookie;
}

async function createPerson(label) {
  const [result] = await pool.execute(
    `INSERT INTO people
       (person_type, name, student_no, college, phone, account_status)
     VALUES ('student', ?, ?, '权限测试学院', '13800000000', 'enabled')`,
    [`负责人${label}`, `OA${suffix}${label}`]
  );
  const id = Number(result.insertId);
  created.people.push(id);
  return id;
}

async function createProject(label) {
  const [result] = await pool.execute(
    `INSERT INTO projects
       (project_year, project_group, project_code, title, category, status)
     VALUES (2026, ?, ?, ?, '权限测试类', 'active')`,
    [`权限组${label}`, `OA-${suffix}-${label}`, `权限测试项目${label}`]
  );
  const id = Number(result.insertId);
  created.projects.push(id);
  return id;
}

async function createTask(label, projectId, adminId, status = 'published') {
  const [taskResult] = await pool.execute(
    `INSERT INTO material_tasks
       (task_name, task_description, project_scope_type, max_file_mb, max_task_project_mb, has_template, status, created_by)
     VALUES (?, '负责人越权测试任务', 'custom', 50, 500, 1, ?, ?)`,
    [`负责人越权测试任务${label}`, status, adminId]
  );
  const taskId = Number(taskResult.insertId);
  created.tasks.push(taskId);

  await pool.execute(
    'INSERT INTO material_task_projects (material_task_id, project_id) VALUES (?, ?)',
    [taskId, projectId]
  );

  const [categoryResult] = await pool.execute(
    `INSERT INTO material_categories
       (material_task_id, category_name, task_description, allowed_extensions, max_file_mb, has_template, is_required, sort_order)
     VALUES (?, ?, '负责人越权测试子任务', JSON_ARRAY('txt'), 1, 1, 1, 0)`,
    [taskId, `文件任务${label}`]
  );
  const categoryId = Number(categoryResult.insertId);
  created.categories.push(categoryId);
  return { taskId, categoryId };
}

async function createSubmission({ label, taskId, categoryId, projectId, ownerId, filePath }) {
  const [submissionResult] = await pool.execute(
    `INSERT INTO material_submissions
       (material_task_id, project_id, material_category_id, submitter_user_id, submission_status, review_status, submitted_at)
     VALUES (?, ?, ?, ?, 'submitted', 'pending', NOW())`,
    [taskId, projectId, categoryId, ownerId]
  );
  const submissionId = Number(submissionResult.insertId);
  created.submissions.push(submissionId);

  const [fileResult] = await pool.execute(
    `INSERT INTO material_files
       (submission_id, original_name, storage_path, file_size, mime_type, uploaded_by)
     VALUES (?, ?, ?, ?, 'text/plain', ?)`,
    [submissionId, `提交文件${label}.txt`, filePath, Buffer.byteLength(`submission-${label}`), ownerId]
  );
  const fileId = Number(fileResult.insertId);
  created.files.push(fileId);
  return { submissionId, fileId };
}

async function createTemplate({ label, taskId, categoryId, adminId, filePath }) {
  const [result] = await pool.execute(
    `INSERT INTO task_template_attachments
       (material_task_id, material_category_id, original_name, storage_path, file_size, mime_type, uploaded_by)
     VALUES (?, ?, ?, ?, ?, 'text/plain', ?)`,
    [taskId, categoryId, `模板文件${label}.txt`, filePath, Buffer.byteLength(`template-${label}`), adminId]
  );
  const id = Number(result.insertId);
  created.templates.push(id);
  return id;
}

async function setupData() {
  await fs.promises.mkdir(testDir, { recursive: true });
  await fs.promises.mkdir(outsideDir, { recursive: true });

  const personA = await createPerson('A');
  const personB = await createPerson('B');
  const admin = await createUser(`owner_access_admin_${suffix}`, '负责人权限测试管理员', 'admin');
  const ownerA = await createUser(`owner_access_a_${suffix}`, '负责人权限测试A', 'project_owner', personA);
  const ownerB = await createUser(`owner_access_b_${suffix}`, '负责人权限测试B', 'project_owner', personB);
  const projectA = await createProject('A');
  const projectB = await createProject('B');

  await pool.execute(
    `INSERT INTO project_participations (project_id, person_id, role, is_primary_owner)
     VALUES (?, ?, 'owner', 1), (?, ?, 'owner', 1)`,
    [projectA, personA, projectB, personB]
  );

  const taskA = await createTask('A', projectA, admin.id, 'published');
  const taskB = await createTask('B', projectB, admin.id, 'closed');
  const draftTaskA = await createTask('草稿A', projectA, admin.id, 'draft');

  const paths = {
    submissionA: path.join(testDir, 'submission-a.txt'),
    submissionB: path.join(testDir, 'submission-b.txt'),
    templateA: path.join(testDir, 'template-a.txt'),
    templateB: path.join(testDir, 'template-b.txt'),
    draftTemplateA: path.join(testDir, 'draft-template-a.txt'),
    outside: path.join(outsideDir, 'outside.txt'),
    symlink: path.join(testDir, 'symlink-outside.txt')
  };
  await fs.promises.writeFile(paths.submissionA, 'submission-A');
  await fs.promises.writeFile(paths.submissionB, 'submission-B');
  await fs.promises.writeFile(paths.templateA, 'template-A');
  await fs.promises.writeFile(paths.templateB, 'template-B');
  await fs.promises.writeFile(paths.draftTemplateA, 'template-draft-A');
  await fs.promises.writeFile(paths.outside, 'outside');

  const submissionA = await createSubmission({
    label: 'A', taskId: taskA.taskId, categoryId: taskA.categoryId, projectId: projectA, ownerId: ownerA.id, filePath: paths.submissionA
  });
  const submissionB = await createSubmission({
    label: 'B', taskId: taskB.taskId, categoryId: taskB.categoryId, projectId: projectB, ownerId: ownerB.id, filePath: paths.submissionB
  });
  const templateA = await createTemplate({
    label: 'A', taskId: taskA.taskId, categoryId: taskA.categoryId, adminId: admin.id, filePath: paths.templateA
  });
  const templateB = await createTemplate({
    label: 'B', taskId: taskB.taskId, categoryId: taskB.categoryId, adminId: admin.id, filePath: paths.templateB
  });
  const draftTemplateA = await createTemplate({
    label: '草稿A', taskId: draftTaskA.taskId, categoryId: draftTaskA.categoryId, adminId: admin.id, filePath: paths.draftTemplateA
  });

  return {
    admin, ownerA, ownerB, taskA, taskB, draftTaskA,
    submissionA, submissionB, templateA, templateB, draftTemplateA, paths
  };
}

async function verifyOwnerPair({ ownerCookie, own, other }) {
  const ownFiles = await expectJsonStatus(`/submissions/${own.submission.submissionId}/files`, { cookie: ownerCookie }, 200, 'OK');
  assert(ownFiles.payload.data.some((item) => Number(item.id) === own.submission.fileId), 'Owner cannot see own file list');

  await expectJsonStatus(`/submissions/${other.submission.submissionId}/files`, { cookie: ownerCookie }, 403, 'FORBIDDEN');
  await expectDownload(
    `/submissions/${own.submission.submissionId}/files/${own.submission.fileId}/download`,
    ownerCookie,
    own.submissionText
  );
  await expectJsonStatus(
    `/submissions/${other.submission.submissionId}/files/${other.submission.fileId}/download`,
    { cookie: ownerCookie },
    403,
    'FORBIDDEN'
  );

  const ownTemplates = await expectJsonStatus(
    `/material-tasks/${own.task.taskId}/templates?categoryId=${own.task.categoryId}`,
    { cookie: ownerCookie },
    200,
    'OK'
  );
  assert(ownTemplates.payload.data.some((item) => Number(item.id) === own.templateId), 'Owner cannot see own template list');
  await expectJsonStatus(
    `/material-tasks/${other.task.taskId}/templates?categoryId=${other.task.categoryId}`,
    { cookie: ownerCookie },
    403,
    'FORBIDDEN'
  );
  await expectDownload(
    `/material-tasks/${own.task.taskId}/templates/${own.templateId}/download`,
    ownerCookie,
    own.templateText
  );
  await expectJsonStatus(
    `/material-tasks/${other.task.taskId}/templates/${other.templateId}/download`,
    { cookie: ownerCookie },
    403,
    'FORBIDDEN'
  );
}

async function main() {
  server = await new Promise((resolve) => {
    const listener = createApp().listen(0, '127.0.0.1', () => resolve(listener));
  });
  apiBase = `http://127.0.0.1:${server.address().port}/api`;

  const data = await setupData();
  const adminCookie = await login(data.admin);
  const ownerACookie = await login(data.ownerA);
  const ownerBCookie = await login(data.ownerB);

  await verifyOwnerPair({
    ownerCookie: ownerACookie,
    own: {
      task: data.taskA,
      submission: data.submissionA,
      templateId: data.templateA,
      submissionText: 'submission-A',
      templateText: 'template-A'
    },
    other: {
      task: data.taskB,
      submission: data.submissionB,
      templateId: data.templateB
    }
  });

  await verifyOwnerPair({
    ownerCookie: ownerBCookie,
    own: {
      task: data.taskB,
      submission: data.submissionB,
      templateId: data.templateB,
      submissionText: 'submission-B',
      templateText: 'template-B'
    },
    other: {
      task: data.taskA,
      submission: data.submissionA,
      templateId: data.templateA
    }
  });

  await expectJsonStatus(
    `/material-tasks/${data.draftTaskA.taskId}/templates?categoryId=${data.draftTaskA.categoryId}`,
    { cookie: ownerACookie },
    403,
    'FORBIDDEN'
  );
  await expectJsonStatus(
    `/material-tasks/${data.draftTaskA.taskId}/templates?categoryId=${data.draftTaskA.categoryId}`,
    { cookie: adminCookie },
    200,
    'OK'
  );
  await expectJsonStatus(`/submissions/${data.submissionB.submissionId}/files`, { cookie: adminCookie }, 200, 'OK');
  await expectDownload(
    `/material-tasks/${data.taskB.taskId}/templates/${data.templateB}/download`,
    adminCookie,
    'template-B'
  );

  await pool.execute('UPDATE material_files SET storage_path = ? WHERE id = ?', [data.paths.outside, data.submissionA.fileId]);
  await expectJsonStatus(
    `/submissions/${data.submissionA.submissionId}/files/${data.submissionA.fileId}/download`,
    { cookie: ownerACookie },
    403,
    'SUBMISSION_FILE_PATH_INVALID'
  );
  await pool.execute('UPDATE material_files SET storage_path = ? WHERE id = ?', [data.paths.submissionA, data.submissionA.fileId]);

  await pool.execute('UPDATE task_template_attachments SET storage_path = ? WHERE id = ?', [data.paths.outside, data.templateA]);
  await expectJsonStatus(
    `/material-tasks/${data.taskA.taskId}/templates/${data.templateA}/download`,
    { cookie: ownerACookie },
    403,
    'TEMPLATE_FILE_PATH_INVALID'
  );
  await pool.execute('UPDATE task_template_attachments SET storage_path = ? WHERE id = ?', [data.paths.templateA, data.templateA]);

  let symlinkVerified = false;
  try {
    await fs.promises.symlink(data.paths.outside, data.paths.symlink);
    symlinkVerified = true;
    await pool.execute('UPDATE material_files SET storage_path = ? WHERE id = ?', [data.paths.symlink, data.submissionA.fileId]);
    await expectJsonStatus(
      `/submissions/${data.submissionA.submissionId}/files/${data.submissionA.fileId}/download`,
      { cookie: ownerACookie },
      403,
      'SUBMISSION_FILE_PATH_INVALID'
    );
  } catch (error) {
    if (symlinkVerified) throw error;
  } finally {
    await pool.execute('UPDATE material_files SET storage_path = ? WHERE id = ?', [data.paths.submissionA, data.submissionA.fileId])
      .catch(() => undefined);
  }

  console.log(JSON.stringify({
    verified: [
      'owner A cannot list or download owner B submission files',
      'owner B cannot list or download owner A submission files',
      'owner A cannot list or download owner B task templates',
      'owner B cannot list or download owner A task templates',
      'owners cannot access draft task templates',
      'administrators retain global file and template access',
      'submission and template downloads reject database paths outside the configured upload directory',
      symlinkVerified ? 'symlink escape is rejected after realpath validation' : 'symlink escape check skipped because the OS denied symlink creation'
    ]
  }, null, 2));
}

try {
  await main();
} finally {
  if (created.templates.length) {
    await pool.execute(`DELETE FROM task_template_attachments WHERE id IN (${created.templates.map(() => '?').join(',')})`, created.templates);
  }
  if (created.files.length) {
    await pool.execute(`DELETE FROM material_files WHERE id IN (${created.files.map(() => '?').join(',')})`, created.files);
  }
  if (created.submissions.length) {
    await pool.execute(`DELETE FROM material_submissions WHERE id IN (${created.submissions.map(() => '?').join(',')})`, created.submissions);
  }
  if (created.tasks.length) {
    await pool.execute(`DELETE FROM material_task_projects WHERE material_task_id IN (${created.tasks.map(() => '?').join(',')})`, created.tasks);
    await pool.execute(`DELETE FROM material_categories WHERE material_task_id IN (${created.tasks.map(() => '?').join(',')})`, created.tasks);
    await pool.execute(`DELETE FROM material_tasks WHERE id IN (${created.tasks.map(() => '?').join(',')})`, created.tasks);
  }
  if (created.users.length) {
    await pool.execute(`DELETE FROM admin_user_permissions WHERE user_id IN (${created.users.map(() => '?').join(',')})`, created.users);
    await pool.execute(`DELETE FROM users WHERE id IN (${created.users.map(() => '?').join(',')})`, created.users);
  }
  if (created.projects.length) {
    await pool.execute(`DELETE FROM project_participations WHERE project_id IN (${created.projects.map(() => '?').join(',')})`, created.projects);
  }
  if (created.people.length) {
    await pool.execute(`DELETE FROM people WHERE id IN (${created.people.map(() => '?').join(',')})`, created.people);
  }
  if (created.projects.length) {
    await pool.execute(`DELETE FROM projects WHERE id IN (${created.projects.map(() => '?').join(',')})`, created.projects);
  }
  await fs.promises.rm(testDir, { recursive: true, force: true }).catch(() => undefined);
  await fs.promises.rm(outsideDir, { recursive: true, force: true }).catch(() => undefined);
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
}
