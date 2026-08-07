import { env } from '../config/env.js';
import {
  cleanupReportStorage,
  defaultReportWorkerId,
  processNextReportExport,
  recoverTimedOutReportExports
} from '../services/reportExportService.js';

export function startReportExportWorker({ workerId = defaultReportWorkerId(), once = false } = {}) {
  let stopped = false;
  let busy = false;
  let cleanupBusy = false;

  async function tick() {
    if (stopped || busy) return;
    busy = true;
    try {
      await processNextReportExport(workerId);
    } catch (error) {
      console.error('Report export worker tick failed', error);
    } finally {
      busy = false;
      if (once) stopped = true;
    }
  }

  async function cleanupTick() {
    if (stopped || cleanupBusy) return;
    cleanupBusy = true;
    try {
      await cleanupReportStorage();
    } catch (error) {
      console.error('Report export cleanup failed', error);
    } finally {
      cleanupBusy = false;
    }
  }

  recoverTimedOutReportExports().catch((error) => console.error('Report export recovery failed', error));
  cleanupTick();
  tick();

  const pollTimer = once ? null : setInterval(tick, env.archive.workerPollMs);
  const cleanupTimer = once ? null : setInterval(cleanupTick, env.archive.cleanupIntervalMs);

  return {
    workerId,
    async stop() {
      stopped = true;
      if (pollTimer) clearInterval(pollTimer);
      if (cleanupTimer) clearInterval(cleanupTimer);
      while (busy || cleanupBusy) await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
}
