import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { clearAuthCookie, setAuthCookie, signUserToken } from '../utils/authSession.js';
import { badRequest, locked, tooManyRequests, unauthorized } from '../utils/errors.js';
import { success } from '../utils/response.js';
import { logSecurityEvent } from '../utils/securityLog.js';

const router = Router();

function rateLimitHandler(event) {
  return (req, res, next) => {
    logSecurityEvent(event, { ip: req.ip, path: req.path });
    next(tooManyRequests('Too many login attempts. Please try again later.', 'LOGIN_RATE_LIMITED'));
  };
}

const loginIpLimiter = rateLimit({
  windowMs: env.security.loginWindowMs,
  limit: () => env.security.loginIpMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: rateLimitHandler('login_ip_rate_limited')
});

const adminLoginIpLimiter = rateLimit({
  windowMs: env.security.loginWindowMs,
  limit: () => env.security.adminLoginIpMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: rateLimitHandler('admin_login_ip_rate_limited')
});

const registrationIpLimiter = rateLimit({
  windowMs: env.security.registrationWindowMs,
  limit: () => env.security.registrationIpMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: rateLimitHandler('registration_ip_rate_limited')
});

function registrationText(value, field, maxLength) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > maxLength) {
    throw badRequest(`${field} is required and must not exceed ${maxLength} characters`, 'VALIDATION_ERROR');
  }
  return text;
}

router.post('/register', registrationIpLimiter, async (req, res, next) => {
  let connection;
  let transactionActive = false;
  try {
    const username = registrationText(req.body?.username, 'username', 40);
    const studentNo = registrationText(req.body?.studentNo, 'studentNo', 40);
    const name = registrationText(req.body?.name, 'name', 80);
    const college = registrationText(req.body?.college, 'college', 120);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() || null : null;
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() || null : null;
    if (!/^[A-Za-z0-9_.-]{4,40}$/.test(username)) {
      throw badRequest('Username may only contain letters, numbers, dot, underscore and hyphen', 'VALIDATION_ERROR');
    }
    if (!/^[A-Za-z0-9-]{4,40}$/.test(studentNo)) {
      throw badRequest('Student number format is invalid', 'VALIDATION_ERROR');
    }
    if (password.length < 10 || password.length > 72 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      throw badRequest('Password must be 10-72 characters and contain letters and numbers', 'VALIDATION_ERROR');
    }
    if (phone && !/^[0-9+()\s-]{6,40}$/.test(phone)) {
      throw badRequest('Phone format is invalid', 'VALIDATION_ERROR');
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw badRequest('Email format is invalid', 'VALIDATION_ERROR');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionActive = true;
    const [[existing]] = await connection.execute(
      `SELECT 1 FROM users WHERE username = ?
       UNION ALL SELECT 1 FROM people WHERE student_no = ? LIMIT 1`,
      [username, studentNo]
    );
    if (existing) {
      const error = badRequest('Student number or username already exists', 'DUPLICATE_RESOURCE');
      error.status = 409;
      throw error;
    }
    const [personResult] = await connection.execute(
      `INSERT INTO people (person_type, name, student_no, college, phone, email, account_status)
       VALUES ('student', ?, ?, ?, ?, ?, 'enabled')`,
      [name, studentNo, college, phone, email]
    );
    const [userResult] = await connection.execute(
      `INSERT INTO users
       (username, display_name, password_hash, role, status, person_id, password_reset_required)
       VALUES (?, ?, ?, 'applicant', 'enabled', ?, 0)`,
      [username, name, passwordHash, personResult.insertId]
    );
    await connection.commit();
    transactionActive = false;
    logSecurityEvent('applicant_registered', { ip: req.ip, userId: Number(userResult.insertId) });
    success(res, { userId: Number(userResult.insertId), role: 'applicant' }, 'Registration successful');
  } catch (error) {
    if (connection && transactionActive) await connection.rollback().catch(() => undefined);
    if (error.code === 'ER_DUP_ENTRY') {
      error.status = 409;
      error.code = 'DUPLICATE_RESOURCE';
      error.message = 'Student number or username already exists';
    }
    next(error);
  } finally {
    connection?.release();
  }
});

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name ?? user.displayName,
    role: user.role,
    status: user.status,
    personId: user.person_id ?? user.personId ?? null,
    passwordResetRequired: Boolean(user.password_reset_required ?? user.passwordResetRequired)
  };
}

async function identifyLoginAccount(req, res, next) {
  try {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    if (!username) {
      req.loginAccount = null;
      next();
      return;
    }
    const [[user]] = await pool.execute(
      'SELECT id, role FROM users WHERE username = ? AND deleted_at IS NULL LIMIT 1',
      [username]
    );
    req.loginAccount = user || null;
    next();
  } catch (error) {
    next(error);
  }
}

function applyAdminLoginLimit(req, res, next) {
  if (req.loginAccount?.role === 'admin') {
    adminLoginIpLimiter(req, res, next);
    return;
  }
  next();
}

router.post('/login', loginIpLimiter, identifyLoginAccount, applyAdminLoginLimit, async (req, res, next) => {
  let connection;
  let transactionActive = false;
  try {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!username || !password) {
      throw badRequest('Username and password are required');
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionActive = true;
    const [rows] = await connection.execute(
      'SELECT * FROM users WHERE username = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
      [username]
    );

    const user = rows[0];
    if (!user || user.status !== 'enabled') {
      await connection.commit();
      transactionActive = false;
      logSecurityEvent('login_failed', { ip: req.ip, reason: 'invalid_account_state' });
      throw unauthorized('Invalid username or password', 'INVALID_CREDENTIALS');
    }

    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      await connection.commit();
      transactionActive = false;
      logSecurityEvent('login_blocked_account_locked', {
        ip: req.ip,
        userId: Number(user.id),
        role: user.role,
        reason: 'temporary_lock_active'
      });
      throw locked('Account is temporarily locked. Please try again later.');
    }

    const matched = await bcrypt.compare(password, user.password_hash);
    if (!matched) {
      const lockExpired = Boolean(user.locked_until)
        && new Date(user.locked_until).getTime() <= Date.now();
      const failedAttempts = (lockExpired ? 0 : Number(user.failed_login_attempts || 0)) + 1;
      const shouldLock = failedAttempts >= env.security.accountFailureLimit;
      const lockMinutes = user.role === 'admin'
        ? env.security.adminAccountLockMinutes
        : env.security.accountLockMinutes;
      const lockedUntil = shouldLock ? new Date(Date.now() + lockMinutes * 60 * 1000) : null;
      await connection.execute(
        `UPDATE users
         SET failed_login_attempts = ?,
             last_failed_login_at = NOW(),
             locked_until = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [failedAttempts, lockedUntil, user.id]
      );
      await connection.commit();
      transactionActive = false;
      logSecurityEvent(shouldLock ? 'account_temporarily_locked' : 'login_failed', {
        ip: req.ip,
        userId: Number(user.id),
        role: user.role,
        reason: shouldLock ? 'failure_limit_reached' : 'invalid_password'
      });
      if (shouldLock) {
        throw locked('Account is temporarily locked. Please try again later.');
      }
      throw unauthorized('Invalid username or password', 'INVALID_CREDENTIALS');
    }

    await connection.execute(
      `UPDATE users
       SET last_login_at = NOW(), failed_login_attempts = 0, locked_until = NULL,
           last_failed_login_at = NULL, updated_at = NOW()
       WHERE id = ?`,
      [user.id]
    );
    await connection.commit();
    transactionActive = false;

    setAuthCookie(res, signUserToken(user));
    success(res, { user: publicUser(user) });
  } catch (error) {
    if (connection && transactionActive) {
      try {
        await connection.rollback();
      } catch {
        // The transaction may already be committed. Never include request data in logs.
      }
    }
    next(error);
  } finally {
    connection?.release();
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    success(res, publicUser(req.user));
  } catch (error) {
    next(error);
  }
});

router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      throw badRequest('Old password and new password are required');
    }
    if (newPassword.length < 8) {
      throw badRequest('New password must be at least 8 characters', 'PASSWORD_TOO_SHORT');
    }

    const [rows] = await pool.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [req.user.id]);
    const user = rows[0];
    if (!user || user.status !== 'enabled') {
      throw unauthorized('Login has expired');
    }

    const matched = await bcrypt.compare(oldPassword, user.password_hash);
    if (!matched) {
      throw unauthorized('Old password is incorrect', 'INVALID_OLD_PASSWORD');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const [result] = await pool.execute(
      `UPDATE users
       SET password_hash = ?, password_reset_required = 0, token_version = token_version + 1, updated_at = NOW()
       WHERE id = ? AND token_version = ? AND deleted_at IS NULL`,
      [passwordHash, user.id, req.user.tokenVersion]
    );
    if (!result.affectedRows) throw unauthorized('Login has expired');

    const [[updatedUser]] = await pool.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [user.id]);
    setAuthCookie(res, signUserToken(updatedUser));
    success(res, { user: publicUser(updatedUser) }, 'Password changed');
  } catch (error) {
    next(error);
  }
});

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await pool.execute(
      'UPDATE users SET token_version = token_version + 1, updated_at = NOW() WHERE id = ? AND token_version = ?',
      [req.user.id, req.user.tokenVersion]
    );
    clearAuthCookie(res);
    success(res, null, 'Logged out');
  } catch (error) {
    next(error);
  }
});

export default router;
