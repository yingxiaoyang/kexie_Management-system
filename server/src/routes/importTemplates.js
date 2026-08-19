import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requireAdminPermission } from '../utils/adminPermissions.js';
import { notFound } from '../utils/errors.js';
import { resolveDownloadFile } from '../utils/safeFiles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templateDir = path.resolve(__dirname, '../../templates/import');

const files = {
  'standard-workbook': '科研项目数据标准导入模板.xlsx',
  projects: 'projects.csv',
  people: 'people.csv',
  participations: 'project_participations.csv',
  checks: 'project_checks.csv',
  reimbursements: 'project_reimbursements.csv'
};

const router = Router();

router.get('/:type/download', requireAuth, requireRole('admin'), requireAdminPermission('data_import'), async (req, res, next) => {
  try {
    const fileName = files[req.params.type];
    if (!fileName) throw notFound('Import template not found');
    const filePath = await resolveDownloadFile(templateDir, fileName, {
      invalidMessage: 'Import template path is outside the system template directory',
      invalidCode: 'IMPORT_TEMPLATE_PATH_INVALID',
      missingMessage: 'Import template not found'
    });
    res.download(filePath, fileName);
  } catch (error) {
    next(error);
  }
});

export default router;
