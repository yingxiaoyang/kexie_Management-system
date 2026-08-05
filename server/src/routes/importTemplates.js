import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { notFound } from '../utils/errors.js';

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

router.get('/:type/download', requireAuth, requireRole('admin'), (req, res, next) => {
  const fileName = files[req.params.type];
  if (!fileName) {
    next(notFound('Import template not found'));
    return;
  }
  res.download(path.join(templateDir, fileName), fileName);
});

export default router;
