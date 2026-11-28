'use strict';

/*
 * Server-only membership, auth, and AI-quota helpers.
 *
 * Auth lookup uses the project's public URL and publishable key. Membership
 * reads and quota changes use the service role key from the server env. No
 * key in this file is a service role key.
 */

const FALLBACK_SUPABASE_URL = 'https://fehowefhgzjmdlpaoqig.supabase.co';
// This is the already-public publishable key from auth/public-config.js.
const FALLBACK_PUBLISHABLE_KEY = 'sb_publishable_EB24M3cyE7V1bd3R9BSLEg_ONASeRiT';

const AUTH_TIMEOUT_MS = 10000;
const DB_TIMEOUT_MS = 10000;

function codedError(code, status, message) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

function loginRequired() {
  return codedError('login_required', 401, 'login required');
}

function membershipUnconfigured() {
  return codedError('membership_unconfigured', 503, 'membership store unavailable');
}

function quotaExhausted() {
  return codedError('quota_exhausted', 403, 'AI quota exhausted');
}

function supabaseUrl() {
  return String(process.env.SUPABASE_URL || process.env.AI_SUPABASE_URL || FALLBACK_SUPABASE_URL)
    .trim()
    .replace(/\/+$/, '');
}

function publishableKey() {
  return String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || FALLBACK_PUBLISHABLE_KEY)
    .trim();
}

function serviceRoleKey() {
  return String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();
}

function hasMembershipStore() {
  return serviceRoleKey().length > 0;
}

function timeoutSignal(ms) {
  try {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(ms);
    }
  } catch (error) { /* older runtimes */ }
  return undefined;
}

function bearer(value) {
  const raw = String(value || '');
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function verifyAccessToken(token) {
  const accessToken = String(token || '').trim();
  if (!accessToken || accessToken.length > 12000) throw loginRequired();

  let response;
  try {
    response = await fetch(supabaseUrl() + '/auth/v1/user', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        apikey: publishableKey(),
        Accept: 'application/json',
      },
      signal: timeoutSignal(AUTH_TIMEOUT_MS),
    });
  } catch (error) {
    throw loginRequired();
  }

  if (!response || !response.ok) throw loginRequired();

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    throw loginRequired();
  }

  const user = data && typeof data === 'object' && data.user && typeof data.user === 'object' ? data.user : data;
  const id = user && typeof user.id === 'string' ? user.id : '';
  if (!id) throw loginRequired();
  return { id, user };
}

function normalizeRemaining(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Math.max(0, Math.floor(Number(value)));
  }
  if (Array.isArray(value) && value.length === 1) return normalizeRemaining(value[0]);
  if (value && typeof value === 'object') {
    if ('ai_quota_remaining' in value) return normalizeRemaining(value.ai_quota_remaining);
    if ('consume_ai_quota' in value) return normalizeRemaining(value.consume_ai_quota);
    if ('refund_ai_quota' in value) return normalizeRemaining(value.refund_ai_quota);
    if ('remaining' in value) return normalizeRemaining(value.remaining);
  }
  return null;
}

function rowQuota(row) {
  const parsed = normalizeRemaining(row && row.ai_quota_remaining);
  return parsed == null ? 0 : parsed;
}

async function loadMembership(userId) {
  const key = serviceRoleKey();
  if (!key) throw membershipUnconfigured();
  const id = String(userId || '').trim();
  if (!id) throw loginRequired();

  const url = supabaseUrl()
    + '/rest/v1/ai_memberships?user_id=eq.' + encodeURIComponent(id)
    + '&select=is_member,ai_quota_remaining&limit=1';

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        Accept: 'application/json',
      },
      signal: timeoutSignal(DB_TIMEOUT_MS),
    });
  } catch (error) {
    throw membershipUnconfigured();
  }

  if (!response || !response.ok) throw membershipUnconfigured();

  let rows = null;
  try {
    rows = await response.json();
  } catch (error) {
    throw membershipUnconfigured();
  }
  if (rows && !Array.isArray(rows) && typeof rows === 'object') rows = [rows];
  if (!Array.isArray(rows)) throw membershipUnconfigured();
  if (!rows.length) return { isMember: false, quotaRemaining: 0 };

  const row = rows[0] || {};
  return {
    isMember: row.is_member === true,
    quotaRemaining: rowQuota(row),
  };
}

async function callQuotaRpc(name, userId) {
  const key = serviceRoleKey();
  if (!key) throw membershipUnconfigured();
  const id = String(userId || '').trim();
  if (!id) throw loginRequired();

  let response;
  try {
    response = await fetch(supabaseUrl() + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: 'Bearer ' + key,
        Accept: 'application/json',
      },
      body: JSON.stringify({ p_user_id: id }),
      signal: timeoutSignal(DB_TIMEOUT_MS),
    });
  } catch (error) {
    throw membershipUnconfigured();
  }

  if (!response || !response.ok) throw membershipUnconfigured();

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    throw membershipUnconfigured();
  }
  return normalizeRemaining(data);
}

/**
 * Reserve one AI quota unit atomically. Returns the remaining balance.
 * Throws quota_exhausted when the RPC made no update (zero quota or race).
 */
async function reserveQuota(userId) {
  const remaining = await callQuotaRpc('consume_ai_quota', userId);
  if (remaining == null) throw quotaExhausted();
  return remaining;
}

/** Best-effort refund after a reserved slot could not produce a reply. */
async function refundQuota(userId) {
  try {
    await callQuotaRpc('refund_ai_quota', userId);
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  AUTH_TIMEOUT_MS,
  DB_TIMEOUT_MS,
  bearer,
  hasMembershipStore,
  loadMembership,
  publishableKey,
  refundQuota,
  reserveQuota,
  serviceRoleKey,
  supabaseUrl,
  verifyAccessToken,
  // exported for focused tests
  normalizeRemaining,
};
