import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../src/config/env.js';
import { pool } from '../src/db/pool.js';
import {
  cleanupArchiveStorage,
  processNextArchiveExport,
  recoverTimedOutArchiveExports,
  retryArchiveExport,
  validateAndEnqueueArchiveExport
} from '../src/services/archiveExportService.js';

const batchDir = path.resolve(env.upload.root, '../imports/batches');

async function createTemplate(adminId, name, templateConfig) {
  const [result] = await pool.execute(
    `INSERT INTO archive_templates (template_name, template_config, status, created_by)
     VALUES (?, ?, 'enabled', ?)`,
    [name, JSON.stringify(templateConfig), adminId]
  );
  return result.insertId;
}

async function firstExportTarget() {
  const [rows] = await pool.execute(
    `SELECT mt.id AS taskId, p.id AS projectId, p.project_year AS projectYear
     FROM material_tasks mt
     JOIN projects p ON p.deleted_at IS NULL AND (
       mt.project_scope_type = 'all'
       OR (mt.project_scope_type = 'year' AND mt.project_year = p.project_year)
       OR (mt.project_scope_type = 'group' AND mt.project_group = p.project_group)
       OR (mt.project_scope_type = 'custom' AND EXISTS (
         SELECT 1 FROM material_task_projects mtp WHERE mtp.material_task_id = mt.id AND mtp.project_id = p.id
       ))
     )
     WHERE mt.deleted_at IS NULL AND mt.status IN ('published', 'closed')
     ORDER BY mt.id, p.id LIMIT 1`
  );
  return rows[0];
}

async function deleteExportRecord(id) {
  if (!id) return;
  const [[record]] = await pool.execute('SELECT export_file_path AS exportFilePath FROM archive_export_records WHERE id = ?', [id]);
  if (record?.exportFilePath) await fs.unlink(record.exportFilePath).catch(() => undefined);
  await pool.execute('DELETE FROM archive_export_records WHERE id = ?', [id]);
}

async function main() {
  const [[admin]] = await pool.execute(
    "SELECT id FROM users WHERE role = 'admin' AND status = 'enabled' AND deleted_at IS NULL ORDER BY id LIMIT 1"
  );
  if (!admin) throw new Error('Archive queue check needs an enabled administrator account');
  const target = await firstExportTarget();
  if (!target) throw new Error('Archive queue check needs one published or closed material task and one applicable project');

  let templateId;
  let successExportId;
  let failureExportId;
  let recoverExportId;
  let exhaustedExportId;
  let cleanupExportId;
  const cleanupZipPath = path.join(env.archive.root, `archive-cleanup-check-${Date.now()}.zip`);
  const importBatchPath = path.join(batchDir, `archive-cleanup-check-${Date.now()}.json`);

  try {
    templateId = await createTemplate(admin.id, '归档队列自动验收模板', {
      version: 1,
      directoryLevels: [
        { pattern: '{年度}年' },
        { pattern: '{项目编号}-{作品名称}' },
        { pattern: '{材料任务}' },
        { pattern: '{材料类别}' }
      ],
      fileNameRule: '{项目编号}_{材料类别}_{原文件名}'
    });

    const queued = await validateAndEnqueueArchiveExport({
      userId: admin.id,
      archiveTemplateId: templateId,
      rawScope: {
        years: [Number(target.projectYear)],
        groups: [],
        materialTaskIds: [Number(target.taskId)],
        projectIds: [Number(target.projectId)]
      },
      remark: '归档队列成功路径自动验收'
    });
    successExportId = queued.id;
    const [[queuedRecord]] = await pool.execute('SELECT export_status AS exportStatus FROM archive_export_records WHERE id = ?', [successExportId]);
    if (queuedRecord.exportStatus !== 'queued') throw new Error('Archive export API/service did not create a queued record');

    const processed = await processNextArchiveExport('check-archive-queue-worker');
    if (!processed) throw new Error('Archive queue worker did not claim the queued export');
    const [[successRecord]] = await pool.execute(
      `SELECT export_status AS exportStatus, attempt_count AS attemptCount, worker_id AS workerId, export_file_path AS exportFilePath
       FROM archive_export_records WHERE id = ?`,
      [successExportId]
    );
    if (successRecord.exportStatus !== 'success' || Number(successRecord.attemptCount) !== 1 || successRecord.workerId) {
      throw new Error('Archive queue worker did not mark the export successful cleanly');
    }
    const zipBuffer = await fs.readFile(successRecord.exportFilePath);
    if (!zipBuffer.subarray(0, 4).toString('hex').startsWith('504b')) {
      throw new Error('Archive queue worker did not create a ZIP file');
    }

    const [failureInsert] = await pool.execute(
      `INSERT INTO archive_export_records
       (export_user_id, archive_template_id, export_scope, template_snapshot, export_status, max_attempts, remark)
       VALUES (?, ?, ?, ?, 'queued', 1, '归档队列失败路径自动验收')`,
      [admin.id, templateId, JSON.stringify({ years: [], groups: [], materialTaskIds: [], projectIds: [] }), JSON.stringify({ version: 1, directoryLevels: [], fileNameRule: '' })]
    );
    failureExportId = failureInsert.insertId;
    await processNextArchiveExport('check-archive-queue-worker');
    const [[failedRecord]] = await pool.execute(
      'SELECT export_status AS exportStatus, attempt_count AS attemptCount, failure_reason AS failureReason FROM archive_export_records WHERE id = ?',
      [failureExportId]
    );
    if (failedRecord.exportStatus !== 'failed' || Number(failedRecord.attemptCount) !== 1 || !failedRecord.failureReason) {
      throw new Error('Archive queue worker did not mark exhausted failures correctly');
    }
    await retryArchiveExport(failureExportId);
    const [[retriedRecord]] = await pool.execute(
      'SELECT export_status AS exportStatus, attempt_count AS attemptCount, failure_reason AS failureReason FROM archive_export_records WHERE id = ?',
      [failureExportId]
    );
    if (retriedRecord.exportStatus !== 'queued' || Number(retriedRecord.attemptCount) !== 0 || retriedRecord.failureReason) {
      throw new Error('Archive export retry did not reset the failed record');
    }

    const [recoverInsert] = await pool.execute(
      `INSERT INTO archive_export_records
       (export_user_id, archive_template_id, export_scope, template_snapshot, export_status, attempt_count, max_attempts, heartbeat_at, worker_id)
       VALUES (?, ?, JSON_OBJECT(), JSON_OBJECT('version', 1, 'directoryLevels', JSON_ARRAY(JSON_OBJECT('pattern', '{年度}')), 'fileNameRule', '{原文件名}'),
               'processing', 1, 3, DATE_SUB(NOW(), INTERVAL 1 DAY), 'dead-worker')`,
      [admin.id, templateId]
    );
    recoverExportId = recoverInsert.insertId;
    const [exhaustedInsert] = await pool.execute(
      `INSERT INTO archive_export_records
       (export_user_id, archive_template_id, export_scope, template_snapshot, export_status, attempt_count, max_attempts, heartbeat_at, worker_id)
       VALUES (?, ?, JSON_OBJECT(), JSON_OBJECT('version', 1, 'directoryLevels', JSON_ARRAY(JSON_OBJECT('pattern', '{年度}')), 'fileNameRule', '{原文件名}'),
               'processing', 3, 3, DATE_SUB(NOW(), INTERVAL 1 DAY), 'dead-worker')`,
      [admin.id, templateId]
    );
    exhaustedExportId = exhaustedInsert.insertId;
    await recoverTimedOutArchiveExports();
    const [[recovered]] = await pool.execute('SELECT export_status AS exportStatus FROM archive_export_records WHERE id = ?', [recoverExportId]);
    const [[exhausted]] = await pool.execute('SELECT export_status AS exportStatus FROM archive_export_records WHERE id = ?', [exhaustedExportId]);
    if (recovered.exportStatus !== 'queued' || exhausted.exportStatus !== 'failed') {
      throw new Error('Archive export timeout recovery did not requeue/fail records correctly');
    }

    await fs.mkdir(env.archive.root, { recursive: true });
    await fs.writeFile(cleanupZipPath, Buffer.from('PK\x03\x04archive cleanup check'));
    const [cleanupInsert] = await pool.execute(
      `INSERT INTO archive_export_records
       (export_user_id, archive_template_id, export_scope, template_snapshot, export_file_path, export_status, finished_at)
       VALUES (?, ?, JSON_OBJECT(), JSON_OBJECT('version', 1, 'directoryLevels', JSON_ARRAY(JSON_OBJECT('pattern', '{年度}')), 'fileNameRule', '{原文件名}'),
               ?, 'success', DATE_SUB(NOW(), INTERVAL ? DAY))`,
      [admin.id, templateId, cleanupZipPath, env.archive.zipRetentionDays + 1]
    );
    cleanupExportId = cleanupInsert.insertId;
    await fs.mkdir(batchDir, { recursive: true });
    await fs.writeFile(importBatchPath, JSON.stringify({ batchId: 'archive-cleanup-check', expiresAt: new Date(Date.now() - 60 * 1000).toISOString() }), 'utf8');
    await cleanupArchiveStorage();
    const zipStillExists = await fs.stat(cleanupZipPath).then(() => true).catch(() => false);
    const batchStillExists = await fs.stat(importBatchPath).then(() => true).catch(() => false);
    const [[cleanedRecord]] = await pool.execute('SELECT export_file_path AS exportFilePath, zip_cleanup_at AS zipCleanupAt FROM archive_export_records WHERE id = ?', [cleanupExportId]);
    if (zipStillExists || batchStillExists || cleanedRecord.exportFilePath || !cleanedRecord.zipCleanupAt) {
      throw new Error('Archive cleanup did not remove expired ZIP/import batch files');
    }

    console.log(JSON.stringify({
      queuedAndSucceeded: successExportId,
      failedAndRetried: failureExportId,
      recoveredTimeout: recoverExportId,
      exhaustedTimeout: exhaustedExportId,
      cleanupRecord: cleanupExportId
    }, null, 2));
  } finally {
    await Promise.all([
      deleteExportRecord(successExportId),
      deleteExportRecord(failureExportId),
      deleteExportRecord(recoverExportId),
      deleteExportRecord(exhaustedExportId),
      deleteExportRecord(cleanupExportId)
    ]);
    await fs.unlink(cleanupZipPath).catch(() => undefined);
    await fs.unlink(importBatchPath).catch(() => undefined);
    if (templateId) await pool.execute('DELETE FROM archive_templates WHERE id = ?', [templateId]);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
