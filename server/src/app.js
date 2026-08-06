import cors from 'cors';
import express from 'express';
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
import submissionRoutes from './routes/submissions.js';
import uploadRoutes from './routes/uploads.js';

export function createApp() {
  const app = express();

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

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use('/health', healthRoutes);
  app.use('/api/health', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/accounts', accountRoutes);
  app.use('/api/archive-templates', archiveTemplateRoutes);
  app.use('/api/archive-exports', archiveExportRoutes);
  app.use('/api/projects', projectRoutes);
  app.use('/api/people', peopleRoutes);
  app.use('/api/imports', importRoutes);
  app.use('/api/uploads', uploadRoutes);
  app.use('/api/material-tasks', materialTaskRoutes);
  app.use('/api/submissions', submissionRoutes);
  app.use('/api/import-templates', importTemplateRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
