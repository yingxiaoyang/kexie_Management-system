import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { readAuthToken } from '../utils/authSession.js';
import { unauthorized, forbidden } from '../utils/errors.js';
import { loadAdminPermissions } from '../utils/adminPermissions.js';

const PASSWORD_RESET_ALLOWED_PATHS = new Set(['/me', '/change-password', '/logout']);

function allowsPasswordResetRequired(req) {
  return req.baseUrl === '/api/auth' && PASSWORD_RESET_ALLOWED_PATHS.has(req.path);
}

export async function requireAuth(req, res, next) {
  const token = readAuthToken(req);

  if (!token) {
    next(unauthorized('Please login first'));
    return;
  }

  let payload;
  try {
    payload = jwt.verify(token, env.jwt.secret);
  } catch {
    next(unauthorized('Login has expired'));
    return;
  }

  try {
    const [rows] = await pool.execute(
      `SELECT id, username, display_name, role, admin_level, status, person_id, password_reset_required, token_version, deleted_at
       FROM users WHERE id = ? LIMIT 1`,
      [payload.id]
    );
    const user = rows[0];
    const tokenVersion = Number(payload.tokenVersion);
    if (!user
      || user.deleted_at
      || user.status !== 'enabled'
      || payload.role !== user.role
      || !Number.isInteger(tokenVersion)
      || tokenVersion !== Number(user.token_version)) {
      next(unauthorized('Login has expired'));
      return;
    }

    const permissions = user.role === 'admin' && user.admin_level === 'limited'
      ? await loadAdminPermissions(user.id)
      : [];
    req.user = {
      id: Number(user.id),
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      adminLevel: user.admin_level ?? null,
      permissions,
      status: user.status,
      personId: user.person_id === null ? null : Number(user.person_id),
      passwordResetRequired: Boolean(user.password_reset_required),
      tokenVersion: Number(user.token_version)
    };

    if (req.user.passwordResetRequired && !allowsPasswordResetRequired(req)) {
      next(forbidden('Please change your password before continuing', 'PASSWORD_CHANGE_REQUIRED'));
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      next(forbidden('No permission for this operation'));
      return;
    }
    next();
  };
}
