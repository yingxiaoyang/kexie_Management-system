import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { clearAuthCookie, setAuthCookie, signUserToken } from '../utils/authSession.js';
import { badRequest, unauthorized } from '../utils/errors.js';
import { success } from '../utils/response.js';

const router = Router();

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

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      throw badRequest('Username and password are required');
    }

    const [rows] = await pool.execute(
      'SELECT * FROM users WHERE username = ? AND deleted_at IS NULL LIMIT 1',
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

    setAuthCookie(res, signUserToken(user));
    success(res, { user: publicUser(user) });
  } catch (error) {
    next(error);
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
