'use strict';

/*
 * CORS and small HTTP helpers for the translation function.
 * No secrets belong in this file.
 */

const STATIC_ORIGINS = new Set([
  'https://macshi716.github.io',
  'https://korean-site-zhcn.vercel.app',
]);

const LOCAL_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;
const PROJECT_VERCEL_ORIGIN = /^https:\/\/korean-site-zhcn(?:-[a-z0-9-]+)?\.vercel\.app$/i;

function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object') return '';
  const direct = headers[name];
  if (typeof direct === 'string') return direct;
  const lower = headers[String(name).toLowerCase()];
  if (typeof lower === 'string') return lower;
  const key = Object.keys(headers).find((item) => item.toLowerCase() === String(name).toLowerCase());
  return key && typeof headers[key] === 'string' ? headers[key] : '';
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  return STATIC_ORIGINS.has(origin)
    || LOCAL_ORIGIN.test(origin)
    || PROJECT_VERCEL_ORIGIN.test(origin);
}

function setCors(req, res) {
  const origin = headerValue(req && req.headers, 'origin');
  const allowed = isAllowedOrigin(origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    // Same-origin browser requests and server-to-server checks do not send an
    // Origin header. A wildcard here never weakens an Origin-bearing request.
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  return allowed;
}

function jsonError(res, status, message, code) {
  const body = { error: message || 'request failed' };
  if (code) body.code = code;
  return res.status(status).json(body);
}

function readBody(req) {
  const body = req && req.body;
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body;
  if (Buffer.isBuffer(body)) {
    try { return JSON.parse(body.toString('utf8')); } catch (error) { return {}; }
  }
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) { return {}; }
  }
  return {};
}

module.exports = {
  setCors,
  jsonError,
  readBody,
  isAllowedOrigin,
  headerValue,
};
