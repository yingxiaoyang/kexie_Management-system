import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requireAdminPermission } from '../utils/adminPermissions.js';
import { badRequest, notFound } from '../utils/errors.js';
import { nullableText, requiredText } from '../utils/query.js';
import { success } from '../utils/response.js';

const router = Router();

router.use(requireAuth, requireRole('admin'), requireAdminPermission('participation_rules'));

function rulePayload(body, requireKey = true) {
  const limitCount = Number(body.limitCount);
  if (!Number.isInteger(limitCount) || limitCount < 1 || limitCount > 100) {
    throw badRequest('数量上限必须是 1–100 的整数', 'VALIDATION_ERROR');
  }
  const ruleKey = requireKey ? requiredText(body.ruleKey, 'ruleKey', 80) : null;
  if (ruleKey && !/^[a-z][a-z0-9_]{2,79}$/.test(ruleKey)) {
    throw badRequest('规则标识仅支持小写字母、数字和下划线', 'VALIDATION_ERROR');
  }
  return {
    ruleKey,
    ruleName: requiredText(body.ruleName, 'ruleName', 120),
    limitCount,
    enabled: body.enabled === false || body.enabled === 0 ? 0 : 1,
    remark: nullableText(body.remark, 500)
  };
}

router.get('/', async (_req, res, next) => {
  try {
    const [items] = await pool.execute(
      `SELECT id, rule_key AS ruleKey, rule_name AS ruleName, limit_count AS limitCount,
              enabled, remark, created_at AS createdAt, updated_at AS updatedAt
       FROM participation_rules ORDER BY id`
    );
    success(res, items.map((item) => ({ ...item, enabled: Boolean(item.enabled) })));
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const data = rulePayload(req.body);
    const [result] = await pool.execute(
      `INSERT INTO participation_rules (rule_key, rule_name, limit_count, enabled, remark)
       VALUES (?, ?, ?, ?, ?)`,
      [data.ruleKey, data.ruleName, data.limitCount, data.enabled, data.remark]
    );
    success(res, { id: Number(result.insertId) }, '参与规则已创建');
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      error.status = 409;
      error.code = 'DUPLICATE_RESOURCE';
      error.message = '规则标识已存在';
    }
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const data = rulePayload(req.body, false);
    const [result] = await pool.execute(
      `UPDATE participation_rules
       SET rule_name = ?, limit_count = ?, enabled = ?, remark = ?, updated_at = NOW()
       WHERE id = ?`,
      [data.ruleName, data.limitCount, data.enabled, data.remark, req.params.id]
    );
    if (!result.affectedRows) throw notFound('参与规则不存在');
    success(res, null, '参与规则已更新');
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    if (typeof req.body.enabled !== 'boolean') throw badRequest('enabled 必须是布尔值', 'VALIDATION_ERROR');
    const [result] = await pool.execute(
      'UPDATE participation_rules SET enabled = ?, updated_at = NOW() WHERE id = ?',
      [req.body.enabled ? 1 : 0, req.params.id]
    );
    if (!result.affectedRows) throw notFound('参与规则不存在');
    success(res, null, '参与规则状态已更新');
  } catch (error) {
    next(error);
  }
});

export default router;
