'use strict';

/*
 * Keyless machine-translation fallback. Both endpoints are public and
 * documented, run on the server, and need no credential. If MyMemory cannot
 * serve the request (length limit, quota, outage), the handler tries the
 * Google gtx endpoint before giving up.
 *
 * No frontend code ever sees these URLs.
 */

const MT_TIMEOUT_MS = 9000;
const MYMEMORY_MAX_CHARS = 480;

const TO_MYMEMORY = { zh: 'zh-CN', ko: 'ko-KR', en: 'en' };
const TO_GOOGLE = { zh: 'zh-CN', ko: 'ko', en: 'en' };

function timeoutSignal(ms) {
  try {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(ms);
    }
  } catch (error) { /* older runtimes */ }
  return undefined;
}

function cleanTranslation(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  if (/^MYMEMORY WARNING/i.test(text)) return '';
  if (/QUERY LENGTH LIMIT/i.test(text)) return '';
  if (/INVALID LANGUAGE PAIR/i.test(text)) return '';
  return text;
}

async function myMemory({ text, from, to }) {
  const source = TO_MYMEMORY[from] || 'zh-CN';
  const target = TO_MYMEMORY[to] || 'ko-KR';
  const url = 'https://api.mymemory.translated.net/get?'
    + new URLSearchParams({ q: text, langpair: source + '|' + target }).toString();
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: timeoutSignal(MT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error('MyMemory HTTP ' + response.status);
  const data = await response.json().catch(() => null);
  if (!data || (data.responseStatus != null && Number(data.responseStatus) !== 200)) {
    throw new Error('MyMemory response status');
  }
  const translated = cleanTranslation(data.responseData && data.responseData.translatedText);
  if (!translated) throw new Error('MyMemory empty translation');
  return { text: translated, provider: 'mymemory' };
}

async function googleGtx({ text, from, to }) {
  const source = TO_GOOGLE[from] || 'zh-CN';
  const target = TO_GOOGLE[to] || 'ko';
  const url = 'https://translate.googleapis.com/translate_a/single?'
    + new URLSearchParams({ client: 'gtx', sl: source, tl: target, dt: 't', q: text }).toString();
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: timeoutSignal(MT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error('Google gtx HTTP ' + response.status);
  const data = await response.json().catch(() => null);
  if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error('Google gtx malformed response');
  const translated = cleanTranslation(data[0].map((part) => (Array.isArray(part) ? part[0] : '')).join(''));
  if (!translated) throw new Error('Google gtx empty translation');
  return { text: translated, provider: 'google-gtx' };
}

async function machineTranslate({ text, from, to }) {
  const attempts = [];
  if (String(text).length <= MYMEMORY_MAX_CHARS) attempts.push(myMemory);
  attempts.push(googleGtx);
  const errors = [];
  for (const attempt of attempts) {
    try {
      return await attempt({ text, from, to });
    } catch (error) {
      errors.push(error && error.message ? error.message : String(error));
    }
  }
  const error = new Error('keyless translation failed');
  error.status = 502;
  error.attempts = errors;
  throw error;
}

module.exports = {
  machineTranslate,
  myMemory,
  googleGtx,
  MYMEMORY_MAX_CHARS,
};
