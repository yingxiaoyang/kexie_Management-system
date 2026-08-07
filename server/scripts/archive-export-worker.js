import { startArchiveExportWorker } from '../src/workers/archiveExportWorker.js';
import { pool } from '../src/db/pool.js';

const worker = startArchiveExportWorker();
console.log(`Archive export worker started: ${worker.workerId}`);

async function shutdown() {
  await worker.stop();
  await pool.end();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
