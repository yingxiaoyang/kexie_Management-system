import { startReportExportWorker } from '../src/workers/reportExportWorker.js';

const worker = startReportExportWorker();
console.log(`Report export worker is running: ${worker.workerId}`);

process.on('SIGINT', async () => {
  await worker.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await worker.stop();
  process.exit(0);
});
