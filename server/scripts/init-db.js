import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertProjectOwnerMigrationReady } from '../src/utils/migrationPreflight.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(serverRoot, '..');

dotenv.config({ path: path.join(serverRoot, '.env') });

const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME || 'kexie_db',
  user: process.env.DB_USER || 'kexie_user',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: true
};

async function main() {
  const connection = await mysql.createConnection(dbConfig);

  try {
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_name VARCHAR(255) NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (migration_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

    const migrationsDir = path.join(projectRoot, 'database', 'migrations');
    const migrationFiles = (await fs.readdir(migrationsDir))
      .filter((fileName) => /^\d+_.+\.sql$/i.test(fileName))
      .sort((left, right) => left.localeCompare(right));
    const [appliedRows] = await connection.query('SELECT migration_name FROM schema_migrations');
    const applied = new Set(appliedRows.map((row) => row.migration_name));

    for (const migrationName of migrationFiles) {
      if (applied.has(migrationName)) continue;
      if (migrationName === '011_application_approval_loop.sql') {
        await assertProjectOwnerMigrationReady(connection);
        console.log('011 owner preflight passed: no multiple owners, repeated owners, or formal projects without an owner.');
      }
      const migrationSql = await fs.readFile(path.join(migrationsDir, migrationName), 'utf8');
      await connection.query(migrationSql);
      await connection.execute('INSERT INTO schema_migrations (migration_name) VALUES (?)', [migrationName]);
      console.log(`Applied migration: ${migrationName}`);
    }

    const username = process.env.INITIAL_ADMIN_USERNAME || 'admin';
    const password = process.env.INITIAL_ADMIN_PASSWORD || 'ChangeMe123!';
    const passwordHash = await bcrypt.hash(password, 12);

    await connection.execute(
      `INSERT INTO users (username, display_name, password_hash, role, status, password_reset_required)
       VALUES (?, '系统管理员', ?, 'admin', 'enabled', 1)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name),
         role = VALUES(role),
         status = VALUES(status)`,
      [username, passwordHash]
    );

    console.log('Database initialized and migrations are up to date.');
    console.log(`Initial admin username: ${username}`);
    console.log('Initial admin password is read from INITIAL_ADMIN_PASSWORD in server/.env.');
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
