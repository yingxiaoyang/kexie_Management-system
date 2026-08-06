import fs from 'node:fs/promises';
import jwt from 'jsonwebtoken';
import { env } from '../src/config/env.js';
import { pool } from '../src/db/pool.js';
import { renderArchivePath } from '../src/utils/archive.js';

const apiBase = `${env.appBaseUrl}/api`;

async function api(path, token, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method: options.method || 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();
  if (!response.ok || payload.success === false) throw new Error(`${path}: ${payload.message || response.status}`);
  return payload;
}

async function waitForExport(token, exportId) {
  for (let index = 0; index < 60; index += 1) {
    const record = (await api(`/archive-exports/${exportId}`, token)).data;
    if (record.exportStatus !== 'processing') return record;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Tree archive export timed out');
}

async function main() {
  const [[admin]] = await pool.execute("SELECT id, username, role, person_id FROM users WHERE role = 'admin' AND status = 'enabled' ORDER BY id LIMIT 1");
  if (!admin) throw new Error('No enabled administrator account is available');
  const token = jwt.sign({ id: admin.id, username: admin.username, role: admin.role, personId: admin.person_id }, env.jwt.secret, { expiresIn: '10m' });
  const [rows] = await pool.execute(
    `SELECT mt.id AS taskId, mt.task_name AS taskName, mc.id AS categoryId, mc.category_name AS categoryName,
            p.id AS projectId, p.project_year AS projectYear, p.project_group AS projectGroup,
            p.project_code AS projectCode, p.title AS projectTitle,
            COALESCE(owners.ownerNames, '未登记负责人') AS owner,
            approved.id AS approvedSubmissionId, mf.original_name AS originalName
     FROM material_tasks mt
     JOIN material_categories mc ON mc.material_task_id = mt.id AND mc.deleted_at IS NULL
     JOIN projects p ON p.deleted_at IS NULL AND (
       mt.project_scope_type = 'all'
       OR (mt.project_scope_type = 'year' AND mt.project_year = p.project_year)
       OR (mt.project_scope_type = 'group' AND mt.project_group = p.project_group)
       OR (mt.project_scope_type = 'custom' AND EXISTS (
         SELECT 1 FROM material_task_projects mtp WHERE mtp.material_task_id = mt.id AND mtp.project_id = p.id
       ))
     )
     LEFT JOIN (
       SELECT pp.project_id, GROUP_CONCAT(pe.name ORDER BY pp.is_primary_owner DESC, pe.name SEPARATOR '、') AS ownerNames
       FROM project_participations pp JOIN people pe ON pe.id = pp.person_id AND pe.deleted_at IS NULL
       WHERE pp.role = 'owner' AND pp.deleted_at IS NULL GROUP BY pp.project_id
     ) owners ON owners.project_id = p.id
     LEFT JOIN material_submissions approved ON approved.id = (
       SELECT candidate.id FROM material_submissions candidate
       WHERE candidate.material_task_id = mt.id AND candidate.project_id = p.id
         AND candidate.material_category_id = mc.id AND candidate.review_status = 'approved' AND candidate.deleted_at IS NULL
       ORDER BY COALESCE(candidate.reviewed_at, candidate.submitted_at, candidate.created_at) DESC, candidate.id DESC LIMIT 1
     )
     LEFT JOIN material_files mf ON mf.submission_id = approved.id AND mf.deleted_at IS NULL
     WHERE mt.deleted_at IS NULL AND mt.status IN ('published', 'closed')
     ORDER BY approved.id IS NULL, mt.id, mc.sort_order, p.id LIMIT 1`
  );
  const target = rows[0];
  if (!target) throw new Error('Tree archive flow needs one active material file task and an applicable project');

  const library = (await api('/archive-templates/task-library', token)).data;
  const libraryTask = library.find((item) => Number(item.id) === Number(target.taskId));
  if (!libraryTask?.fileTasks.some((item) => Number(item.id) === Number(target.categoryId))) {
    throw new Error('Archive task library does not expose the selected child file task');
  }

  const templateConfig = {
    version: 2,
    projectRootRule: '{项目编号}-{作品名称}',
    preserveEmptyFolders: true,
    defaultFileNameRule: '{材料类别}_{原文件名}',
    nodes: [{
      id: 'folder-phase', type: 'folder', nameRule: '01-{材料任务}', children: [{
        id: 'folder-files', type: 'folder', nameRule: '证明材料', children: [{
          id: 'placed-task', type: 'task', materialTaskId: Number(target.taskId), fileTaskId: Number(target.categoryId),
          materialTaskName: target.taskName, fileTaskName: target.categoryName,
          fileNameRule: '{项目编号}_{材料类别}_{原文件名}'
        }]
      }]
    }]
  };

  let templateId;
  let exportId;
  let exportFilePath;
  try {
    const created = await api('/archive-templates', token, { method: 'POST', body: { templateName: '目录树归档自动验收', status: 'enabled', templateConfig } });
    templateId = created.data.id;
    const preview = (await api('/archive-templates/preview', token, { method: 'POST', body: { templateConfig } })).data;
    if (!preview.entries?.length || !preview.entries[0].directory.includes('证明材料')) throw new Error('Tree archive preview is incomplete');

    const started = await api('/archive-exports', token, {
      method: 'POST',
      body: {
        archiveTemplateId: templateId,
        scope: { years: [Number(target.projectYear)], groups: [], materialTaskIds: [Number(target.taskId)], projectIds: [Number(target.projectId)] },
        remark: '目录树归档自动验收'
      }
    });
    exportId = started.data.id;
    const record = await waitForExport(token, exportId);
    if (record.exportStatus !== 'success') throw new Error(`Tree archive export failed: ${record.failureReason || 'unknown'}`);
    const [[stored]] = await pool.execute('SELECT export_file_path AS exportFilePath FROM archive_export_records WHERE id = ?', [exportId]);
    exportFilePath = stored.exportFilePath;
    const zipBuffer = await fs.readFile(exportFilePath);
    const rendered = renderArchivePath(templateConfig, { ...target, originalName: target.originalName || '未提交材料.docx' });
    const expectedDirectory = rendered.directory;
    if (!zipBuffer.includes(Buffer.from(expectedDirectory))) throw new Error(`ZIP does not contain expected project tree: ${expectedDirectory}`);
    if (!target.approvedSubmissionId && !zipBuffer.includes(Buffer.from('缺失材料报告.xlsx'))) throw new Error('Missing report is absent from tree archive ZIP');
    console.log(JSON.stringify({ templateVersion: 2, projectRoot: preview.projectRoot, sampleDirectory: preview.entries[0].directory, exportStatus: record.exportStatus, exportSummary: record.exportSummary }, null, 2));
  } finally {
    if (exportId) await pool.execute('DELETE FROM archive_export_records WHERE id = ?', [exportId]);
    if (exportFilePath) await fs.unlink(exportFilePath).catch(() => undefined);
    if (templateId) await pool.execute('DELETE FROM archive_templates WHERE id = ?', [templateId]);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => pool.end());
