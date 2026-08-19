import fs from 'node:fs';
import path from 'node:path';
import { forbidden, notFound } from './errors.js';

export function isPathInside(rootPath, targetPath) {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export async function resolveDownloadFile(rootPath, storedPath, {
  invalidMessage = 'File path is outside the allowed directory',
  invalidCode = 'FILE_PATH_INVALID',
  missingMessage = 'File not found'
} = {}) {
  const rawPath = typeof storedPath === 'string' ? storedPath.trim() : '';
  if (!rawPath || rawPath.includes('\0')) {
    throw forbidden(invalidMessage, invalidCode);
  }

  const resolvedRootPath = path.resolve(rootPath);
  const candidatePath = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(rootPath, rawPath);
  // Reject lexical traversal before touching the filesystem. This preserves the
  // authorization boundary even when the storage root has not been created yet.
  if (!isPathInside(resolvedRootPath, candidatePath)) {
    throw forbidden(invalidMessage, invalidCode);
  }
  const rootRealPath = await fs.promises.realpath(rootPath).catch(() => null);
  if (!rootRealPath) throw notFound('System file directory not found');
  if (!isPathInside(rootRealPath, candidatePath)) {
    throw forbidden(invalidMessage, invalidCode);
  }
  const fileRealPath = await fs.promises.realpath(candidatePath).catch((error) => {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  });
  if (!fileRealPath) throw notFound(missingMessage);
  if (!isPathInside(rootRealPath, fileRealPath)) {
    throw forbidden(invalidMessage, invalidCode);
  }

  const stat = await fs.promises.stat(fileRealPath);
  if (!stat.isFile()) throw notFound(missingMessage);
  return fileRealPath;
}
