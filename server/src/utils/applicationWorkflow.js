import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { badRequest, forbidden, notFound } from './errors.js';

export const APPLICATION_TRANSITIONS = Object.freeze({
  draft: new Set(['submitted', 'withdrawn']),
  returned: new Set(['submitted', 'withdrawn']),
  submitted: new Set(['eligible', 'returned', 'withdrawn']),
  eligible: new Set(['frozen', 'withdrawn']),
  frozen: new Set(['school_approved', 'school_rejected', 'eligible']),
  school_approved: new Set(['converted']),
  school_rejected: new Set(),
  withdrawn: new Set(),
  converted: new Set()
});

export function assertApplicationTransition(from, to) {
  if (!APPLICATION_TRANSITIONS[from]?.has(to)) {
    throw badRequest(`Illegal application status transition: ${from} -> ${to}`, 'ILLEGAL_STATUS_TRANSITION');
  }
}

export function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function normalizeApplicationSchema(value) {
  const schema = parseJson(value, []);
  if (!Array.isArray(schema) || schema.length > 40) {
    throw badRequest('applicationSchema must be an array with at most 40 fields', 'VALIDATION_ERROR');
  }
  const keys = new Set();
  return schema.map((field, index) => {
    const key = String(field?.key || '').trim();
    const label = String(field?.label || '').trim();
    const type = String(field?.type || 'text').trim();
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key) || keys.has(key) || !label || label.length > 80) {
      throw badRequest(`applicationSchema field ${index + 1} is invalid`, 'VALIDATION_ERROR');
    }
    if (!['text', 'textarea', 'number', 'date', 'select'].includes(type)) {
      throw badRequest(`applicationSchema field ${key} has an invalid type`, 'VALIDATION_ERROR');
    }
    keys.add(key);
    const options = type === 'select' && Array.isArray(field.options)
      ? field.options.map((item) => String(item).trim()).filter(Boolean).slice(0, 30)
      : [];
    return { key, label, type, required: Boolean(field.required), options };
  });
}

export function validateApplicationData(data, schema) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw badRequest('applicationData must be an object', 'VALIDATION_ERROR');
  }
  const allowed = new Set(schema.map((field) => field.key));
  const normalized = {};
  for (const key of Object.keys(data)) {
    if (!allowed.has(key)) throw badRequest(`Unknown application field: ${key}`, 'VALIDATION_ERROR');
  }
  for (const field of schema) {
    let value = data[field.key];
    if (typeof value === 'string') value = value.trim();
    if (field.required && (value == null || value === '')) {
      throw badRequest(`${field.label} is required`, 'VALIDATION_ERROR');
    }
    if (value == null || value === '') {
      normalized[field.key] = null;
      continue;
    }
    if (field.type === 'number') {
      const number = Number(value);
      if (!Number.isFinite(number)) throw badRequest(`${field.label} must be a number`, 'VALIDATION_ERROR');
      normalized[field.key] = number;
    } else {
      const text = String(value);
      if (text.length > (field.type === 'textarea' ? 4000 : 500)) {
        throw badRequest(`${field.label} is too long`, 'VALIDATION_ERROR');
      }
      if (field.type === 'select' && !field.options.includes(text)) {
        throw badRequest(`${field.label} has an invalid option`, 'VALIDATION_ERROR');
      }
      normalized[field.key] = text;
    }
  }
  return normalized;
}

export async function loadApplicationForAccess(connection, applicationId, user, lock = false) {
  const [[application]] = await connection.execute(
    `SELECT pa.*, ab.status AS batch_status, ab.deadline_at, ab.application_schema,
            ab.application_year, ab.approval_round, ab.batch_name, pe.student_no, pe.name AS applicant_name
     FROM project_applications pa
     JOIN application_batches ab ON ab.id = pa.application_batch_id AND ab.deleted_at IS NULL
     JOIN people pe ON pe.id = pa.applicant_person_id AND pe.deleted_at IS NULL
     WHERE pa.id = ? ${lock ? 'FOR UPDATE' : ''}`,
    [applicationId]
  );
  if (!application) throw notFound('Application not found');
  if (user.role !== 'admin' && Number(application.applicant_user_id) !== Number(user.id)) {
    throw forbidden('No permission to access this application');
  }
  return application;
}

export async function appendApplicationAudit(connection, {
  eventType,
  user,
  batchId = null,
  applicationId = null,
  projectId = null,
  payload = {},
  ip = ''
}) {
  const ipHash = ip
    ? crypto.createHmac('sha256', env.jwt.secret).update(String(ip)).digest('hex')
    : null;
  await connection.execute(
    `INSERT INTO application_audit_events
     (event_type, actor_user_id, application_batch_id, project_application_id, project_id, event_payload, source_ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [eventType, user?.id || null, batchId, applicationId, projectId, JSON.stringify(payload), ipHash]
  );
}
