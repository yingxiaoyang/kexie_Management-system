import {
  cleanupArchiveStorage,
  defaultArchiveWorkerId,
  processNextArchiveExport,
  recoverTimedOutArchiveExports
} from '../services/archiveExportService.js';
import { env } from '../config/env.js';

export function startArchiveExportWorker({ workerId = defaultArchiveWorkerId(), once = false } = {}) {
  let stopped = false;
  let busy = false;
  let cleanupBusy = false;

  async function tick() {
    if (stopped || busy) return;
    busy = true;
    try {
      await processNextArchiveExport(workerId);
    } catch (error) {
      console.error('Archive export worker tick failed', error);
    } finally {
      busy = false;
      if (once) stopped = true;
    }
  }

  async function cleanupTick() {
    if (stopped || cleanupBusy) return;
    cleanupBusy = true;
    try {
      await cleanupArchiveStorage();
    } catch (error) {
      console.error('Archive export cleanup failed', error);
    } finally {
      cleanupBusy = false;
    }
  }

  recoverTimedOutArchiveExports().catch((error) => console.error('Archive export recovery failed', error));
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
