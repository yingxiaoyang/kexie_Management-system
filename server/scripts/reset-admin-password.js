import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(serverRoot, '.env') });

const newPassword = process.argv[2];
const username = process.argv[3] || process.env.INITIAL_ADMIN_USERNAME || 'admin';

if (!newPassword || newPassword.length < 8) {
  console.error('用法: node scripts/reset-admin-password.js <至少8位的新密码> [超级管理员账号]');
  process.exit(1);
}

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME || 'kexie_db',
  user: process.env.DB_USER || 'kexie_user',
  password: process.env.DB_PASSWORD || ''
});

try {
  const passwordHash = await bcrypt.hash(newPassword, 12);
  const [result] = await connection.execute(
    `UPDATE users
     SET password_hash = ?, password_reset_required = 1, status = 'enabled',
         token_version = token_version + 1, failed_login_attempts = 0,
         locked_until = NULL, last_failed_login_at = NULL, updated_at = NOW()
     WHERE username = ? AND role = 'admin' AND admin_level = 'super' AND deleted_at IS NULL`,
    [passwordHash, username]
  );

  if (result.affectedRows !== 1) {
    console.error(`未找到可用的超级管理员账号: ${username}`);
    process.exitCode = 1;
  } else {
    console.log(`超级管理员 ${username} 的密码已重置，请登录后立即修改。`);
  }
} finally {
  await connection.end();
}
