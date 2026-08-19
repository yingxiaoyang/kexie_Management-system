import { pool } from '../db/pool.js';
import { badRequest, forbidden } from './errors.js';

export const ADMIN_PERMISSION_KEYS = Object.freeze([
  'project_management',
  'people_management',
  'data_import',
  'material_task',
  'material_review',
  'application_management',
  'archive_management',
  'report_management',
  'participation_rules'
]);

const ADMIN_PERMISSION_SET = new Set(ADMIN_PERMISSION_KEYS);

export function normalizeStudentNumber(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function normalizePermissionKeys(values) {
  if (!Array.isArray(values)) {
    throw badRequest('permissionKeys 必须是数组', 'VALIDATION_ERROR');
  }
  const keys = [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
  const invalid = keys.filter((key) => !ADMIN_PERMISSION_SET.has(key));
  if (invalid.length) {
    throw badRequest(`存在无效权限：${invalid.join('、')}`, 'INVALID_ADMIN_PERMISSION');
  }
  return ADMIN_PERMISSION_KEYS.filter((key) => keys.includes(key));
}

export function hasAdminPermission(user, permissionKey) {
  if (user?.role !== 'admin') return false;
  if (user.adminLevel === 'super') return true;
  return user.adminLevel === 'limited' && user.permissions?.includes(permissionKey);
}

export async function loadAdminPermissions(userId, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT permission_key AS permissionKey
     FROM admin_user_permissions
     WHERE user_id = ?
     ORDER BY permission_key`,
    [userId]
  );
  return rows.map((row) => row.permissionKey);
}

export function requireAdminPermission(permissionKey) {
  if (!ADMIN_PERMISSION_SET.has(permissionKey)) {
    throw new Error(`Unknown administrator permission: ${permissionKey}`);
  }
  return (req, res, next) => {
    if (!hasAdminPermission(req.user, permissionKey)) {
      next(forbidden('当前管理员未获授此模块权限', 'ADMIN_PERMISSION_REQUIRED'));
      return;
    }
    next();
  };
}

export function requirePermissionWhenAdmin(permissionKey) {
  const check = requireAdminPermission(permissionKey);
  return (req, res, next) => {
    if (req.user?.role !== 'admin') {
      next();
      return;
    }
    check(req, res, next);
  };
}

export function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== 'admin' || req.user.adminLevel !== 'super') {
    next(forbidden('仅超级管理员可以执行此操作', 'SUPER_ADMIN_REQUIRED'));
    return;
  }
  next();
}
