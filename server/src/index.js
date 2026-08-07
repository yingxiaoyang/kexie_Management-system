import { env } from './config/env.js';
import { createApp } from './app.js';
import { startArchiveExportWorker } from './workers/archiveExportWorker.js';

const app = createApp();
const archiveWorker = env.archive.workerEnabled ? startArchiveExportWorker() : null;

app.listen(env.port, () => {
  console.log(`Kexie server is running at http://127.0.0.1:${env.port}`);
  if (archiveWorker) console.log(`Archive export worker is running: ${archiveWorker.workerId}`);
});
