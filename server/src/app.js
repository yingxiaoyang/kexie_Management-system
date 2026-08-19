import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/accounts.js';
import archiveExportRoutes from './routes/archiveExports.js';
import archiveTemplateRoutes from './routes/archiveTemplates.js';
import healthRoutes from './routes/health.js';
import importRoutes from './routes/imports.js';
import importTemplateRoutes from './routes/importTemplates.js';
import materialTaskRoutes from './routes/materialTasks.js';
import peopleRoutes from './routes/people.js';
import projectRoutes from './routes/projects.js';
import reportDesignRoutes from './routes/reportDesigns.js';
import submissionRoutes from './routes/submissions.js';
import uploadRoutes from './routes/uploads.js';
import applicationRoutes from './routes/applications.js';
import participationRuleRoutes from './routes/participationRules.js';
import projectChangeRoutes from './routes/projectChanges.js';
import { forbidden } from './utils/errors.js';

function originGuard(req, res, next) {
  const origin = req.headers.origin;
  if (!origin || env.corsOrigins.includes(origin)) {
    next();
    return;
  }
  next(forbidden('Request origin is not allowed', 'ORIGIN_NOT_ALLOWED'));
}

export function createApp() {
  const app = express();

  app.set('trust proxy', env.trustProxy);
  app.use(helmet());
  app.use(originGuard);

  app.use(cors({
    origin(origin, callback) {
      if (!origin || env.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true
  }));

  app.use(express.json({ limit: env.security.bodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: env.security.bodyLimit }));

  app.use('/health', healthRoutes);
  app.use('/api/health', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/accounts', accountRoutes);
  app.use('/api/archive-templates', archiveTemplateRoutes);
  app.use('/api/archive-exports', archiveExportRoutes);
  app.use('/api/projects', projectRoutes);
  app.use('/api/people', peopleRoutes);
  app.use('/api/report-designs', reportDesignRoutes);
  app.use('/api/imports', importRoutes);
  app.use('/api/uploads', uploadRoutes);
  app.use('/api/material-tasks', materialTaskRoutes);
  app.use('/api/submissions', submissionRoutes);
  app.use('/api/applications', applicationRoutes);
  app.use('/api/import-templates', importTemplateRoutes);
  app.use('/api/participation-rules', participationRuleRoutes);
  app.use('/api/project-changes', projectChangeRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
