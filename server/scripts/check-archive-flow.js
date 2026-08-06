import fs from 'node:fs/promises';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { env } from '../src/config/env.js';
import { pool } from '../src/db/pool.js';
import { renderArchivePath, uniqueArchiveEntry } from '../src/utils/archive.js';

const apiBase = `${env.appBaseUrl}/api`;

async function api(path, token, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();
  if (!response.ok || payload.success === false) {
    throw new Error(`${path}: ${payload.message || response.status}`);
  }
  return payload;
}

async function createAndWaitForExport(token, body) {
  const createdExport = await api('/archive-exports', token, { method: 'POST', body });
  const exportId = createdExport.data.id;
  let record;
  for (let index = 0; index < 40; index += 1) {
    const detail = await api(`/archive-exports/${exportId}`, token);
    record = detail.data;
    if (record.exportStatus !== 'processing') break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (record?.exportStatus !== 'success') {
    throw new Error(`Archive export failed: ${record?.failureReason || 'timeout'}`);
  }
  const [[stored]] = await pool.execute(
    'SELECT export_file_path AS exportFilePath FROM archive_export_records WHERE id = ?',
    [exportId]
  );
  const archiveBuffer = await fs.readFile(stored.exportFilePath);
  if (!archiveBuffer.subarray(0, 4).toString('hex').startsWith('504b')) {
    throw new Error('Generated file is not a ZIP archive');
  }
  return { exportId, record, exportFilePath: stored.exportFilePath, archiveBuffer };
}

async function main() {
  const safetyConfig = {
    directoryLevels: [{ pattern: '{年度}' }, { pattern: '{项目编号}-{作品名称}' }],
    fileNameRule: '{项目编号}_{作品名称}_{原文件名}'
  };
  const safetyPath = renderArchivePath(safetyConfig, {
    projectYear: 2026,
    projectCode: '../CON',
    projectTitle: '测试<>:"/\\|?*项目',
    originalName: '报告?.docx'
  });
  const usedEntries = new Set();
  const firstEntry = uniqueArchiveEntry(`${safetyPath.directory}/${safetyPath.fileName}`, usedEntries);
  const secondEntry = uniqueArchiveEntry(`${safetyPath.directory}/${safetyPath.fileName}`, usedEntries);
  if (firstEntry.includes('../') || firstEntry === secondEntry || !secondEntry.includes('_2.docx')) {
    throw new Error('Archive path sanitization or duplicate numbering check failed');
  }

  const [[admin]] = await pool.execute(
    "SELECT id, username, role, person_id, token_version FROM users WHERE role = 'admin' AND status = 'enabled' AND password_reset_required = 0 AND deleted_at IS NULL ORDER BY id LIMIT 1"
  );
  if (!admin) throw new Error('No enabled administrator account is available');
  const token = jwt.sign(
    { id: admin.id, username: admin.username, role: admin.role, personId: admin.person_id, tokenVersion: admin.token_version },
    env.jwt.secret,
    { expiresIn: '10m' }
  );

  let temporaryTemplateId;
  try {
    const temporaryTemplate = await api('/archive-templates', token, {
      method: 'POST',
      body: {
        templateName: '归档模板接口自动验收',
        status: 'disabled',
        templateConfig: {
          directoryLevels: [{ pattern: '{年度}年' }, { pattern: '{项目编号}-{作品名称}' }],
          fileNameRule: '{项目编号}_{材料类别}_{原文件名}'
        }
      }
    });
    temporaryTemplateId = temporaryTemplate.data.id;
    const preview = await api('/archive-templates/preview', token, {
      method: 'POST',
      body: {
        templateConfig: {
          directoryLevels: [{ pattern: '{年度}年' }, { pattern: '{项目编号}-{作品名称}' }],
          fileNameRule: '{项目编号}_{材料类别}_{原文件名}'
        }
      }
    });
    if (!preview.data.directory || !preview.data.fileName) throw new Error('Archive template preview is empty');
    await api(`/archive-templates/${temporaryTemplateId}`, token, {
      method: 'PUT',
      body: {
        templateName: '归档模板接口自动验收-已编辑',
        status: 'enabled',
        templateConfig: {
          directoryLevels: [{ pattern: '{年度}年' }, { pattern: '{组别}' }, { pattern: '{项目编号}' }],
          fileNameRule: '{项目编号}_{负责人}_{原文件名}'
        }
      }
    });
    await api(`/archive-templates/${temporaryTemplateId}/status`, token, { method: 'PATCH', body: { status: 'disabled' } });
    const disabledTemplates = await api('/archive-templates?page=1&pageSize=100&status=disabled&keyword=%E8%87%AA%E5%8A%A8%E9%AA%8C%E6%94%B6', token);
    if (!disabledTemplates.data.some((item) => Number(item.id) === Number(temporaryTemplateId))) {
      throw new Error('Archive template disable operation was not persisted');
    }
    await api(`/archive-templates/${temporaryTemplateId}/status`, token, { method: 'PATCH', body: { status: 'enabled' } });
  } finally {
    if (temporaryTemplateId) await pool.execute('DELETE FROM archive_templates WHERE id = ?', [temporaryTemplateId]);
  }

  const templateName = '默认年度材料归档模板';
  const templateList = await api(`/archive-templates?page=1&pageSize=100&keyword=${encodeURIComponent(templateName)}`, token);
  let template = templateList.data.find((item) => item.templateName === templateName);
  if (!template) {
    const created = await api('/archive-templates', token, {
      method: 'POST',
      body: {
        templateName,
        status: 'enabled',
        templateConfig: {
          version: 1,
          directoryLevels: [
            { pattern: '{年度}年' },
            { pattern: '{组别}' },
            { pattern: '{项目编号}-{作品名称}' },
            { pattern: '{材料任务}' },
            { pattern: '{材料类别}' }
          ],
          fileNameRule: '{项目编号}_{作品名称}_{负责人}_{材料类别}_{原文件名}'
        }
      }
    });
    template = { id: created.data.id };
  }

  const [approvedRows] = await pool.execute(
    `SELECT ms.material_task_id AS taskId, ms.project_id AS projectId, p.project_year AS projectYear
     FROM material_submissions ms
     JOIN projects p ON p.id = ms.project_id
     JOIN material_tasks mt ON mt.id = ms.material_task_id
     WHERE ms.review_status = 'approved' AND ms.deleted_at IS NULL
       AND p.deleted_at IS NULL AND mt.deleted_at IS NULL AND mt.status IN ('published', 'closed')
     ORDER BY ms.reviewed_at DESC, ms.id DESC LIMIT 1`
  );
  let target = approvedRows[0];
  if (!target) {
    const options = await api('/archive-exports/options', token);
    const firstTask = options.data.materialTasks[0];
    const firstProject = options.data.projects[0];
    if (!firstTask || !firstProject) throw new Error('Archive flow check needs at least one project and one published or closed material task');
    target = { taskId: firstTask.id, projectId: firstProject.id, projectYear: firstProject.projectYear };
  }

  const approvedCheck = await createAndWaitForExport(token, {
    archiveTemplateId: template.id,
    scope: {
      years: [Number(target.projectYear)],
      groups: [],
      materialTaskIds: [Number(target.taskId)],
      projectIds: [Number(target.projectId)]
    },
    remark: '自动化归档导出闭环检查'
  });

  let missingTaskId;
  try {
    const [taskResult] = await pool.execute(
      `INSERT INTO material_tasks
       (task_name, task_description, project_scope_type, deadline_at, allowed_extensions,
        max_file_mb, max_task_project_mb, has_template, status, created_by)
       VALUES ('归档缺失报告自动验收任务', '仅用于自动验证缺失材料报告', 'custom', NOW(), JSON_ARRAY('pdf'), 50, 500, 0, 'published', ?)`,
      [admin.id]
    );
    missingTaskId = taskResult.insertId;
    await pool.execute(
      "INSERT INTO material_categories (material_task_id, category_name, is_required, sort_order) VALUES (?, '应缺失材料', 1, 0)",
      [missingTaskId]
    );
    await pool.execute(
      'INSERT INTO material_task_projects (material_task_id, project_id) VALUES (?, ?)',
      [missingTaskId, target.projectId]
    );
    const missingCheck = await createAndWaitForExport(token, {
      archiveTemplateId: template.id,
      scope: {
        years: [Number(target.projectYear)],
        groups: [],
        materialTaskIds: [Number(missingTaskId)],
        projectIds: [Number(target.projectId)]
      },
      remark: '自动化缺失材料报告检查'
    });
    if (!missingCheck.record.exportSummary?.missingReportIncluded || missingCheck.record.exportSummary.missingCount < 1) {
      throw new Error('Missing material report was not generated');
    }
    if (!missingCheck.archiveBuffer.includes(Buffer.from('缺失材料报告.xlsx'))) {
      throw new Error('ZIP does not contain 缺失材料报告.xlsx');
    }
    const emptyScopeCheck = await createAndWaitForExport(token, {
      archiveTemplateId: template.id,
      scope: {
        years: [Number(target.projectYear) === 2100 ? 2000 : 2100],
        groups: [],
        materialTaskIds: [Number(target.taskId)],
        projectIds: [Number(target.projectId)]
      },
      remark: '自动化空范围缺失报告检查'
    });
    if (emptyScopeCheck.record.exportSummary?.expectedMaterialCount !== 0
      || !emptyScopeCheck.record.exportSummary?.missingReportIncluded
      || emptyScopeCheck.record.exportSummary?.missingCount !== 1
      || !emptyScopeCheck.archiveBuffer.includes(Buffer.from('缺失材料报告.xlsx'))) {
      throw new Error('Empty structured scope did not produce an explicit missing report');
    }
    const downloadResponse = await fetch(`${apiBase}/archive-exports/${approvedCheck.exportId}/download`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const downloadedArchive = Buffer.from(await downloadResponse.arrayBuffer());
    if (!downloadResponse.ok || !downloadedArchive.subarray(0, 4).toString('hex').startsWith('504b')) {
      throw new Error('Administrator ZIP download failed');
    }

    const [[owner]] = await pool.execute(
      "SELECT id, username, role, person_id, token_version FROM users WHERE role = 'project_owner' AND status = 'enabled' AND password_reset_required = 0 AND deleted_at IS NULL ORDER BY id LIMIT 1"
    );
    if (owner) {
      const ownerToken = jwt.sign(
        { id: owner.id, username: owner.username, role: owner.role, personId: owner.person_id, tokenVersion: owner.token_version },
        env.jwt.secret,
        { expiresIn: '10m' }
      );
      const forbiddenResponse = await fetch(`${apiBase}/archive-templates`, {
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      if (forbiddenResponse.status !== 403) throw new Error('Project owner can access administrator archive API');
    }

    await pool.execute(
      'UPDATE archive_export_records SET export_file_path = ? WHERE id = ?',
      [pathOutsideExportRoot(), missingCheck.exportId]
    );
    try {
      const invalidDownload = await fetch(`${apiBase}/archive-exports/${missingCheck.exportId}/download`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (invalidDownload.status !== 403) {
        throw new Error(`Download path outside export root was not rejected: ${invalidDownload.status} ${await invalidDownload.text()}`);
      }
    } finally {
      await pool.execute(
        'UPDATE archive_export_records SET export_file_path = ? WHERE id = ?',
        [missingCheck.exportFilePath, missingCheck.exportId]
      );
    }
    console.log(JSON.stringify({
      approvedExport: {
        exportId: approvedCheck.exportId,
        exportStatus: approvedCheck.record.exportStatus,
        exportSummary: approvedCheck.record.exportSummary,
        exportFilePath: approvedCheck.exportFilePath
      },
      missingExport: {
        exportId: missingCheck.exportId,
        exportStatus: missingCheck.record.exportStatus,
        exportSummary: missingCheck.record.exportSummary,
        exportFilePath: missingCheck.exportFilePath
      },
      emptyScopeExport: {
        exportId: emptyScopeCheck.exportId,
        exportStatus: emptyScopeCheck.record.exportStatus,
        exportSummary: emptyScopeCheck.record.exportSummary,
        exportFilePath: emptyScopeCheck.exportFilePath
      }
    }, null, 2));
  } finally {
    if (missingTaskId) {
      await pool.execute('DELETE FROM material_task_projects WHERE material_task_id = ?', [missingTaskId]);
      await pool.execute('DELETE FROM material_categories WHERE material_task_id = ?', [missingTaskId]);
      await pool.execute('DELETE FROM material_tasks WHERE id = ?', [missingTaskId]);
    }
  }
}

function pathOutsideExportRoot() {
  return path.resolve(env.archive.root, '..', 'uploads', 'not-an-export.zip');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
