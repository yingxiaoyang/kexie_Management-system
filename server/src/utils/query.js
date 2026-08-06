import { badRequest } from './errors.js';

export function paginationFrom(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize, 10) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function requiredText(value, field, maxLength = 255) {
  const text = String(value ?? '').trim();
  if (!text) throw badRequest(`${field} is required`, 'VALIDATION_ERROR');
  if (text.length > maxLength) throw badRequest(`${field} is too long`, 'VALIDATION_ERROR');
  return text;
}

export function nullableText(value, maxLength = 1000) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (text.length > maxLength) throw badRequest('Text is too long', 'VALIDATION_ERROR');
  return text;
}

export function enumValue(value, allowed, field, fallback) {
  const normalized = value || fallback;
  if (!allowed.includes(normalized)) {
    throw badRequest(`${field} is invalid`, 'VALIDATION_ERROR');
  }
  return normalized;
}
