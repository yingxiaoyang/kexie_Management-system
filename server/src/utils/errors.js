export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function badRequest(message, code = 'BAD_REQUEST') {
  return new AppError(400, code, message);
}

export function unauthorized(message = 'Unauthorized', code = 'UNAUTHORIZED') {
  return new AppError(401, code, message);
}

export function forbidden(message = 'Forbidden', code = 'FORBIDDEN') {
  return new AppError(403, code, message);
}

export function tooManyRequests(message = 'Too many requests', code = 'TOO_MANY_REQUESTS') {
  return new AppError(429, code, message);
}

export function locked(message = 'Account is temporarily locked', code = 'ACCOUNT_LOCKED') {
  return new AppError(423, code, message);
}

export function notFound(message = 'Not found', code = 'NOT_FOUND') {
  return new AppError(404, code, message);
}
