import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const schemaPath = path.join(projectRoot, 'database', 'migrations', '001_init.sql');
  const schemaSql = await fs.readFile(schemaPath, 'utf8');
  const connection = await mysql.createConnection(dbConfig);

  try {
    await connection.query(schemaSql);

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

    console.log('Database initialized.');
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
