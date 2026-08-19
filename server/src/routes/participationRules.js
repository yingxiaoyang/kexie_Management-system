import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requireAdminPermission, requireSuperAdmin } from '../utils/adminPermissions.js';
import { badRequest, notFound } from '../utils/errors.js';
import { nullableText, paginationFrom, requiredText } from '../utils/query.js';
import { success } from '../utils/response.js';
import { csvText } from '../utils/archive.js';
import {
  manuallySetRestriction,
  reasonLabels,
  scanParticipationRestrictions
} from '../services/participationEligibilityService.js';

const router = Router();

router.use(requireAuth, requireRole('admin'), requireAdminPermission('participation_rules'));

function restrictionFilters(query) {
  const conditions = ['pr.id IS NOT NULL'];
  const params = [];
  if (query.status) {
    if (!['active', 'released'].includes(query.status)) throw badRequest('status 无效', 'VALIDATION_ERROR');
    conditions.push('pr.status = ?'); params.push(query.status);
  }
  if (query.year) {
    const year = Number(query.year);
    if (!Number.isInteger(year)) throw badRequest('year 无效', 'VALIDATION_ERROR');
    conditions.push('pr.restriction_year = ?'); params.push(year);
  }
  if (query.reason) {
    if (!Object.hasOwn(reasonLabels, query.reason)) throw badRequest('reason 无效', 'VALIDATION_ERROR');
    conditions.push('pr.trigger_reason = ?'); params.push(query.reason);
  }
  if (query.keyword) {
    const keyword = `%${String(query.keyword).trim()}%`;
    conditions.push('(pe.name LIKE ? OR pe.student_no LIKE ? OR p.project_code LIKE ? OR p.title LIKE ?)');
    params.push(keyword, keyword, keyword, keyword);
  }
  return { where: conditions.join(' AND '), params };
}

const restrictionSelect = `SELECT pr.id, pr.person_id AS personId, pe.name, pe.student_no AS studentNo,
  pr.restriction_year AS restrictionYear, pr.trigger_reason AS triggerReason,
  pr.source_project_id AS sourceProjectId, p.project_code AS sourceProjectCode, p.title AS sourceProjectTitle,
  pr.source_material_task_id AS sourceMaterialTaskId, mt.task_name AS sourceTaskName,
  pr.status, pr.trigger_source AS triggerSource, pr.triggered_at AS triggeredAt,
  trigger_user.display_name AS triggeredBy, pr.released_at AS releasedAt,
  release_user.display_name AS releasedBy, pr.release_reason AS releaseReason,
  pr.updated_at AS updatedAt
 FROM participation_restrictions pr
 JOIN people pe ON pe.id = pr.person_id
 JOIN projects p ON p.id = pr.source_project_id
 LEFT JOIN material_tasks mt ON mt.id = pr.source_material_task_id
 LEFT JOIN users trigger_user ON trigger_user.id = pr.triggered_by_user_id
 LEFT JOIN users release_user ON release_user.id = pr.released_by_user_id`;

router.get('/restrictions', async (req, res, next) => {
  try {
    const { page, pageSize, offset } = paginationFrom(req.query);
    const { where, params } = restrictionFilters(req.query);
    const [[count]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM participation_restrictions pr
       JOIN people pe ON pe.id = pr.person_id JOIN projects p ON p.id = pr.source_project_id
       WHERE ${where}`, params
    );
    const [rows] = await pool.execute(
      `${restrictionSelect} WHERE ${where} ORDER BY pr.status, pr.restriction_year DESC, pr.triggered_at DESC
       LIMIT ${pageSize} OFFSET ${offset}`, params
    );
    success(res, rows.map((row) => ({ ...row, reasonLabel: reasonLabels[row.triggerReason] })), 'ok', {
      pagination: { page, pageSize, total: Number(count.total), totalPages: Math.ceil(Number(count.total) / pageSize) }
    });
  } catch (error) { next(error); }
});

router.get('/restrictions/export', async (req, res, next) => {
  try {
    const { where, params } = restrictionFilters(req.query);
    const [rows] = await pool.execute(
      `SELECT base.*, pre.event_type AS eventType, pre.actor_source AS eventActorSource,
              pre.reason AS eventReason, pre.created_at AS eventAt, event_user.display_name AS eventActor
       FROM (${restrictionSelect} WHERE ${where}) base
       JOIN participation_restriction_events pre ON pre.restriction_id = base.id
       LEFT JOIN users event_user ON event_user.id = pre.actor_user_id
       ORDER BY pre.created_at DESC, pre.id DESC LIMIT 50000`, params
    );
    const body = csvText(
      ['记录ID', '当前状态', '限制年度', '姓名', '学号', '触发原因', '来源项目', '来源任务', '历史动作', '动作时间', '操作者', '系统来源', '动作原因'],
      rows.map((row) => [row.id, row.status === 'active' ? '活动' : '已解除', row.restrictionYear, row.name, row.studentNo,
        reasonLabels[row.triggerReason], `${row.sourceProjectCode} ${row.sourceProjectTitle}`, row.sourceTaskName || '', row.eventType,
        row.eventAt || '', row.eventActor || '系统', row.eventActorSource, row.eventReason])
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''participation-restrictions.csv");
    res.send(body);
  } catch (error) { next(error); }
});

router.get('/restrictions/:id/events', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT pre.id, pre.event_type AS eventType, pre.actor_source AS actorSource,
              pre.reason, pre.event_payload AS eventPayload, pre.created_at AS createdAt,
              u.display_name AS actorName
       FROM participation_restriction_events pre LEFT JOIN users u ON u.id = pre.actor_user_id
       WHERE pre.restriction_id = ? ORDER BY pre.id`, [req.params.id]
    );
    success(res, rows);
  } catch (error) { next(error); }
});

router.post('/restrictions/scan', requireSuperAdmin, async (req, res, next) => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const result = await scanParticipationRestrictions(connection, {
      materialTaskId: req.body.materialTaskId ? Number(req.body.materialTaskId) : null,
      actorUserId: req.user.id, triggerSource: 'manual_scan'
    });
    await connection.commit();
    success(res, result, '逾期必填材料扫描完成');
  } catch (error) { await connection?.rollback().catch(() => undefined); next(error); }
  finally { connection?.release(); }
});

router.patch('/restrictions/:id/status', requireSuperAdmin, async (req, res, next) => {
  let connection;
  try {
    const reason = requiredText(req.body.reason, 'reason', 1000);
    const status = String(req.body.status || '');
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await manuallySetRestriction(connection, req.params.id, status, req.user.id, reason);
    await connection.commit();
    success(res, null, status === 'active' ? '限制已恢复' : '限制已解除');
  } catch (error) { await connection?.rollback().catch(() => undefined); next(error); }
  finally { connection?.release(); }
});

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
