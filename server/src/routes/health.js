import { Router } from 'express';
import { env } from '../config/env.js';
import { pingDatabase } from '../db/pool.js';
import { success } from '../utils/response.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const databaseOk = await pingDatabase();
    success(res, {
      service: 'kexie-server',
      status: databaseOk ? 'ok' : 'degraded',
      database: databaseOk ? 'connected' : 'disconnected',
      time: new Date().toISOString(),
      env: env.nodeEnv
    });
  } catch (error) {
    error.status = 503;
    error.code = 'DATABASE_UNAVAILABLE';
    error.message = 'Database is not available';
    next(error);
  }
});

export default router;
