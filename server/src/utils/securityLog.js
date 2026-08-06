const ALLOWED_FIELDS = new Set([
  'event',
  'method',
  'path',
  'status',
  'code',
  'ip',
  'userId',
  'role',
  'reason'
]);

function safeDetails(details) {
  return Object.fromEntries(
    Object.entries(details || {}).filter(([key, value]) => ALLOWED_FIELDS.has(key) && value !== undefined)
  );
}

export function logSecurityEvent(event, details = {}) {
  console.warn(JSON.stringify({
    level: 'security',
    event,
    at: new Date().toISOString(),
    ...safeDetails(details)
  }));
}

export function logServerError(error, req) {
  console.error(JSON.stringify({
    level: 'error',
    at: new Date().toISOString(),
    method: req?.method,
    path: req?.path,
    status: error?.status || 500,
    code: error?.code || 'INTERNAL_ERROR',
    message: error?.status ? error.message : 'Unexpected server error'
  }));
}
