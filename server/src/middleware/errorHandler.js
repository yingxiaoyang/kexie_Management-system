import { fail } from '../utils/response.js';
import { logServerError } from '../utils/securityLog.js';

export function notFoundHandler(req, res, next) {
  const error = new Error(`Route not found: ${req.method} ${req.path}`);
  error.status = 404;
  error.code = 'ROUTE_NOT_FOUND';
  next(error);
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error.name === 'MulterError') {
    const multerCode = error.code;
    error.status = 400;
    if (multerCode === 'LIMIT_FILE_SIZE') {
      error.code = 'UPLOAD_FILE_SIZE_EXCEEDED';
      error.message = 'File size exceeds the allowed limit';
    } else if (multerCode === 'LIMIT_FILE_COUNT' || multerCode === 'LIMIT_UNEXPECTED_FILE') {
      error.code = 'UPLOAD_FILE_COUNT_EXCEEDED';
      error.message = 'File count exceeds the allowed limit';
    } else {
      error.code = 'UPLOAD_ERROR';
    }
  }

  if (error.type === 'entity.too.large') {
    error.status = 413;
    error.code = 'REQUEST_BODY_TOO_LARGE';
    error.message = 'Request body exceeds the allowed limit';
  }

  logServerError(error, req);

  fail(res, error);
}
