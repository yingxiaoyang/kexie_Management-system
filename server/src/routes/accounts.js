import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { badRequest, notFound } from '../utils/errors.js';
import { enumValue, paginationFrom, requiredText } from '../utils/query.js';
import { success } from '../utils/response.js';

const router = Router();

function initialPassword() {
  return `Kx!${crypto.randomBytes(6).toString('base64url')}9a`;
}

router.get('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { page, pageSize, offset } = paginationFrom(req.query);
    const conditions = ['u.deleted_at IS NULL'];
    const params = [];
    if (req.query.role) {
      conditions.push('u.role = ?');
      params.push(req.query.role);
    }
    if (req.query.keyword) {
      const keyword = `%${String(req.query.keyword).trim()}%`;
      conditions.push('(u.username LIKE ? OR u.display_name LIKE ? OR pe.name LIKE ?)');
      params.push(keyword, keyword, keyword);
    }
    const where = conditions.join(' AND ');
    const [[countRow]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM users u LEFT JOIN people pe ON pe.id = u.person_id WHERE ${where}`,
      params
    );
    const [items] = await pool.execute(
      `SELECT u.id, u.username, u.display_name AS displayName, u.role, u.status, u.person_id AS personId,
              pe.name AS personName, u.password_reset_required AS passwordResetRequired, u.last_login_at AS lastLoginAt
       FROM users u LEFT JOIN people pe ON pe.id = u.person_id
       WHERE ${where} ORDER BY u.id DESC LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    success(res, items, 'ok', {
      pagination: { page, pageSize, total: Number(countRow.total), totalPages: Math.ceil(Number(countRow.total) / pageSize) }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const role = enumValue(req.body.role, ['admin', 'project_owner'], 'role');
    const personId = role === 'project_owner' ? Number(req.body.personId) : null;
    if (role === 'project_owner' && !personId) throw badRequest('personId is required', 'VALIDATION_ERROR');
    const username = requiredText(req.body.username, 'username', 80);
    const displayName = requiredText(req.body.displayName, 'displayName', 80);
    const password = req.body.initialPassword || initialPassword();
    if (String(password).length < 8) throw badRequest('Initial password must be at least 8 characters', 'VALIDATION_ERROR');
    if (personId) {
      const [[person]] = await pool.execute('SELECT id FROM people WHERE id = ? AND deleted_at IS NULL LIMIT 1', [personId]);
      if (!person) throw notFound('Person not found');
    }
    const passwordHash = await bcrypt.hash(String(password), 12);
    const [result] = await pool.execute(
      `INSERT INTO users (username, display_name, password_hash, role, status, person_id, password_reset_required)
       VALUES (?, ?, ?, ?, 'enabled', ?, 1)`,
      [username, displayName, passwordHash, role, personId]
    );
    if (personId) await pool.execute("UPDATE people SET account_status = 'enabled' WHERE id = ?", [personId]);
    success(res, { id: result.insertId, initialPassword: password }, 'Account created');
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      error.status = 409;
      error.code = 'DUPLICATE_RESOURCE';
      error.message = 'Username already exists';
    }
    next(error);
  }
});

router.patch('/:id/status', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const status = enumValue(req.body.status, ['enabled', 'disabled', 'locked'], 'status');
    if (Number(req.params.id) === Number(req.user.id) && status !== 'enabled') {
      throw badRequest('You cannot disable your own account', 'VALIDATION_ERROR');
    }
    const [result] = await pool.execute('UPDATE users SET status = ?, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL', [status, req.params.id]);
    if (!result.affectedRows) throw notFound('Account not found');
    success(res, null, 'Account status updated');
  } catch (error) {
    next(error);
  }
});

router.post('/:id/reset-password', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const password = req.body.initialPassword || initialPassword();
    if (String(password).length < 8) throw badRequest('Password must be at least 8 characters', 'VALIDATION_ERROR');
    const hash = await bcrypt.hash(String(password), 12);
    const [result] = await pool.execute(
      'UPDATE users SET password_hash = ?, password_reset_required = 1, status = \'enabled\', updated_at = NOW() WHERE id = ? AND deleted_at IS NULL',
      [hash, req.params.id]
    );
    if (!result.affectedRows) throw notFound('Account not found');
    success(res, { initialPassword: password }, 'Password reset');
  } catch (error) {
    next(error);
  }
});

export default router;
