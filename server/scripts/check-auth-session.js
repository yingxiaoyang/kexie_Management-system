import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { pool } from '../src/db/pool.js';

const oldPassword = 'AuthCheck!123';
const changedPassword = 'AuthChanged!456';
const resetPassword = 'AuthReset!789';
const createdUserIds = [];
let server;
let apiBase;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  const setCookie = response.headers.get('set-cookie') || '';
  return {
    response,
    payload,
    cookie: setCookie ? setCookie.split(';', 1)[0] : ''
  };
}

async function expectStatus(path, options, expectedStatus, expectedCode) {
  const result = await request(path, options);
  assert(result.response.status === expectedStatus,
    `${path} expected HTTP ${expectedStatus}, got ${result.response.status}: ${result.payload?.message || ''}`);
  if (expectedCode) {
    assert(result.payload?.code === expectedCode,
      `${path} expected code ${expectedCode}, got ${result.payload?.code}`);
  }
  return result;
}

async function createUser(label, passwordResetRequired = false) {
  const suffix = `${Date.now()}_${createdUserIds.length}_${Math.random().toString(36).slice(2, 8)}`;
  const username = `authcheck_${label}_${suffix}`;
  const hash = await bcrypt.hash(oldPassword, 4);
  const [result] = await pool.execute(
    `INSERT INTO users
       (username, display_name, password_hash, role, status, password_reset_required)
     VALUES (?, ?, ?, 'admin', 'enabled', ?)`,
    [username, `认证检查-${label}`, hash, passwordResetRequired ? 1 : 0]
  );
  const id = Number(result.insertId);
  createdUserIds.push(id);
  return { id, username };
}

async function login(user, password = oldPassword) {
  const result = await expectStatus('/auth/login', {
    method: 'POST',
    body: { username: user.username, password }
  }, 200, 'OK');
  assert(result.cookie.startsWith(`${env.authCookie.name}=`), 'Login did not issue the HttpOnly session cookie');
  const cookieHeader = result.response.headers.get('set-cookie') || '';
  assert(/HttpOnly/i.test(cookieHeader), 'Session cookie is not HttpOnly');
  assert(/SameSite=Strict/i.test(cookieHeader), 'Session cookie is not SameSite=Strict');
  assert(!env.authCookie.secure || /Secure/i.test(cookieHeader), 'Production session cookie is not Secure');
  assert(!Object.hasOwn(result.payload.data || {}, 'token'), 'Login response still exposes JWT to JavaScript');
  return result.cookie;
}

async function main() {
  server = await new Promise((resolve) => {
    const listener = createApp().listen(0, '127.0.0.1', () => resolve(listener));
  });
  apiBase = `http://127.0.0.1:${server.address().port}/api`;

  const admin = await createUser('admin');
  const adminCookie = await login(admin);

  const firstLogin = await createUser('first_login', true);
  const firstCookie = await login(firstLogin);
  await expectStatus('/auth/me', { cookie: firstCookie }, 200, 'OK');
  await expectStatus('/projects?page=1&pageSize=1', { cookie: firstCookie }, 403, 'PASSWORD_CHANGE_REQUIRED');
  const changed = await expectStatus('/auth/change-password', {
    method: 'POST',
    cookie: firstCookie,
    body: { oldPassword, newPassword: changedPassword }
  }, 200, 'OK');
  assert(changed.cookie, 'Password change did not rotate the session cookie');
  await expectStatus('/auth/me', { cookie: firstCookie }, 401, 'UNAUTHORIZED');
  await expectStatus('/projects?page=1&pageSize=1', { cookie: changed.cookie }, 200, 'OK');
  await expectStatus('/auth/logout', { method: 'POST', cookie: changed.cookie }, 200, 'OK');
  await expectStatus('/auth/me', { cookie: changed.cookie }, 401, 'UNAUTHORIZED');

  const disabled = await createUser('disabled');
  const disabledCookie = await login(disabled);
  await expectStatus(`/accounts/${disabled.id}/status`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { status: 'disabled' }
  }, 200, 'OK');
  await expectStatus('/auth/me', { cookie: disabledCookie }, 401, 'UNAUTHORIZED');

  const reset = await createUser('reset');
  const resetCookie = await login(reset);
  await expectStatus(`/accounts/${reset.id}/reset-password`, {
    method: 'POST',
    cookie: adminCookie,
    body: { initialPassword: resetPassword }
  }, 200, 'OK');
  await expectStatus('/auth/me', { cookie: resetCookie }, 401, 'UNAUTHORIZED');
  const resetLoginCookie = await login(reset, resetPassword);
  await expectStatus('/projects?page=1&pageSize=1', { cookie: resetLoginCookie }, 403, 'PASSWORD_CHANGE_REQUIRED');

  const deleted = await createUser('deleted');
  const deletedCookie = await login(deleted);
  await expectStatus(`/accounts/${deleted.id}`, {
    method: 'DELETE',
    cookie: adminCookie
  }, 200, 'OK');
  await expectStatus('/auth/me', { cookie: deletedCookie }, 401, 'UNAUTHORIZED');
  await expectStatus('/auth/login', {
    method: 'POST',
    body: { username: deleted.username, password: oldPassword }
  }, 401, 'INVALID_CREDENTIALS');

  const roleChanged = await createUser('role_changed');
  const roleCookie = await login(roleChanged);
  await pool.execute("UPDATE users SET role = 'project_owner' WHERE id = ?", [roleChanged.id]);
  await expectStatus('/auth/me', { cookie: roleCookie }, 401, 'UNAUTHORIZED');

  console.log(JSON.stringify({
    cookieSecurity: `HttpOnly; SameSite=Strict; Secure=${env.authCookie.secure}`,
    verified: [
      'password-reset-required route restriction',
      'password change rotates token version',
      'logout invalidates the previous session',
      'account disable invalidates the previous session',
      'password reset invalidates the previous session',
      'account deletion invalidates the previous session',
      'database role mismatch invalidates the previous session'
    ]
  }, null, 2));
}

try {
  await main();
} finally {
  if (createdUserIds.length) {
    const placeholders = createdUserIds.map(() => '?').join(', ');
    await pool.execute(`DELETE FROM users WHERE id IN (${placeholders})`, createdUserIds);
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
}
