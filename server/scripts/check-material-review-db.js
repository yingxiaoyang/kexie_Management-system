import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'node:url';
import { executeMigrationSql } from '../src/utils/migrationSql.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');
const databaseName = String(process.env.MATERIAL_REVIEW_VERIFY_DB || '');
if (!/^kexie_verify_review_[a-z0-9_]{8,40}$/.test(databaseName)) {
  throw new Error('MATERIAL_REVIEW_VERIFY_DB must be a unique kexie_verify_review_* temporary database name');
}

const adminConfig = { host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', multipleStatements: true };
let admin, database, pool, server, created = false, uploadRoot;

async function jsonApi(base, route, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${base}${route}`, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = await response.json();
  return { response, payload, cookie: (response.headers.get('set-cookie') || '').split(';', 1)[0] };
}

function zipEntryNames(buffer) {
  const names = [];
  for (let offset = 0; offset + 46 <= buffer.length;) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) { offset += 1; continue; }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    names.push(buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

try {
  admin = await mysql.createConnection(adminConfig);
  const [existing] = await admin.execute('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [databaseName]);
  if (existing.length) throw new Error(`Refusing to reuse existing database ${databaseName}`);
  await admin.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  created = true;
  database = await mysql.createConnection({ ...adminConfig, database: databaseName });
  for (const migration of (await fs.readdir(path.join(projectRoot, 'database', 'migrations'))).filter((name) => /^\d+_.+\.sql$/i.test(name)).sort()) {
    await executeMigrationSql(database, await fs.readFile(path.join(projectRoot, 'database', 'migrations', migration), 'utf8'));
  }

  uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kexie-review-files-'));
  process.env.DB_NAME = databaseName;
  process.env.UPLOAD_ROOT = uploadRoot;
  process.env.JWT_SECRET = 'material-review-verification-secret-2026';
  const [{ default: bcrypt }, { createApp }, poolModule] = await Promise.all([import('bcryptjs'), import('../src/app.js'), import('../src/db/pool.js')]);
  pool = poolModule.pool;
  const hash = await bcrypt.hash('ReviewVerify!2026', 4);
  const createUser = async (username, displayName, adminLevel, role = 'admin', personId = null) => Number((await pool.execute(
    `INSERT INTO users (username, display_name, password_hash, role, admin_level, status, person_id, password_reset_required)
     VALUES (?, ?, ?, ?, ?, 'enabled', ?, 0)`, [username, displayName, hash, role, adminLevel, personId]
  ))[0].insertId);
  const superId = await createUser('review_super', '审核超级管理员', 'super');
  const reviewerA = await createUser('reviewer_a', '审核员甲', 'limited');
  const reviewerB = await createUser('reviewer_b', '审核员乙', 'limited');
  const invalidAdmin = await createUser('review_invalid', '无审核权限管理员', 'limited');
  for (const id of [reviewerA, reviewerB]) await pool.execute("INSERT INTO admin_user_permissions (user_id, permission_key, granted_by) VALUES (?, 'material_review', ?)", [id, superId]);
  await pool.execute("INSERT INTO admin_user_permissions (user_id, permission_key, granted_by) VALUES (?, 'material_task', ?)", [invalidAdmin, superId]);
  const [person] = await pool.execute("INSERT INTO people (person_type, name, student_no, account_status) VALUES ('student', '材料负责人', 'REVIEW-OWNER-01', 'enabled')");
  const ownerId = await createUser('review_owner', '材料负责人', null, 'project_owner', Number(person.insertId));
  const [project] = await pool.execute("INSERT INTO projects (project_year, project_code, title, approval_type, status) VALUES (2026, 'REVIEW-001', '材料审核验证项目', 'first', 'active')");
  await pool.execute("INSERT INTO project_participations (project_id, person_id, role, is_primary_owner) VALUES (?, ?, 'owner', 1)", [project.insertId, person.insertId]);
  const [task] = await pool.execute("INSERT INTO material_tasks (task_name, project_scope_type, max_file_mb, max_task_project_mb, status, created_by) VALUES ('结项材料', 'all', 20, 200, 'published', ?)", [superId]);
  const [category] = await pool.execute("INSERT INTO material_categories (material_task_id, category_name, allowed_extensions, max_file_mb, is_required) VALUES (?, '结项报告', JSON_ARRAY('pdf','docx'), 20, 1)", [task.insertId]);

  server = await new Promise((resolve) => { const listener = createApp().listen(0, '127.0.0.1', () => resolve(listener)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const login = async (username) => (await jsonApi(base, '/auth/login', { method: 'POST', body: { username, password: 'ReviewVerify!2026' } })).cookie;
  const superCookie = await login('review_super'), cookieA = await login('reviewer_a'), cookieB = await login('reviewer_b'), invalidCookie = await login('review_invalid'), ownerCookie = await login('review_owner');
  const upload = async (name, type, bytes) => {
    const form = new FormData(); form.set('taskId', task.insertId); form.set('projectId', project.insertId); form.set('categoryId', category.insertId); form.set('file', new Blob([bytes], { type }), name);
    const response = await fetch(`${base}/uploads/submissions`, { method: 'POST', headers: { Cookie: ownerCookie }, body: form });
    const payload = await response.json(); assert.equal(response.status, 200, JSON.stringify(payload)); return payload.data;
  };
  const pdf = await upload('中文材料.pdf', 'application/pdf', Buffer.from('%PDF-1.4\n%%EOF'));
  const office = await upload('审核表.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.from('office-test'));
  const submission1 = Number(pdf.submissionId), submission2 = Number(office.submissionId);
  const [[savedName]] = await pool.execute('SELECT original_name AS originalName, storage_path AS storagePath, file_size AS fileSize, mime_type AS mimeType FROM material_files WHERE id = ?', [pdf.file.id]);
  assert.equal(savedName.originalName, '中文材料.pdf');

  assert.equal((await jsonApi(base, '/material-tasks', { cookie: cookieA })).response.status, 403, 'material_review must not grant material_task');
  let ownList = await jsonApi(base, '/submissions?reviewStatus=pending', { cookie: cookieA });
  assert.equal(ownList.payload.data.length, 0, 'limited reviewer must only see assigned tasks');
  const superList = await jsonApi(base, '/submissions?assignmentStatus=unassigned', { cookie: superCookie });
  assert.equal(superList.payload.data.length, 2);

  const assign = (ids, assigneeId, versions, reason = '') => jsonApi(base, '/submissions/batch-assign', { method: 'POST', cookie: superCookie, body: { submissionIds: ids, assigneeId, expectedAssignmentVersions: versions, reason } });
  assert.equal((await assign([submission1], invalidAdmin, { [submission1]: 0 })).payload.code, 'INVALID_REVIEW_ASSIGNEE');
  assert.equal((await assign([submission1], reviewerA, { [submission1]: 0 })).response.status, 200);
  assert.equal((await jsonApi(base, `/submissions/${submission1}/files`, { cookie: cookieB })).payload.code, 'MATERIAL_REVIEW_NOT_ASSIGNED');
  assert.equal((await jsonApi(base, `/submissions/${submission1}/review`, { method: 'PATCH', cookie: cookieB, body: { action: 'approve', assignmentVersion: 1 } })).response.status, 403);
  assert.equal((await assign([submission1], reviewerB, { [submission1]: 1 })).payload.code, 'REASSIGN_REASON_REQUIRED');
  assert.equal((await assign([submission1], reviewerB, { [submission1]: 1 }, '审核员工作调整')).response.status, 200);
  assert.equal((await jsonApi(base, `/submissions/${submission1}/review`, { method: 'PATCH', cookie: cookieA, body: { action: 'approve', assignmentVersion: 1 } })).payload.code, 'MATERIAL_ASSIGNMENT_CONFLICT');

  ownList = await jsonApi(base, '/submissions?reviewStatus=pending', { cookie: cookieA });
  assert.equal(ownList.payload.data.length, 0);
  const files = await jsonApi(base, `/submissions/${submission1}/files`, { cookie: cookieB });
  assert.equal(files.payload.data[0].originalName, '中文材料.pdf');
  assert.equal(files.payload.data[0].previewType, 'pdf');
  const preview = await fetch(`${base}/submissions/${submission1}/files/${pdf.file.id}/preview`, { headers: { Cookie: cookieB } });
  assert.equal(preview.status, 200); assert.equal(preview.headers.get('content-type'), 'application/pdf'); assert.match(preview.headers.get('content-disposition'), /^inline;/);
  await pool.execute(
    `INSERT INTO material_files (submission_id, original_name, storage_path, file_size, mime_type, uploaded_by)
     VALUES (?, '../../中文材料.pdf', ?, ?, ?, ?)`,
    [submission1, savedName.storagePath, savedName.fileSize, savedName.mimeType, ownerId]
  );
  const zipResponse = await fetch(`${base}/submissions/batch-download`, { method: 'POST', headers: { Cookie: cookieB, 'Content-Type': 'application/json' }, body: JSON.stringify({ submissionIds: [submission1] }) });
  assert.equal(zipResponse.status, 200); assert.match(zipResponse.headers.get('content-disposition'), /filename\*=UTF-8''/);
  const zipNames = zipEntryNames(Buffer.from(await zipResponse.arrayBuffer()));
  assert.equal(zipNames.length, 2); assert.equal(new Set(zipNames.map((name) => name.toLocaleLowerCase('zh-CN'))).size, 2);
  assert(zipNames.every((name) => !name.includes('..') && !name.includes('\\') && !name.startsWith('/')));
  assert(zipNames.every((name) => name.includes('中文材料')));
  const officeFiles = await jsonApi(base, `/submissions/${submission2}/files`, { cookie: superCookie });
  assert.equal(officeFiles.payload.data[0].previewable, false);
  const officePreview = await jsonApi(base, `/submissions/${submission2}/files/${office.file.id}/preview`, { cookie: superCookie });
  assert.equal(officePreview.payload.code, 'FILE_PREVIEW_NOT_SUPPORTED');

  const returned = await jsonApi(base, `/submissions/${submission1}/review`, { method: 'PATCH', cookie: cookieB, body: { action: 'return', reason: '缺少负责人签章', assignmentVersion: 2 } });
  assert.equal(returned.response.status, 200);
  await assign([submission2], reviewerB, { [submission2]: 0 });
  const concurrent = await Promise.all([
    jsonApi(base, `/submissions/${submission2}/review`, { method: 'PATCH', cookie: cookieB, body: { action: 'approve', assignmentVersion: 1 } }),
    jsonApi(base, `/submissions/${submission2}/review`, { method: 'PATCH', cookie: cookieB, body: { action: 'approve', assignmentVersion: 1 } })
  ]);
  assert.deepEqual(concurrent.map((item) => item.response.status).sort(), [200, 409]);
  const [reviewRows] = await pool.execute('SELECT id, reviewed_by AS reviewedBy FROM material_submissions WHERE id IN (?, ?) ORDER BY id', [submission1, submission2]);
  assert(reviewRows.every((row) => Number(row.reviewedBy) === reviewerB), 'actual reviewer must be current request user');
  const history = await jsonApi(base, `/submissions/${submission1}/audit`, { cookie: cookieB });
  assert.deepEqual(history.payload.data.map((item) => item.eventType), ['assigned', 'reassigned', 'returned']);
  await assert.rejects(() => pool.execute("UPDATE material_review_audit_events SET reason = 'tampered' WHERE submission_id = ?", [submission1]), /immutable/);
  const workspace = await jsonApi(base, `/projects/${project.insertId}/workspace`, { cookie: superCookie });
  for (const eventType of ['material_review_assigned', 'material_review_reassigned', 'material_review_returned', 'material_review_reviewed']) assert(workspace.payload.data.timeline.some((event) => event.eventType === eventType), eventType);

  console.log(JSON.stringify({ verified: ['中文上传名与 PDF 预览', 'Office 预览限制与权限隔离', '原文件 ZIP 中文名、路径清洗与同名防冲突', '合法/非法分配及改派原因', '小管理员仅看本人任务', '越权与旧页面改派冲突', '并发重复审核仅一次成功', '实际审核人、不可变历史与项目时间轴'] }, null, 2));
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool?.end().catch(() => undefined);
  await database?.end().catch(() => undefined);
  if (admin && created) await admin.query(`DROP DATABASE \`${databaseName}\``);
  await admin?.end().catch(() => undefined);
  if (uploadRoot && path.basename(uploadRoot).startsWith('kexie-review-files-')) await fs.rm(uploadRoot, { recursive: true, force: true });
  if (created) process.stdout.write(`Removed temporary database ${databaseName}.\n`);
}
