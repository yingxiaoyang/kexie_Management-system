import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertFormalProjectOwnership } from '../src/utils/projectOwnership.js';
import { assertProjectOwnerMigrationReady } from '../src/utils/migrationPreflight.js';
import { executeMigrationSql } from '../src/utils/migrationSql.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');
const databaseName = String(process.env.MIGRATION_VERIFY_DB || '');

if (!/^kexie_verify_[a-z0-9_]{8,48}$/.test(databaseName)) {
  throw new Error('MIGRATION_VERIFY_DB must be a unique kexie_verify_* temporary database name');
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
  assert.deepEqual(migrations.map((name) => name.slice(0, 3)), ['001', '002', '003', '004', '005', '006', '007', '008', '009', '010', '011', '012', '013']);
  for (const migration of migrations) {
    if (migration === '011_application_approval_loop.sql') {
      const [firstPerson] = await database.execute(
        "INSERT INTO people (person_type, name, student_no) VALUES ('student', '预查学生甲', 'VERIFY-PREFLIGHT-001')"
      );
      const [secondPerson] = await database.execute(
        "INSERT INTO people (person_type, name, student_no) VALUES ('student', '预查学生乙', 'VERIFY-PREFLIGHT-002')"
      );
      const projectIds = [];
      for (const [code, status] of [['VERIFY-MULTI', 'active'], ['VERIFY-REPEAT-1', 'draft'], ['VERIFY-REPEAT-2', 'draft'], ['VERIFY-MISSING', 'active']]) {
        const [createdProject] = await database.execute(
          'INSERT INTO projects (project_year, project_code, title, approval_type, status) VALUES (2099, ?, ?, \'first\', ?)',
          [code, code, status]
        );
        projectIds.push(Number(createdProject.insertId));
      }
      await database.execute(
        "INSERT INTO project_participations (project_id, person_id, role, is_primary_owner) VALUES (?, ?, 'owner', 1), (?, ?, 'owner', 0), (?, ?, 'owner', 1), (?, ?, 'owner', 1)",
        [projectIds[0], firstPerson.insertId, projectIds[0], secondPerson.insertId, projectIds[1], firstPerson.insertId, projectIds[2], firstPerson.insertId]
      );
      await assert.rejects(() => assertProjectOwnerMigrationReady(database), /多负责人项目[\s\S]*负责人重复[\s\S]*正式项目无负责人/);
      await database.query('DELETE FROM project_participations WHERE project_id IN (?)', [projectIds]);
      await database.query('DELETE FROM projects WHERE id IN (?)', [projectIds]);
      await database.query('DELETE FROM people WHERE id IN (?)', [[firstPerson.insertId, secondPerson.insertId]]);
      await assertProjectOwnerMigrationReady(database);
      process.stdout.write('011 legacy-owner preflight checks passed.\n');
    }
    const sql = await fs.readFile(path.join(migrationsDir, migration), 'utf8');
    await executeMigrationSql(database, sql);
    process.stdout.write(`Applied ${migration}\n`);
  }

  const passwordHash = '$2a$04$abcdefghijklmnopqrstuuuuuuuuuuuuuuuuuuuuuuuuuuuuu';
  const [superAdmin] = await database.execute(
    `INSERT INTO users (username, display_name, password_hash, role, admin_level, status, password_reset_required)
     VALUES ('verify_super', '迁移验证超级管理员', ?, 'admin', 'super', 'enabled', 0)`,
    [passwordHash]
  );
  await assert.rejects(
    () => database.execute(
      `INSERT INTO users (username, display_name, password_hash, role, admin_level, status, password_reset_required)
       VALUES ('verify_super_2', '第二个超级管理员', ?, 'admin', 'super', 'enabled', 0)`,
      [passwordHash]
    ),
    /Duplicate entry/
  );
  await assert.rejects(
    () => database.execute("UPDATE users SET status = 'disabled' WHERE id = ?", [superAdmin.insertId]),
    /sole super administrator/
  );
  const [limitedAdmin] = await database.execute(
    `INSERT INTO users (username, display_name, password_hash, role, admin_level, status, password_reset_required)
     VALUES ('verify_limited', '迁移验证小管理员', ?, 'admin', 'limited', 'enabled', 0)`,
    [passwordHash]
  );
  await database.execute(
    `INSERT INTO admin_user_permissions (user_id, permission_key, granted_by)
     VALUES (?, 'material_review', ?)`,
    [limitedAdmin.insertId, superAdmin.insertId]
  );

  const [[tableCount]] = await database.execute(
    `SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
    [databaseName]
  );
  const [[columnCount]] = await database.execute(
    `SELECT COUNT(*) AS total FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?`,
    [databaseName]
  );

  const [person] = await database.execute(
    "INSERT INTO people (person_type, name, student_no, account_status) VALUES ('student', '迁移验证学生', 'VERIFY-OWNER-001', 'enabled')"
  );
  await database.beginTransaction();
  const [project] = await database.execute(
    "INSERT INTO projects (project_year, project_code, title, approval_type, status) VALUES (2099, 'VERIFY-FORMAL-001', '迁移验证项目', 'first', 'active')"
  );
  await assert.rejects(
    () => assertFormalProjectOwnership(database, [Number(project.insertId)]),
    (error) => error.code === 'FORMAL_PROJECT_OWNER_REQUIRED'
  );
  await database.rollback();
  const [[rolledBack]] = await database.execute("SELECT COUNT(*) AS total FROM projects WHERE project_code = 'VERIFY-FORMAL-001'");
  assert.equal(Number(rolledBack.total), 0, 'formal project transaction must roll back when owner validation fails');

  const [validProject] = await database.execute(
    "INSERT INTO projects (project_year, project_code, title, approval_type, status) VALUES (2099, 'VERIFY-FORMAL-002', '迁移验证有效项目', 'first', 'draft')"
  );
  await database.execute(
    "INSERT INTO project_participations (project_id, person_id, role, is_primary_owner) VALUES (?, ?, 'owner', 1)",
    [validProject.insertId, person.insertId]
  );
  await database.execute("UPDATE projects SET status = 'active' WHERE id = ?", [validProject.insertId]);
  await assertFormalProjectOwnership(database, [Number(validProject.insertId)]);

  await database.execute(
    `INSERT INTO project_audit_events
     (project_id, event_type, actor_user_id, source_module, field_changes, event_payload)
     VALUES (?, 'project_fields_changed', ?, '项目管理', JSON_ARRAY(JSON_OBJECT('field', 'title', 'before', '旧名称', 'after', '新名称')), JSON_OBJECT('summary', '迁移验证'))`,
    [validProject.insertId, limitedAdmin.insertId]
  );
  await assert.rejects(
    () => database.execute("UPDATE project_audit_events SET source_module = '篡改' WHERE project_id = ?", [validProject.insertId]),
    /project audit events are immutable/
  );
  await assert.rejects(
    () => database.execute('DELETE FROM project_audit_events WHERE project_id = ?', [validProject.insertId]),
    /project audit events are immutable/
  );
  const [[approvalBatchColumn]] = await database.execute(
    `SELECT COUNT(*) AS total FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'approval_batch'`,
    [databaseName]
  );
  assert.equal(Number(approvalBatchColumn.total), 1, '013 must add projects.approval_batch');

  process.stdout.write(`Temporary schema verified: ${Number(tableCount.total)} tables, ${Number(columnCount.total)} columns.\n`);
  process.stdout.write('Owner invariant transaction checks passed.\n');
  process.stdout.write('Single-super and limited-administrator permission checks passed.\n');
  process.stdout.write('Project workspace audit migration checks passed.\n');
} finally {
  await database?.end().catch(() => undefined);
  if (admin && created) await admin.query(`DROP DATABASE \`${databaseName}\``);
  await admin?.end().catch(() => undefined);
  if (created) process.stdout.write(`Removed temporary database ${databaseName}.\n`);
}
