export function success(res, data = null, message = 'ok', extra = {}) {
  return res.json({
    success: true,
    code: 'OK',
    message,
    data,
    ...extra
  });
}

export function fail(res, error) {
  const status = error.status || 500;
  const exposeError = Boolean(error.status);
  return res.status(status).json({
    success: false,
    code: exposeError ? (error.code || 'INTERNAL_ERROR') : 'INTERNAL_ERROR',
    message: exposeError ? (error.message || 'Server error') : 'Server error',
    data: null
  });
}

export function pageResult(items, page, pageSize, total) {
  return {
    items,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize)
    }
  };
}
