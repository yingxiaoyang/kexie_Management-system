import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { unauthorized, forbidden } from '../utils/errors.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token) {
    next(unauthorized('Please login first'));
    return;
  }

  try {
    req.user = jwt.verify(token, env.jwt.secret);
    next();
  } catch {
    next(unauthorized('Login has expired'));
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      next(forbidden('No permission for this operation'));
      return;
    }
    next();
  };
}
