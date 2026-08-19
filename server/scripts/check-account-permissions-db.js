import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeMigrationSql } from '../src/utils/migrationSql.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');
const databaseName = String(process.env.ACCOUNT_PERMISSION_VERIFY_DB || '');
if (!/^kexie_verify_api_[a-z0-9_]{8,40}$/.test(databaseName)) {
  throw new Error('ACCOUNT_PERMISSION_VERIFY_DB must be a unique kexie_verify_api_* temporary database name');
}

const adminConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: true
};

let admin;
let database;
let pool;
let server;
let created = false;

try {
  admin = await mysql.createConnection(adminConfig);
  const [existing] = await admin.execute('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [databaseName]);
  if (existing.length) throw new Error(`Refusing to reuse existing database ${databaseName}`);
  await admin.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  created = true;
  database = await mysql.createConnection({ ...adminConfig, database: databaseName });

  const migrationsDir = path.join(projectRoot, 'database', 'migrations');
  const migrations = (await fs.readdir(migrationsDir)).filter((name) => /^\d+_.+\.sql$/i.test(name)).sort();
  for (const migration of migrations) {
    const sql = await fs.readFile(path.join(migrationsDir, migration), 'utf8');
    await executeMigrationSql(database, sql);
  }

  process.env.DB_NAME = databaseName;
  process.env.JWT_SECRET = 'account-permission-verification-secret-2026';
  const [{ default: bcrypt }, { createApp }, poolModule, authSessionModule, envModule] = await Promise.all([
    import('bcryptjs'),
    import('../src/app.js'),
    import('../src/db/pool.js'),
    import('../src/utils/authSession.js'),
    import('../src/config/env.js')
  ]);
  pool = poolModule.pool;
  const { signUserToken } = authSessionModule;
  const { env } = envModule;
  const password = 'AccountVerify!2026';
  const passwordHash = await bcrypt.hash(password, 4);
  const [superResult] = await pool.execute(
    `INSERT INTO users (username, display_name, password_hash, role, admin_level, status, password_reset_required)
     VALUES ('verify_super', '验证超级管理员', ?, 'admin', 'super', 'enabled', 0)`,
    [passwordHash]
  );
  const superId = Number(superResult.insertId);

  const [limitedResult] = await pool.execute(
    `INSERT INTO users (username, display_name, password_hash, role, admin_level, status, password_reset_required)
     VALUES ('verify_limited', '验证小管理员', ?, 'admin', 'limited', 'enabled', 0)`,
    [passwordHash]
  );
  const limitedId = Number(limitedResult.insertId);
  await pool.execute(
    `INSERT INTO admin_user_permissions (user_id, permission_key, granted_by)
     VALUES (?, 'project_management', ?)`,
    [limitedId, superId]
  );

  async function cookieFor(userId) {
    const [[user]] = await pool.execute('SELECT id, role, token_version FROM users WHERE id = ?', [userId]);
    return `${env.authCookie.name}=${signUserToken(user)}`;
  }

  server = await new Promise((resolve) => {
    const listener = createApp().listen(0, '127.0.0.1', () => resolve(listener));
  });
  const apiBase = `http://127.0.0.1:${server.address().port}/api`;
  async function request(requestPath, { method = 'GET', body, cookie } = {}) {
    const response = await fetch(`${apiBase}${requestPath}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { response, payload: await response.json() };
  }
  async function expectStatus(requestPath, options, status, code = null) {
    const result = await request(requestPath, options);
    assert.equal(result.response.status, status, `${requestPath}: ${result.payload?.message}`);
    if (code) assert.equal(result.payload.code, code, `${requestPath} error code`);
    return result;
  }

  const superCookie = await cookieFor(superId);
  const limitedCookie = await cookieFor(limitedId);
  await expectStatus('/projects?pageSize=1', { cookie: limitedCookie }, 200, 'OK');
  await expectStatus('/people?pageSize=1', { cookie: limitedCookie }, 403, 'ADMIN_PERMISSION_REQUIRED');
  await expectStatus('/accounts?pageSize=1', { cookie: limitedCookie }, 403, 'SUPER_ADMIN_REQUIRED');
  await expectStatus('/accounts?pageSize=1', { cookie: superCookie }, 200, 'OK');
  await expectStatus(`/accounts/${superId}/status`, {
    method: 'PATCH', cookie: superCookie, body: { status: 'disabled' }
  }, 400, 'SUPER_ADMIN_PROTECTED');

  const createdAdmin = await expectStatus('/accounts', {
    method: 'POST', cookie: superCookie,
    body: {
      role: 'admin', username: 'verify_created_admin', displayName: '接口创建小管理员',
      initialPassword: password, permissionKeys: ['material_review']
    }
  }, 200, 'OK');
  const [[createdAdminRow]] = await pool.execute('SELECT admin_level FROM users WHERE id = ?', [createdAdmin.payload.data.id]);
  assert.equal(createdAdminRow.admin_level, 'limited');

  await expectStatus('/auth/register', {
    method: 'POST',
    body: { username: 'must_be_ignored', studentNo: '  st-001  ', name: '新学生', college: '测试学院', password }
  }, 200, 'OK');
  const [[newStudentUser]] = await pool.execute(
    `SELECT u.username, pe.student_no FROM users u JOIN people pe ON pe.id = u.person_id
     WHERE pe.student_no = 'ST-001'`
  );
  assert.equal(newStudentUser.username, 'ST-001');

  await pool.execute(
    "INSERT INTO people (person_type, name, student_no, college) VALUES ('student', '复用学生', 'REUSE-001', '原学院')"
  );
  await expectStatus('/auth/register', {
    method: 'POST', body: { studentNo: 'reuse-001', name: '复用学生', college: '新学院', password }
  }, 200, 'OK');
  const [[reuseCount]] = await pool.execute("SELECT COUNT(*) AS total FROM people WHERE student_no = 'REUSE-001'");
  assert.equal(Number(reuseCount.total), 1);
  await expectStatus('/auth/register', {
    method: 'POST', body: { studentNo: 'REUSE-001', name: '复用学生', college: '新学院', password }
  }, 409, 'STUDENT_NUMBER_REGISTERED');

  const [ownerPerson] = await pool.execute(
    "INSERT INTO people (person_type, name, student_no) VALUES ('student', '已有负责人', 'OWNER-001')"
  );
  const [ownerProject] = await pool.execute(
    "INSERT INTO projects (project_year, project_code, title, status) VALUES (2099, 'VERIFY-OWNER', '负责人项目', 'draft')"
  );
  await pool.execute(
    "INSERT INTO project_participations (project_id, person_id, role, is_primary_owner) VALUES (?, ?, 'owner', 1)",
    [ownerProject.insertId, ownerPerson.insertId]
  );
  await expectStatus('/auth/register', {
    method: 'POST', body: { studentNo: 'OWNER-001', name: '已有负责人', college: '测试学院', password }
  }, 409, 'STUDENT_ALREADY_PROJECT_OWNER');

  const [legacyPerson] = await pool.execute(
    "INSERT INTO people (person_type, name, student_no, account_status) VALUES ('student', '旧账号学生', 'LEGACY-001', 'enabled')"
  );
  await pool.execute(
    `INSERT INTO users (username, display_name, password_hash, role, status, person_id, password_reset_required)
     VALUES ('legacy_custom_name', '旧账号学生', ?, 'applicant', 'enabled', ?, 0)`,
    [passwordHash, legacyPerson.insertId]
  );
  await expectStatus('/auth/login', {
    method: 'POST', body: { username: 'legacy_custom_name', password }
  }, 200, 'OK');
  await expectStatus('/auth/register', {
    method: 'POST', body: { studentNo: 'LEGACY-001', name: '旧账号学生', college: '测试学院', password }
  }, 409, 'PERSON_ACCOUNT_ALREADY_BOUND');

  console.log(JSON.stringify({
    verified: [
      'limited administrator module allow and deny decisions',
      'limited administrator cannot access administrator management',
      'super administrator protection and limited-only creation',
      'student number is normalized and forced as username',
      'existing person is reused without duplication',
      'duplicate registration and existing owner are rejected explicitly',
      'legacy custom username can still login'
    ]
  }, null, 2));
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool?.end().catch(() => undefined);
  await database?.end().catch(() => undefined);
  if (admin && created) await admin.query(`DROP DATABASE \`${databaseName}\``);
  await admin?.end().catch(() => undefined);
  if (created) process.stdout.write(`Removed temporary database ${databaseName}.\n`);
}
