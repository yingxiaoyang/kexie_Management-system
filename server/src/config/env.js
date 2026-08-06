import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function readNumber(name, defaultValue) {
  const rawValue = process.env[name];
  if (!rawValue) return defaultValue;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function readList(name, defaultValue = []) {
  const rawValue = process.env[name];
  if (!rawValue) return defaultValue;
  return rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: readNumber('PORT', 3000),
  appBaseUrl: process.env.APP_BASE_URL || 'http://127.0.0.1:3000',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: readNumber('DB_PORT', 3306),
    database: process.env.DB_NAME || 'kexie_db',
    user: process.env.DB_USER || 'kexie_user',
    password: process.env.DB_PASSWORD || '',
    connectionLimit: readNumber('DB_CONNECTION_LIMIT', 10)
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-only-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h'
  },
  authCookie: {
    name: process.env.AUTH_COOKIE_NAME || 'kexie_session',
    secure: (process.env.NODE_ENV || 'development') === 'production'
  },
  corsOrigins: readList('CORS_ORIGINS', ['http://127.0.0.1:5173', 'http://localhost:5173']),
  upload: {
    root: path.resolve(__dirname, '../../', process.env.UPLOAD_ROOT || '../storage/uploads'),
    maxFileBytes: readNumber('MAX_UPLOAD_FILE_MB', 50) * 1024 * 1024,
    maxTaskProjectBytes: readNumber('MAX_TASK_PROJECT_UPLOAD_MB', 500) * 1024 * 1024,
    allowedExtensions: readList('ALLOWED_UPLOAD_EXTENSIONS', [
      'pdf',
      'doc',
      'docx',
      'xls',
      'xlsx',
      'ppt',
      'pptx',
      'jpg',
      'jpeg',
      'png',
      'zip'
    ])
  },
  archive: {
    root: path.resolve(__dirname, '../../', process.env.EXPORT_ROOT || '../storage/exports')
  }
};
