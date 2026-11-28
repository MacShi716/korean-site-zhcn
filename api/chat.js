'use strict';

const { createHash } = require('crypto');
const { setCors, jsonError, readBody } = require('./lib/http');
const { hasLLMKey, llmChat, sanitizeProfile } = require('./lib/llm');
const { buildChatSystem } = require('./lib/chat-prompt');
const {
  bearer,
  loadMembership,
  refundQuota,
  reserveQuota,
  verifyAccessToken,
} = require('./lib/membership');

const MAX_MESSAGE_CHARS = 4000;
const MAX_MESSAGES = 20;
const LOCALES = new Set(['zh', 'en', 'ko']);

function headerValue(req, name) {
  const headers = req && req.headers;
  if (!headers || typeof headers !== 'object') return '';
  const direct = headers[name];
  if (typeof direct === 'string') return direct;
  const found = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  return found && typeof headers[found] === 'string' ? headers[found] : '';
}

function normalizeLocale(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return LOCALES.has(raw) ? raw : 'zh';
}

function normalizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    if (item.role !== 'user' && item.role !== 'assistant') continue;
    const content = typeof item.content === 'string'
      ? item.content.slice(0, MAX_MESSAGE_CHARS).trim()
      : '';
    if (!content) continue;
    out.push({ role: item.role, content });
  }
  const tail = out.slice(-MAX_MESSAGES);
  if (!tail.some((message) => message.role === 'user')) return [];
  return tail;
}

function userTag(userId) {
  if (!userId) return 'absent';
  return createHash('sha256').update(String(userId)).digest('hex').slice(0, 12);
}

function logRoute(meta) {
  if (process.env.AI_LOG_CONVERSATIONS !== '1') return;
  try {
    console.log(JSON.stringify(meta));
  } catch (error) { /* metadata logging is best effort */ }
}

function fail(res, status, message, code, meta) {
  logRoute(Object.assign({ route: 'chat', status, code }, meta || {}));
  return jsonError(res, status, message, code);
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return fail(res, 405, 'method not allowed', 'method_not_allowed', { user: 'absent' });
  }

  const body = readBody(req);
  const messages = normalizeMessages(body.messages);
  if (!messages.length) {
    return fail(res, 400, 'empty messages', 'invalid_request', { user: 'absent' });
  }

  const locale = normalizeLocale(body.locale);
  const profile = sanitizeProfile(body.profile);
  const chars = messages.reduce((total, message) => total + message.content.length, 0);

  const token = bearer(headerValue(req, 'authorization'));
  if (!token) {
    return fail(res, 401, 'login required', 'login_required', { user: 'absent', chars });
  }

  let user = null;
  try {
    user = await verifyAccessToken(token);
  } catch (error) {
    return fail(res, 401, 'login required', 'login_required', { user: 'invalid', chars });
  }

  const meta = { user: userTag(user.id), chars };

  let membership = null;
  try {
    membership = await loadMembership(user.id);
  } catch (error) {
    return fail(res, 503, 'membership not configured', 'membership_unconfigured', meta);
  }

  if (!membership.isMember) {
    return fail(res, 403, 'membership required', 'membership_required', meta);
  }
  if (!(membership.quotaRemaining >= 1)) {
    return fail(res, 403, 'AI quota exhausted', 'quota_exhausted', meta);
  }

  // Check the model key before reserving quota so a missing key cannot consume.
  if (!hasLLMKey()) {
    return fail(res, 503, 'AI service not configured', 'ai_unconfigured', meta);
  }

  let quotaRemaining = null;
  try {
    quotaRemaining = await reserveQuota(user.id);
  } catch (error) {
    if (error && error.code === 'quota_exhausted') {
      return fail(res, 403, 'AI quota exhausted', 'quota_exhausted', meta);
    }
    return fail(res, 503, 'membership not configured', 'membership_unconfigured', meta);
  }

  let reply = '';
  try {
    reply = await llmChat({
      messages,
      system: buildChatSystem({ locale, profile }),
      maxTokens: 600,
    });
  } catch (error) {
    // The slot was reserved but no reply exists: put it back.
    await refundQuota(user.id);
    return fail(res, 502, 'tutor unavailable', 'ai_upstream_error', meta);
  }

  if (!reply) {
    await refundQuota(user.id);
    return fail(res, 502, 'tutor unavailable', 'ai_upstream_error', meta);
  }

  logRoute(Object.assign({ route: 'chat', status: 200, ok: true }, meta));
  return res.status(200).json({ reply, quotaRemaining });
};

module.exports.MAX_MESSAGE_CHARS = MAX_MESSAGE_CHARS;
module.exports.MAX_MESSAGES = MAX_MESSAGES;
module.exports.normalizeMessages = normalizeMessages;
module.exports.normalizeLocale = normalizeLocale;
