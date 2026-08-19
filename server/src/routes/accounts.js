import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requireSuperAdmin, normalizePermissionKeys, normalizeStudentNumber } from '../utils/adminPermissions.js';
import { badRequest, notFound } from '../utils/errors.js';
import { enumValue, paginationFrom, requiredText } from '../utils/query.js';
import { success } from '../utils/response.js';

const router = Router();

router.use(requireAuth, requireRole('admin'), requireSuperAdmin);

function initialPassword() {
  return `Kx!${crypto.randomBytes(6).toString('base64url')}9a`;
}

function splitPermissionKeys(value) {
  return value ? String(value).split(',').filter(Boolean) : [];
}

async function permissionsForUser(connection, userId) {
  const [rows] = await connection.execute(
    'SELECT permission_key AS permissionKey FROM admin_user_permissions WHERE user_id = ? ORDER BY permission_key',
    [userId]
  );
  return rows.map((row) => row.permissionKey);
}

async function replacePermissions(connection, targetUserId, permissionKeys, actorUserId) {
  await connection.execute('DELETE FROM admin_user_permissions WHERE user_id = ?', [targetUserId]);
  for (const permissionKey of permissionKeys) {
    await connection.execute(
      'INSERT INTO admin_user_permissions (user_id, permission_key, granted_by) VALUES (?, ?, ?)',
      [targetUserId, permissionKey, actorUserId]
    );
  }
}

async function appendAdminAudit(connection, {
  actorUserId, targetUserId, action, beforePermissions = [], afterPermissions = [], payload = {}
}) {
  await connection.execute(
    `INSERT INTO admin_permission_audit_events
     (actor_user_id, target_user_id, action, before_permissions, after_permissions, event_payload)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [actorUserId, targetUserId, action, JSON.stringify(beforePermissions), JSON.stringify(afterPermissions), JSON.stringify(payload)]
  );
}

async function lockedTargetAccount(connection, id) {
  const [[user]] = await connection.execute(
    `SELECT id, username, display_name, role, admin_level, status, person_id
     FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
    [id]
  );
  if (!user) throw notFound('账号不存在');
  if (user.role === 'admin' && user.admin_level === 'super') {
    throw badRequest('唯一超级管理员不能被停用、删除、重置或降级', 'SUPER_ADMIN_PROTECTED');
  }
  return user;
}

router.get('/permission-catalog', async (_req, res, next) => {
  try {
    const [items] = await pool.execute(
      `SELECT permission_key AS permissionKey, permission_name AS permissionName, description, sort_order AS sortOrder
       FROM admin_permission_definitions ORDER BY sort_order, permission_key`
    );
    success(res, items);
  } catch (error) {
    next(error);
  }
});

router.get('/permission-audits', async (req, res, next) => {
  try {
    const { page, pageSize, offset } = paginationFrom(req.query);
    const params = [];
    const conditions = [];
    if (req.query.targetUserId) {
      conditions.push('audit.target_user_id = ?');
      params.push(Number(req.query.targetUserId));
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [[countRow]] = await pool.execute(`SELECT COUNT(*) AS total FROM admin_permission_audit_events audit ${where}`, params);
    const [items] = await pool.execute(
      `SELECT audit.id, audit.action, audit.before_permissions AS beforePermissions,
              audit.after_permissions AS afterPermissions, audit.event_payload AS eventPayload,
              audit.created_at AS createdAt, actor.display_name AS actorName,
              target.display_name AS targetName, target.username AS targetUsername
       FROM admin_permission_audit_events audit
       JOIN users actor ON actor.id = audit.actor_user_id
       JOIN users target ON target.id = audit.target_user_id
       ${where}
       ORDER BY audit.id DESC LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    success(res, items, 'ok', {
      pagination: { page, pageSize, total: Number(countRow.total), totalPages: Math.ceil(Number(countRow.total) / pageSize) }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req, res, next) => {
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
      `SELECT u.id, u.username, u.display_name AS displayName, u.role, u.admin_level AS adminLevel,
              u.status, u.person_id AS personId, pe.name AS personName,
              u.password_reset_required AS passwordResetRequired, u.last_login_at AS lastLoginAt,
              (SELECT GROUP_CONCAT(aup.permission_key ORDER BY apd.sort_order SEPARATOR ',')
               FROM admin_user_permissions aup
               JOIN admin_permission_definitions apd ON apd.permission_key = aup.permission_key
               WHERE aup.user_id = u.id) AS permissionKeys
       FROM users u LEFT JOIN people pe ON pe.id = u.person_id
       WHERE ${where} ORDER BY FIELD(u.role, 'admin', 'project_owner', 'applicant'), u.id DESC
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    success(res, items.map((item) => ({
      ...item,
      passwordResetRequired: Boolean(item.passwordResetRequired),
      permissionKeys: splitPermissionKeys(item.permissionKeys)
    })), 'ok', {
      pagination: { page, pageSize, total: Number(countRow.total), totalPages: Math.ceil(Number(countRow.total) / pageSize) }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  let connection;
  let transactionActive = false;
  try {
    const role = enumValue(req.body.role, ['admin', 'project_owner'], 'role');
    const password = req.body.initialPassword || initialPassword();
    if (String(password).length < 8) throw badRequest('初始密码至少需要 8 位', 'VALIDATION_ERROR');

    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionActive = true;

    let username;
    let displayName;
    let personId = null;
    let adminLevel = null;
    let permissionKeys = [];

    if (role === 'admin') {
      username = requiredText(req.body.username, 'username', 80);
      displayName = requiredText(req.body.displayName, 'displayName', 80);
      if (!/^[A-Za-z0-9_.-]{4,80}$/.test(username)) {
        throw badRequest('管理员账号仅支持 4–80 位字母、数字及 ._-', 'VALIDATION_ERROR');
      }
      adminLevel = 'limited';
      permissionKeys = normalizePermissionKeys(req.body.permissionKeys || []);
    } else {
      personId = Number(req.body.personId);
      if (!personId) throw badRequest('请选择要开通账号的学生', 'VALIDATION_ERROR');
      const [[person]] = await connection.execute(
        `SELECT id, name, student_no FROM people
         WHERE id = ? AND person_type = 'student' AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
        [personId]
      );
      if (!person) throw notFound('学生人员记录不存在');
      username = normalizeStudentNumber(person.student_no);
      displayName = person.name;
      if (!username || !/^[A-Za-z0-9-]{4,40}$/.test(username)) {
        throw badRequest('该学生没有有效学号，无法开通负责人账号', 'STUDENT_NUMBER_INVALID');
      }
      const [[boundUser]] = await connection.execute('SELECT id, role, deleted_at FROM users WHERE person_id = ? LIMIT 1 FOR UPDATE', [personId]);
      if (boundUser) throw badRequest('该学生已绑定账号，不能重复开通', 'PERSON_ACCOUNT_ALREADY_BOUND');
    }

    const [[usernameUser]] = await connection.execute('SELECT id FROM users WHERE username = ? LIMIT 1 FOR UPDATE', [username]);
    if (usernameUser) {
      throw badRequest(role === 'project_owner' ? '该学号已存在账号' : '管理员账号已存在', 'DUPLICATE_RESOURCE');
    }

    const passwordHash = await bcrypt.hash(String(password), 12);
    const [result] = await connection.execute(
      `INSERT INTO users
       (username, display_name, password_hash, role, admin_level, status, person_id, password_reset_required)
       VALUES (?, ?, ?, ?, ?, 'enabled', ?, 1)`,
      [username, displayName, passwordHash, role, adminLevel, personId]
    );
    const userId = Number(result.insertId);
    if (personId) await connection.execute("UPDATE people SET account_status = 'enabled', updated_at = NOW() WHERE id = ?", [personId]);
    if (role === 'admin') {
      await replacePermissions(connection, userId, permissionKeys, req.user.id);
      await appendAdminAudit(connection, {
        actorUserId: req.user.id, targetUserId: userId, action: 'admin_created', afterPermissions: permissionKeys,
        payload: { username, displayName, adminLevel: 'limited' }
      });
    }
    await connection.commit();
    transactionActive = false;
    success(res, { id: userId, username, initialPassword: password }, role === 'admin' ? '小管理员已创建' : '负责人账号已创建');
  } catch (error) {
    if (connection && transactionActive) await connection.rollback().catch(() => undefined);
    if (error.code === 'ER_DUP_ENTRY') {
      error.status = 409;
      error.code = 'DUPLICATE_RESOURCE';
      error.message = '账号或学号已存在';
    }
    next(error);
  } finally {
    connection?.release();
  }
});

router.put('/:id/permissions', async (req, res, next) => {
  let connection;
  let transactionActive = false;
  try {
    const permissionKeys = normalizePermissionKeys(req.body.permissionKeys);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionActive = true;
    const target = await lockedTargetAccount(connection, req.params.id);
    if (target.role !== 'admin' || target.admin_level !== 'limited') {
      throw badRequest('只能配置小管理员权限', 'ADMIN_PERMISSIONS_TARGET_INVALID');
    }
    const beforePermissions = await permissionsForUser(connection, target.id);
    await replacePermissions(connection, target.id, permissionKeys, req.user.id);
    await connection.execute('UPDATE users SET token_version = token_version + 1, updated_at = NOW() WHERE id = ?', [target.id]);
    await appendAdminAudit(connection, {
      actorUserId: req.user.id, targetUserId: target.id, action: 'permissions_changed', beforePermissions, afterPermissions: permissionKeys
    });
    await connection.commit();
    transactionActive = false;
    success(res, { permissionKeys }, '权限已更新，旧会话已失效');
  } catch (error) {
    if (connection && transactionActive) await connection.rollback().catch(() => undefined);
    next(error);
  } finally {
    connection?.release();
  }
});

router.patch('/:id/status', async (req, res, next) => {
  let connection;
  let transactionActive = false;
  try {
    const status = enumValue(req.body.status, ['enabled', 'disabled'], 'status');
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionActive = true;
    const target = await lockedTargetAccount(connection, req.params.id);
    await connection.execute('UPDATE users SET status = ?, token_version = token_version + 1, updated_at = NOW() WHERE id = ?', [status, target.id]);
    if (target.person_id) await connection.execute('UPDATE people SET account_status = ?, updated_at = NOW() WHERE id = ?', [status, target.person_id]);
    if (target.role === 'admin') {
      const permissions = await permissionsForUser(connection, target.id);
      await appendAdminAudit(connection, {
        actorUserId: req.user.id, targetUserId: target.id, action: 'status_changed',
        beforePermissions: permissions, afterPermissions: permissions, payload: { from: target.status, to: status }
      });
    }
    await connection.commit();
    transactionActive = false;
    success(res, null, '账号状态已更新');
  } catch (error) {
    if (connection && transactionActive) await connection.rollback().catch(() => undefined);
    next(error);
  } finally {
    connection?.release();
  }
});

router.post('/:id/reset-password', async (req, res, next) => {
  let connection;
  let transactionActive = false;
  try {
    const password = req.body.initialPassword || initialPassword();
    if (String(password).length < 8) throw badRequest('密码至少需要 8 位', 'VALIDATION_ERROR');
    const hash = await bcrypt.hash(String(password), 12);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionActive = true;
    const target = await lockedTargetAccount(connection, req.params.id);
    await connection.execute(
      `UPDATE users SET password_hash = ?, password_reset_required = 1, status = 'enabled',
       token_version = token_version + 1, failed_login_attempts = 0, locked_until = NULL,
       last_failed_login_at = NULL, updated_at = NOW() WHERE id = ?`,
      [hash, target.id]
    );
    if (target.person_id) await connection.execute("UPDATE people SET account_status = 'enabled', updated_at = NOW() WHERE id = ?", [target.person_id]);
    if (target.role === 'admin') {
      const permissions = await permissionsForUser(connection, target.id);
      await appendAdminAudit(connection, {
        actorUserId: req.user.id, targetUserId: target.id, action: 'password_reset',
        beforePermissions: permissions, afterPermissions: permissions
      });
    }
    await connection.commit();
    transactionActive = false;
    success(res, { initialPassword: password }, '密码已重置');
  } catch (error) {
    if (connection && transactionActive) await connection.rollback().catch(() => undefined);
    next(error);
  } finally {
    connection?.release();
  }
});

router.delete('/:id', async (req, res, next) => {
  let connection;
  let transactionActive = false;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionActive = true;
    const target = await lockedTargetAccount(connection, req.params.id);
    const beforePermissions = target.role === 'admin' ? await permissionsForUser(connection, target.id) : [];
    if (target.role === 'admin') {
      await connection.execute('DELETE FROM admin_user_permissions WHERE user_id = ?', [target.id]);
      await appendAdminAudit(connection, {
        actorUserId: req.user.id, targetUserId: target.id, action: 'admin_deleted', beforePermissions,
        payload: { username: target.username, displayName: target.display_name }
      });
    }
    await connection.execute(
      "UPDATE users SET status = 'disabled', token_version = token_version + 1, deleted_at = NOW(), updated_at = NOW() WHERE id = ?",
      [target.id]
    );
    if (target.person_id) await connection.execute("UPDATE people SET account_status = 'none', updated_at = NOW() WHERE id = ?", [target.person_id]);
    await connection.commit();
    transactionActive = false;
    success(res, null, '账号已删除');
  } catch (error) {
    if (connection && transactionActive) await connection.rollback().catch(() => undefined);
    next(error);
  } finally {
    connection?.release();
  }
});

export default router;
