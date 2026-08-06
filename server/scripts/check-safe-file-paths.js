import path from 'node:path';
import { env } from '../src/config/env.js';
import { isPathInside, resolveDownloadFile } from '../src/utils/safeFiles.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const outsideArchivePath = path.resolve(env.archive.root, '..', 'uploads', 'not-an-export.zip');
assert(
  !isPathInside(path.resolve(env.archive.root), outsideArchivePath),
  'Path outside archive root was treated as inside'
);

let rejected = false;
try {
  await resolveDownloadFile(env.archive.root, outsideArchivePath, {
    invalidMessage: 'Export file path is outside the system export directory',
    invalidCode: 'EXPORT_PATH_INVALID',
    missingMessage: 'Archive export file not found'
  });
} catch (error) {
  rejected = error?.status === 403 && error?.code === 'EXPORT_PATH_INVALID';
}

assert(rejected, 'Path outside archive root was not rejected before file lookup');
console.log(JSON.stringify({ safeFilePaths: 'ok' }, null, 2));
