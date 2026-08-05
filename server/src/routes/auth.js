import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { badRequest, unauthorized } from '../utils/errors.js';
import { success } from '../utils/response.js';

const router = Router();

function signUser(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      personId: user.person_id
    },
    env.jwt.secret,
    { expiresIn: env.jwt.expiresIn }
  );
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    status: user.status,
    personId: user.person_id,
    passwordResetRequired: Boolean(user.password_reset_required)
  };
}

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      throw badRequest('Username and password are required');
    }

    const [rows] = await pool.execute(
      'SELECT * FROM users WHERE username = ? LIMIT 1',
      [username]
    );

    const user = rows[0];
    if (!user || user.status !== 'enabled') {
      throw unauthorized('Invalid username or password', 'INVALID_CREDENTIALS');
    }

    const matched = await bcrypt.compare(password, user.password_hash);
    if (!matched) {
      throw unauthorized('Invalid username or password', 'INVALID_CREDENTIALS');
    }

    await pool.execute('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

    success(res, {
      token: signUser(user),
      user: publicUser(user)
    });
  } catch (error) {
    next(error);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, username, display_name, role, status, person_id, password_reset_required FROM users WHERE id = ? LIMIT 1',
      [req.user.id]
    );
    const user = rows[0];
    if (!user || user.status !== 'enabled') {
      throw unauthorized('Login has expired');
    }
    success(res, publicUser(user));
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
    await pool.execute(
      'UPDATE users SET password_hash = ?, password_reset_required = 0, updated_at = NOW() WHERE id = ?',
      [passwordHash, user.id]
    );

    success(res, null, 'Password changed');
  } catch (error) {
    next(error);
  }
});

export default router;
