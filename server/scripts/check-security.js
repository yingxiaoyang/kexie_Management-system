import bcrypt from 'bcryptjs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { pool } from '../src/db/pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');
const password = 'SecurityCheck!123';
const sensitivePassword = 'NEVER_LOG_THIS_PASSWORD';
const sensitiveQueryPassword = 'NEVER_LOG_QUERY_PASSWORD';
const createdUserIds = [];
const capturedLogs = [];
const originalWarn = console.warn;
const originalError = console.error;
let server;
let apiBase;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(requestPath, {
  method = 'GET',
  body,
  ip = '203.0.113.1',
  origin,
  headers = {}
} = {}) {
  const response = await fetch(`${apiBase}${requestPath}`, {
    method,
    headers: {
      'X-Forwarded-For': ip,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  return { response, payload };
}

async function expectStatus(requestPath, options, status, code) {
  const result = await request(requestPath, options);
  assert(result.response.status === status,
    `${requestPath} expected HTTP ${status}, got ${result.response.status}: ${result.payload?.message || ''}`);
  if (code) {
    assert(result.payload?.code === code,
      `${requestPath} expected code ${code}, got ${result.payload?.code}`);
  }
  return result;
}

async function createUser(label, role = 'project_owner') {
  const suffix = `${Date.now()}_${createdUserIds.length}_${Math.random().toString(36).slice(2, 8)}`;
  const username = `security_${label}_${suffix}`;
  const hash = await bcrypt.hash(password, 4);
  const [result] = await pool.execute(
    `INSERT INTO users
       (username, display_name, password_hash, role, status, password_reset_required)
     VALUES (?, ?, ?, ?, 'enabled', 0)`,
    [username, `安全检查-${label}`, hash, role]
  );
  const user = { id: Number(result.insertId), username, role };
  createdUserIds.push(user.id);
  return user;
}

async function login(user, loginPassword, ip) {
  return request('/auth/login', {
    method: 'POST',
    ip,
    body: { username: user.username, password: loginPassword }
  });
}

function checkProductionStartupValidation() {
  const safeEnvironment = {
    ...process.env,
    NODE_ENV: 'production',
    JWT_SECRET: 'prod-jwt-secret-2026-with-at-least-32-characters',
    DB_PASSWORD: 'prod-db-password-2026',
    INITIAL_ADMIN_PASSWORD: 'ProdAdminPassword!2026',
    CORS_ORIGINS: 'https://portal.example.edu.cn',
    TRUST_PROXY: 'loopback'
  };
  const command = ['--input-type=module', '-e', "await import('./src/config/env.js')"];
  const safeResult = spawnSync(process.execPath, command, {
    cwd: serverRoot,
    env: safeEnvironment,
    encoding: 'utf8'
  });
  assert(safeResult.status === 0, `Safe production configuration was rejected: ${safeResult.stderr}`);

  const unsafeCases = [
    { JWT_SECRET: 'dev-only-change-me' },
    { DB_PASSWORD: 'replace_with_database_password' },
    { INITIAL_ADMIN_PASSWORD: 'ChangeMe123!' },
    { CORS_ORIGINS: '*' },
    { CORS_ORIGINS: 'https://*.example.edu.cn' },
    { CORS_ORIGINS: 'http://portal.example.edu.cn' },
    { TRUST_PROXY: 'true' }
  ];
  for (const unsafeEnvironment of unsafeCases) {
    const result = spawnSync(process.execPath, command, {
      cwd: serverRoot,
      env: { ...safeEnvironment, ...unsafeEnvironment },
      encoding: 'utf8'
    });
    assert(result.status !== 0, `Unsafe production configuration was accepted: ${Object.keys(unsafeEnvironment)[0]}`);
  }
}

async function main() {
  env.trustProxy = ['loopback'];
  env.security.bodyLimit = '1kb';
  env.security.loginIpMax = 6;
  env.security.adminLoginIpMax = 3;

  console.warn = (...items) => capturedLogs.push(items.join(' '));
  console.error = (...items) => capturedLogs.push(items.join(' '));

  server = await new Promise((resolve) => {
    const listener = createApp().listen(0, '127.0.0.1', () => resolve(listener));
  });
  apiBase = `http://127.0.0.1:${server.address().port}/api`;

  const owner = await createUser('owner');
  const rateLimitedOwner = await createUser('owner_rate');
  const rateLimitedAdmin = await createUser('admin_rate', 'admin');

  await expectStatus('/auth/login', {
    method: 'POST',
    ip: '203.0.113.10',
    body: { username: owner.username, password }
  }, 200, 'OK');

  await expectStatus('/auth/login', {
    method: 'POST',
    ip: '203.0.113.11',
    headers: {
      Cookie: 'kexie_session=NEVER_LOG_THIS_COOKIE',
      Authorization: 'Bearer NEVER_LOG_THIS_AUTHORIZATION'
    },
    body: { username: owner.username, password: sensitivePassword }
  }, 401, 'INVALID_CREDENTIALS');
  for (let attempt = 2; attempt <= 4; attempt += 1) {
    await expectStatus('/auth/login', {
      method: 'POST',
      ip: '203.0.113.11',
      body: { username: owner.username, password: 'wrong-password' }
    }, 401, 'INVALID_CREDENTIALS');
  }
  await expectStatus('/auth/login', {
    method: 'POST',
    ip: '203.0.113.11',
    body: { username: owner.username, password: 'wrong-password' }
  }, 423, 'ACCOUNT_LOCKED');

  const [[lockedUser]] = await pool.execute(
    'SELECT failed_login_attempts, locked_until, last_failed_login_at FROM users WHERE id = ?',
    [owner.id]
  );
  assert(Number(lockedUser.failed_login_attempts) === 5, 'Account failure counter was not saved');
  assert(lockedUser.locked_until, 'Account lock deadline was not saved');
  assert(lockedUser.last_failed_login_at, 'Last failed login time was not saved');
  await expectStatus('/auth/login', {
    method: 'POST',
    ip: '203.0.113.12',
    body: { username: owner.username, password }
  }, 423, 'ACCOUNT_LOCKED');

  await pool.execute('UPDATE users SET locked_until = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE id = ?', [owner.id]);
  await expectStatus('/auth/login', {
    method: 'POST',
    ip: '203.0.113.13',
    body: { username: owner.username, password }
  }, 200, 'OK');
  const [[unlockedUser]] = await pool.execute(
    'SELECT failed_login_attempts, locked_until, last_failed_login_at FROM users WHERE id = ?',
    [owner.id]
  );
  assert(Number(unlockedUser.failed_login_attempts) === 0, 'Successful login did not clear failure counter');
  assert(!unlockedUser.locked_until, 'Successful login did not clear lock deadline');
  assert(!unlockedUser.last_failed_login_at, 'Successful login did not clear last failure time');

  for (let attempt = 1; attempt <= env.security.loginIpMax; attempt += 1) {
    const result = await login(rateLimitedOwner, password, '198.51.100.20');
    assert(result.response.status === 200, `Owner login ${attempt} was limited too early`);
  }
  await expectStatus('/auth/login', {
    method: 'POST',
    ip: '198.51.100.20',
    body: { username: rateLimitedOwner.username, password }
  }, 429, 'LOGIN_RATE_LIMITED');

  for (let attempt = 1; attempt <= env.security.adminLoginIpMax; attempt += 1) {
    const result = await login(rateLimitedAdmin, password, '198.51.100.30');
    assert(result.response.status === 200, `Admin login ${attempt} was limited too early`);
  }
  await expectStatus('/auth/login', {
    method: 'POST',
    ip: '198.51.100.30',
    body: { username: rateLimitedAdmin.username, password }
  }, 429, 'LOGIN_RATE_LIMITED');

  const allowedHealth = await request('/health', {
    origin: env.corsOrigins[0],
    ip: '192.0.2.10'
  });
  assert(allowedHealth.response.status === 200, 'Allowed Origin was rejected');
  assert(allowedHealth.response.headers.get('x-content-type-options') === 'nosniff', 'Helmet headers are missing');
  await expectStatus('/health', {
    origin: 'https://evil.example',
    ip: '192.0.2.11'
  }, 403, 'ORIGIN_NOT_ALLOWED');

  await expectStatus('/auth/login', {
    method: 'POST',
    ip: '192.0.2.12',
    body: { username: owner.username, password: 'x'.repeat(2048) }
  }, 413, 'REQUEST_BODY_TOO_LARGE');
  await expectStatus(`/missing?password=${sensitiveQueryPassword}`, {
    ip: '192.0.2.13'
  }, 404, 'ROUTE_NOT_FOUND');

  const allLogs = capturedLogs.join('\n').toLowerCase();
  for (const forbiddenText of [
    sensitivePassword.toLowerCase(),
    sensitiveQueryPassword.toLowerCase(),
    'never_log_this_cookie',
    'never_log_this_authorization',
    '"password"',
    '"cookie"',
    '"authorization"',
    '"body"'
  ]) {
    assert(!allLogs.includes(forbiddenText), `Sensitive request data appeared in logs: ${forbiddenText}`);
  }

  checkProductionStartupValidation();

  originalWarn(JSON.stringify({
    verified: [
      'normal login',
      'wrong password tracking',
      'five-failure account lock',
      'automatic unlock and successful-login reset',
      'IP-based login rate limiting behind a trusted proxy',
      'stricter administrator rate limiting',
      'Helmet headers, Origin enforcement, and request body limit',
      'sanitized security and error logs',
      'production startup safety checks'
    ]
  }, null, 2));
}

try {
  await main();
} finally {
  console.warn = originalWarn;
  console.error = originalError;
  if (createdUserIds.length) {
    const placeholders = createdUserIds.map(() => '?').join(', ');
    await pool.execute(`DELETE FROM users WHERE id IN (${placeholders})`, createdUserIds);
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
}
