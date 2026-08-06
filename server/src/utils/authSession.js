import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.authCookie.secure,
    sameSite: 'strict',
    path: '/api'
  };
}

export function signUserToken(user) {
  return jwt.sign(
    {
      id: Number(user.id),
      username: user.username,
      role: user.role,
      personId: user.person_id === null ? null : Number(user.person_id),
      tokenVersion: Number(user.token_version)
    },
    env.jwt.secret,
    { expiresIn: env.jwt.expiresIn }
  );
}

export function setAuthCookie(res, token) {
  res.cookie(env.authCookie.name, token, cookieOptions());
}

export function clearAuthCookie(res) {
  res.clearCookie(env.authCookie.name, cookieOptions());
}

export function readCookie(req, name) {
  const rawCookie = req.headers.cookie || '';
  for (const part of rawCookie.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex < 0) continue;
    const key = part.slice(0, separatorIndex).trim();
    if (key !== name) continue;
    const value = part.slice(separatorIndex + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return '';
}

export function readAuthToken(req) {
  const cookieToken = readCookie(req, env.authCookie.name);
  if (cookieToken) return cookieToken;
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}
