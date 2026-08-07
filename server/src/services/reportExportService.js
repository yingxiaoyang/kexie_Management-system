import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { badRequest, notFound, tooManyRequests } from '../utils/errors.js';
import { normalizeReportDesignConfig, reportFilePath, reportWorkbookBuffer } from '../utils/reportDesign.js';
import { isPathInside } from '../utils/safeFiles.js';
import { normalizeScope, parseJson } from './archiveExportService.js';

const workerLockName = 'kexie_report_export_worker_lock';
const queueLockName = 'kexie_report_export_queue_lock';
export const reportExportStatuses = ['queued', 'processing', 'success', 'failed'];

function addInCondition(conditions, params, column, values) {
  if (!values.length) return;
  conditions.push(`${column} IN (${values.map(() => '?').join(',')})`);
  params.push(...values);
}

export async function reportProjects(scope) {
  const conditions = ['deleted_at IS NULL'];
  const params = [];
  addInCondition(conditions, params, 'project_year', scope.years);
  addInCondition(conditions, params, 'project_group', scope.groups);
  addInCondition(conditions, params, 'id', scope.projectIds);
  const [projects] = await pool.execute(
    `SELECT id, project_year AS projectYear, project_group AS projectGroup, project_code AS projectCode,
            title, category, approval_date AS approvalDate, approval_type AS approvalType, status, remark
     FROM projects
     WHERE ${conditions.join(' AND ')}
     ORDER BY project_year DESC, project_group, project_code, id`,
    params
  );
  if (!projects.length) return [];
  const projectIds = projects.map((project) => Number(project.id));
  const placeholders = projectIds.map(() => '?').join(',');
  const [[peopleRows], [checkRows], [reimbursementRows], [materialRows]] = await Promise.all([
    pool.execute(
      `SELECT pp.project_id AS projectId, pp.role, pp.is_primary_owner AS isPrimaryOwner,
              pe.name, pe.student_no AS studentNo, pe.teacher_no AS teacherNo,
              pe.college, pe.unit, pe.phone, pe.qq, pe.email, pe.title
       FROM project_participations pp
       JOIN people pe ON pe.id = pp.person_id AND pe.deleted_at IS NULL
       WHERE pp.deleted_at IS NULL AND pp.project_id IN (${placeholders})
       ORDER BY pp.project_id, FIELD(pp.role, 'owner', 'member', 'advisor'), pp.is_primary_owner DESC, pe.name`,
      projectIds
    ),
    pool.execute(
      `SELECT project_id AS projectId, check_phase AS phase, research_log_count AS researchLogCount,
              rating, checked_at AS checkedAt
       FROM project_check_records
       WHERE deleted_at IS NULL AND project_id IN (${placeholders})
       ORDER BY project_id, FIELD(check_phase, 'midterm', 'stage'), checked_at`,
      projectIds
    ),
    pool.execute(
      `SELECT project_id AS projectId, budget_amount AS budgetAmount,
              midterm_claim_amount AS midtermClaimAmount, midterm_actual_amount AS midtermActualAmount,
              stage_claim_amount AS stageClaimAmount, stage_actual_amount AS stageActualAmount,
              remaining_amount AS remainingAmount
       FROM reimbursement_records
       WHERE deleted_at IS NULL AND project_id IN (${placeholders})`,
      projectIds
    ),
    pool.execute(
      `SELECT mt.task_name AS taskName, mc.category_name AS categoryName, p.id AS projectId,
              latest.submission_status AS submissionStatus, latest.review_status AS reviewStatus,
              latest.submitted_at AS lastSubmittedAt
       FROM projects p
       JOIN material_tasks mt ON mt.deleted_at IS NULL AND (
         mt.project_scope_type = 'all'
         OR (mt.project_scope_type = 'year' AND mt.project_year = p.project_year)
         OR (mt.project_scope_type = 'group' AND mt.project_group = p.project_group)
         OR (mt.project_scope_type = 'custom' AND EXISTS (
           SELECT 1 FROM material_task_projects mtp WHERE mtp.material_task_id = mt.id AND mtp.project_id = p.id
         ))
       )
       JOIN material_categories mc ON mc.material_task_id = mt.id AND mc.deleted_at IS NULL
       LEFT JOIN material_submissions latest ON latest.id = (
         SELECT candidate.id FROM material_submissions candidate
         WHERE candidate.project_id = p.id
           AND candidate.material_task_id = mt.id
           AND candidate.material_category_id = mc.id
           AND candidate.deleted_at IS NULL
         ORDER BY candidate.id DESC LIMIT 1
       )
       WHERE p.deleted_at IS NULL AND p.id IN (${placeholders})
       ORDER BY p.id, mt.created_at DESC, mc.sort_order, mc.id`,
      projectIds
    )
  ]);
  const byProject = new Map(projects.map((project) => [Number(project.id), {
    ...project,
    owners: [],
    members: [],
    advisors: [],
    checks: [],
    reimbursement: null,
    materials: []
  }]));
  for (const row of peopleRows) {
    const project = byProject.get(Number(row.projectId));
    if (!project) continue;
    const collectionName = row.role === 'owner' ? 'owners' : row.role === 'advisor' ? 'advisors' : 'members';
    project[collectionName].push(row);
  }
  for (const row of checkRows) byProject.get(Number(row.projectId))?.checks.push(row);
  for (const row of reimbursementRows) {
    const project = byProject.get(Number(row.projectId));
    if (project) project.reimbursement = row;
  }
  for (const row of materialRows) byProject.get(Number(row.projectId))?.materials.push(row);
  return [...byProject.values()];
}

export function reportScopeLabel(scope) {
  const parts = [];
  if (scope.years.length) parts.push(`年度：${scope.years.join('、')}`);
  if (scope.groups.length) parts.push(`组别：${scope.groups.join('、')}`);
  if (scope.projectIds.length) parts.push(`项目：${scope.projectIds.length} 项`);
  return parts.length ? parts.join('；') : '全部项目';
}

async function withQueueLock(callback) {
  const connection = await pool.getConnection();
  let locked = false;
  try {
    const [[lockRow]] = await connection.execute('SELECT GET_LOCK(?, 5) AS lockAcquired', [queueLockName]);
    locked = Number(lockRow.lockAcquired) === 1;
    if (!locked) throw tooManyRequests('Report export queue is busy, please try again later', 'REPORT_QUEUE_BUSY');
    return await callback(connection);
  } finally {
    if (locked) await connection.execute('SELECT RELEASE_LOCK(?)', [queueLockName]).catch(() => undefined);
    connection.release();
  }
}

async function assertQueueHasCapacity(connection) {
  const [[queueCount]] = await connection.execute(
    "SELECT COUNT(*) AS total FROM report_export_records WHERE export_status IN ('queued', 'processing')"
  );
  if (Number(queueCount.total) >= env.archive.maxQueued) {
    throw tooManyRequests('Too many report exports are already queued', 'REPORT_QUEUE_FULL');
  }
}

export async function validateAndEnqueueReportExport({ userId, reportDesignId, designConfig, rawScope, layout, remark }) {
  const scope = normalizeScope(rawScope);
  const cleanRemark = String(remark || '').trim();
  if (cleanRemark.length > 1000) throw badRequest('remark is too long', 'VALIDATION_ERROR');
  let snapshot;
  let designId = null;
  if (reportDesignId) {
    const [[design]] = await pool.execute(
      "SELECT id, design_config AS designConfig FROM report_designs WHERE id = ? AND status = 'enabled' AND deleted_at IS NULL LIMIT 1",
      [reportDesignId]
    );
    if (!design) throw notFound('Enabled report design not found');
    designId = Number(design.id);
    snapshot = normalizeReportDesignConfig(design.designConfig);
  } else {
    snapshot = normalizeReportDesignConfig(designConfig);
  }
  const projects = await reportProjects(scope);
  if (!projects.length) throw badRequest('Export scope contains no projects', 'REPORT_EXPORT_EMPTY_SCOPE');
  if (projects.length > env.archive.maxProjects) {
    throw badRequest(`Export project count exceeds the configured limit of ${env.archive.maxProjects}`, 'REPORT_EXPORT_PROJECT_LIMIT');
  }
  const exportLayout = layout === 'sheets' ? 'sheets' : snapshot.export.layout;
  return withQueueLock(async (connection) => {
    await assertQueueHasCapacity(connection);
    const [result] = await connection.execute(
      `INSERT INTO report_export_records
       (export_user_id, report_design_id, export_scope, design_snapshot, export_layout, export_status, max_attempts, remark)
       VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`,
      [userId, designId, JSON.stringify(scope), JSON.stringify(snapshot), exportLayout, env.archive.maxAttempts, cleanRemark || null]
    );
    return { id: result.insertId, exportStatus: 'queued' };
  });
}

async function deleteFileIfInside(rootPath, storedPath) {
  const rawPath = typeof storedPath === 'string' ? storedPath.trim() : '';
  if (!rawPath || rawPath.includes('\0')) return { cleanupSafe: false, deleted: false };
  const rootRealPath = await fs.promises.realpath(rootPath).catch(() => null);
  if (!rootRealPath) return { cleanupSafe: false, deleted: false };
  const candidatePath = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(rootPath, rawPath);
  if (!isPathInside(rootRealPath, candidatePath)) return { cleanupSafe: false, deleted: false };
  let fileRealPath;
  try {
    fileRealPath = await fs.promises.realpath(candidatePath);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return { cleanupSafe: true, deleted: false, missing: true };
    return { cleanupSafe: false, deleted: false, error };
  }
  if (!isPathInside(rootRealPath, fileRealPath)) return { cleanupSafe: false, deleted: false };
  const stat = await fs.promises.stat(fileRealPath).catch((error) => ({ error }));
  if (stat?.error || !stat?.isFile()) return { cleanupSafe: false, deleted: false, error: stat?.error };
  try {
    await fs.promises.unlink(fileRealPath);
    return { cleanupSafe: true, deleted: true };
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return { cleanupSafe: true, deleted: false, missing: true };
    return { cleanupSafe: false, deleted: false, error };
  }
}

async function runReportExport(record) {
  const scope = normalizeScope(parseJson(record.exportScope, {}));
  const designConfig = normalizeReportDesignConfig(parseJson(record.designSnapshot, {}));
  const projects = await reportProjects(scope);
  if (projects.length > env.archive.maxProjects) {
    throw badRequest(`Export project count exceeds the configured limit of ${env.archive.maxProjects}`, 'REPORT_EXPORT_PROJECT_LIMIT');
  }
  await fs.promises.mkdir(env.archive.root, { recursive: true });
  const finalPath = reportFilePath(env.archive.root, record.id);
  const temporaryPath = `${finalPath}.tmp`;
  try {
    const temporaryCleanup = await deleteFileIfInside(env.archive.root, temporaryPath);
    if (!temporaryCleanup.cleanupSafe) throw badRequest('Previous temporary report file cannot be cleaned up', 'REPORT_EXPORT_FILE_BUSY');
    const finalCleanup = await deleteFileIfInside(env.archive.root, finalPath);
    if (!finalCleanup.cleanupSafe) throw badRequest('Previous report export file cannot be cleaned up', 'REPORT_EXPORT_FILE_BUSY');
    const buffer = await reportWorkbookBuffer(designConfig, projects, record.exportLayout);
    await fs.promises.writeFile(temporaryPath, buffer);
    await fs.promises.rename(temporaryPath, finalPath);
    const stat = await fs.promises.stat(finalPath);
    const summary = {
      projectCount: projects.length,
      layout: record.exportLayout,
      fileSize: stat.size
    };
    await pool.execute(
      `UPDATE report_export_records
       SET export_file_path = ?, export_summary = ?, export_status = 'success',
           failure_reason = NULL, worker_id = NULL, heartbeat_at = NULL, finished_at = NOW()
       WHERE id = ?`,
      [finalPath, JSON.stringify(summary), record.id]
    );
  } catch (error) {
    await fs.promises.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function markExportFailedOrRetry(record, error) {
  const reason = String(error?.message || 'Unknown report export error').slice(0, 1000);
  const exhausted = Number(record.attemptCount) >= Number(record.maxAttempts);
  if (exhausted) {
    await pool.execute(
      `UPDATE report_export_records
       SET export_status = 'failed', failure_reason = ?, worker_id = NULL, heartbeat_at = NULL, finished_at = NOW()
       WHERE id = ?`,
      [reason, record.id]
    );
    return;
  }
  await pool.execute(
    `UPDATE report_export_records
     SET export_status = 'queued', failure_reason = ?, worker_id = NULL, heartbeat_at = NULL
     WHERE id = ?`,
    [reason, record.id]
  );
}

export async function recoverTimedOutReportExports() {
  const timeoutSeconds = Math.max(1, Math.ceil(env.archive.workerTimeoutMs / 1000));
  await pool.execute(
    `UPDATE report_export_records
     SET export_status = 'failed',
         failure_reason = 'Report export worker heartbeat timed out and retry limit has been reached',
         worker_id = NULL,
         heartbeat_at = NULL,
         finished_at = NOW()
     WHERE export_status = 'processing'
       AND attempt_count >= max_attempts
       AND (heartbeat_at IS NULL OR heartbeat_at < DATE_SUB(NOW(), INTERVAL ${timeoutSeconds} SECOND))`
  );
  await pool.execute(
    `UPDATE report_export_records
     SET export_status = 'queued',
         failure_reason = 'Report export worker heartbeat timed out; task has been requeued',
         worker_id = NULL,
         heartbeat_at = NULL
     WHERE export_status = 'processing'
       AND attempt_count < max_attempts
       AND (heartbeat_at IS NULL OR heartbeat_at < DATE_SUB(NOW(), INTERVAL ${timeoutSeconds} SECOND))`
  );
}

async function claimNextReportExport(workerId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT id, export_scope AS exportScope, design_snapshot AS designSnapshot,
              export_layout AS exportLayout, attempt_count AS attemptCount, max_attempts AS maxAttempts
       FROM report_export_records
       WHERE export_status = 'queued' AND attempt_count < max_attempts
       ORDER BY created_at, id
       LIMIT 1
       FOR UPDATE SKIP LOCKED`
    );
    if (!rows[0]) {
      await connection.commit();
      return null;
    }
    await connection.execute(
      `UPDATE report_export_records
       SET export_status = 'processing', attempt_count = attempt_count + 1,
           started_at = NOW(), heartbeat_at = NOW(), worker_id = ?, finished_at = NULL
       WHERE id = ?`,
      [workerId, rows[0].id]
    );
    await connection.commit();
    return { ...rows[0], attemptCount: Number(rows[0].attemptCount) + 1 };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function processNextReportExport(workerId) {
  await recoverTimedOutReportExports();
  const lockConnection = await pool.getConnection();
  let locked = false;
  try {
    const [[lockRow]] = await lockConnection.execute('SELECT GET_LOCK(?, 0) AS lockAcquired', [workerLockName]);
    locked = Number(lockRow.lockAcquired) === 1;
    if (!locked) return false;
    const record = await claimNextReportExport(workerId);
    if (!record) return false;
    const heartbeat = setInterval(() => {
      pool.execute(
        "UPDATE report_export_records SET heartbeat_at = NOW() WHERE id = ? AND export_status = 'processing'",
        [record.id]
      ).catch((error) => console.error(`Cannot update report export heartbeat ${record.id}`, error));
    }, env.archive.workerHeartbeatMs);
    try {
      await runReportExport(record);
    } catch (error) {
      console.error(`Report export ${record.id} failed`, error);
      await markExportFailedOrRetry(record, error);
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  } finally {
    if (locked) await lockConnection.execute('SELECT RELEASE_LOCK(?)', [workerLockName]).catch(() => undefined);
    lockConnection.release();
  }
}

export async function retryReportExport(exportId) {
  await withQueueLock(async (connection) => {
    await assertQueueHasCapacity(connection);
    const [result] = await connection.execute(
      `UPDATE report_export_records
       SET export_status = 'queued', attempt_count = 0, started_at = NULL, heartbeat_at = NULL,
           worker_id = NULL, failure_reason = NULL, finished_at = NULL
       WHERE id = ? AND export_status = 'failed'`,
      [exportId]
    );
    if (!result.affectedRows) throw badRequest('Only failed report exports can be retried', 'REPORT_EXPORT_NOT_RETRYABLE');
  });
}

export async function cleanupReportStorage() {
  const days = Math.max(1, env.archive.zipRetentionDays);
  const [rows] = await pool.execute(
    `SELECT id, export_file_path AS exportFilePath
     FROM report_export_records
     WHERE export_status = 'success'
       AND export_file_path IS NOT NULL
       AND finished_at IS NOT NULL
       AND finished_at < DATE_SUB(NOW(), INTERVAL ${days} DAY)
     LIMIT 200`
  );
  for (const row of rows) {
    const cleanup = await deleteFileIfInside(env.archive.root, row.exportFilePath);
    if (cleanup.cleanupSafe) {
      await pool.execute(
        'UPDATE report_export_records SET export_file_path = NULL, file_cleanup_at = NOW() WHERE id = ?',
        [row.id]
      );
    }
  }
}

export function defaultReportWorkerId() {
  return `${os.hostname()}-${process.pid}`;
}
