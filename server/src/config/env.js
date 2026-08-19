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

function readPositiveInteger(name, defaultValue) {
  const value = readNumber(name, defaultValue);
  return Number.isInteger(value) && value > 0 ? value : defaultValue;
}

function readBoolean(name, defaultValue) {
  const rawValue = process.env[name];
  if (rawValue == null || rawValue === '') return defaultValue;
  const normalized = rawValue.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function readList(name, defaultValue = []) {
  const rawValue = process.env[name];
  if (!rawValue) return defaultValue;
  return rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readTrustProxy() {
  const rawValue = process.env.TRUST_PROXY;
  if (!rawValue) {
    return (process.env.NODE_ENV || 'development') === 'production'
      ? ['loopback', 'linklocal', 'uniquelocal']
      : false;
  }
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === 'false' || normalized === '0') return false;
  if (normalized === 'true') return true;
  if (/^\d+$/.test(normalized)) return Number(normalized);
  return rawValue.split(',').map((item) => item.trim()).filter(Boolean);
}

function looksLikeExampleSecret(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return true;
  return [
    'dev-only-change-me',
    'changeme123!',
    'replace_with_database_password',
    'replace_with_a_long_random_secret',
    'password',
    'secret'
  ].includes(normalized)
    || normalized.startsWith('replace_with_')
    || normalized.startsWith('example')
    || normalized.startsWith('sample');
}

function validateCorsOrigins(origins) {
  if (!origins.length) throw new Error('Production startup refused: CORS_ORIGINS must not be empty');
  for (const origin of origins) {
    if (origin === 'null' || origin.includes('*')) {
      throw new Error('Production startup refused: CORS_ORIGINS contains a wildcard or null origin');
    }
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('Production startup refused: CORS_ORIGINS contains an invalid origin');
    }
    if (parsed.protocol !== 'https:' || parsed.origin !== origin) {
      throw new Error('Production startup refused: every CORS_ORIGINS entry must be an exact HTTPS origin');
    }
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      throw new Error('Production startup refused: CORS_ORIGINS contains a local development origin');
    }
  }
}

function parseBodyLimitBytes(value) {
  const match = String(value || '').trim().toLowerCase().match(/^(\d+)(b|kb|mb)?$/);
  if (!match) return Number.NaN;
  const units = { b: 1, kb: 1024, mb: 1024 * 1024 };
  return Number(match[1]) * units[match[2] || 'b'];
}

export function assertProductionSafety(config) {
  if (config.nodeEnv !== 'production') return;
  if (looksLikeExampleSecret(config.jwt.secret) || config.jwt.secret.length < 32) {
    throw new Error('Production startup refused: JWT_SECRET is missing, too short, or still uses an example value');
  }
  if (looksLikeExampleSecret(config.db.password) || config.db.password.length < 12) {
    throw new Error('Production startup refused: DB_PASSWORD is missing, too short, or still uses an example value');
  }
  if (looksLikeExampleSecret(config.initialAdminPassword) || config.initialAdminPassword.length < 12) {
    throw new Error('Production startup refused: INITIAL_ADMIN_PASSWORD is missing, too short, or still uses an example value');
  }
  if (config.trustProxy === true) {
    throw new Error('Production startup refused: TRUST_PROXY=true trusts arbitrary forwarding chains');
  }
  if (config.security.adminLoginIpMax >= config.security.loginIpMax) {
    throw new Error('Production startup refused: administrator login rate limit must be stricter than the general limit');
  }
  if (config.security.adminAccountLockMinutes <= config.security.accountLockMinutes) {
    throw new Error('Production startup refused: administrator account lock duration must be longer than the general duration');
  }
  const bodyLimitBytes = parseBodyLimitBytes(config.security.bodyLimit);
  if (!Number.isFinite(bodyLimitBytes) || bodyLimitBytes <= 0 || bodyLimitBytes > 2 * 1024 * 1024) {
    throw new Error('Production startup refused: REQUEST_BODY_LIMIT must be valid and no greater than 2mb');
  }
  validateCorsOrigins(config.corsOrigins);
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
  initialAdminPassword: process.env.INITIAL_ADMIN_PASSWORD || 'ChangeMe123!',
  corsOrigins: readList('CORS_ORIGINS', ['http://127.0.0.1:5173', 'http://localhost:5173']),
  trustProxy: readTrustProxy(),
  security: {
    bodyLimit: process.env.REQUEST_BODY_LIMIT || '256kb',
    loginWindowMs: readPositiveInteger('LOGIN_RATE_LIMIT_WINDOW_MINUTES', 15) * 60 * 1000,
    loginIpMax: readPositiveInteger('LOGIN_RATE_LIMIT_MAX', 20),
    adminLoginIpMax: readPositiveInteger('ADMIN_LOGIN_RATE_LIMIT_MAX', 10),
    registrationWindowMs: readPositiveInteger('REGISTRATION_RATE_LIMIT_WINDOW_MINUTES', 60) * 60 * 1000,
    registrationIpMax: readPositiveInteger('REGISTRATION_RATE_LIMIT_MAX', 8),
    accountFailureLimit: 5,
    accountLockMinutes: readPositiveInteger('ACCOUNT_LOCK_MINUTES', 15),
    adminAccountLockMinutes: readPositiveInteger('ADMIN_ACCOUNT_LOCK_MINUTES', 30)
  },
  upload: {
    root: path.resolve(__dirname, '../../', process.env.UPLOAD_ROOT || '../storage/uploads'),
    maxFileBytes: readNumber('MAX_UPLOAD_FILE_MB', 50) * 1024 * 1024,
    maxTaskProjectBytes: readNumber('MAX_TASK_PROJECT_UPLOAD_MB', 500) * 1024 * 1024,
    applicationMaxBytes: readNumber('MAX_APPLICATION_TOTAL_MB', 200) * 1024 * 1024,
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
    root: path.resolve(__dirname, '../../', process.env.EXPORT_ROOT || '../storage/exports'),
    workerEnabled: readBoolean('ARCHIVE_WORKER_ENABLED', true),
    workerPollMs: readPositiveInteger('ARCHIVE_WORKER_POLL_MS', 2000),
    workerHeartbeatMs: readPositiveInteger('ARCHIVE_WORKER_HEARTBEAT_MS', 5000),
    workerTimeoutMs: readPositiveInteger('ARCHIVE_WORKER_TIMEOUT_MS', 5 * 60 * 1000),
    cleanupIntervalMs: readPositiveInteger('ARCHIVE_CLEANUP_INTERVAL_MS', 60 * 60 * 1000),
    maxAttempts: readPositiveInteger('ARCHIVE_EXPORT_MAX_ATTEMPTS', 3),
    maxQueued: readPositiveInteger('ARCHIVE_EXPORT_MAX_QUEUED', 5),
    maxProjects: readPositiveInteger('ARCHIVE_EXPORT_MAX_PROJECTS', 300),
    maxTotalFileBytes: readPositiveInteger('ARCHIVE_EXPORT_MAX_TOTAL_MB', 2048) * 1024 * 1024,
    minFreeBytes: readPositiveInteger('ARCHIVE_EXPORT_MIN_FREE_MB', 1024) * 1024 * 1024,
    zipRetentionDays: readPositiveInteger('ARCHIVE_ZIP_RETENTION_DAYS', 30),
    importBatchRetentionHours: readPositiveInteger('IMPORT_BATCH_RETENTION_HOURS', 24)
  }
};

assertProductionSafety(env);
