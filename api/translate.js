'use strict';

const { setCors, jsonError } = require('./lib/http');
const { hasLLMKey, llmTranslate } = require('./lib/llm');
const { machineTranslate } = require('./lib/mt');

const MAX_TEXT = 4000;
const LANGS = new Set(['zh', 'ko', 'en']);
const LANG_ALIASES = {
  'zh-cn': 'zh',
  'zh-hans': 'zh',
  'zh-hant': 'zh',
  'ko-kr': 'ko',
  'en-us': 'en',
  'en-gb': 'en',
};

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

function normalizeLang(value) {
  if (typeof value !== 'string') return '';
  const raw = value.trim().toLowerCase();
  if (LANGS.has(raw)) return raw;
  return LANG_ALIASES[raw] || '';
}

function sanitizeProfile(profile) {
  const source = profile && typeof profile === 'object' ? profile : {};
  return {
    nativeLang: typeof source.nativeLang === 'string' ? source.nativeLang.slice(0, 20) : '',
    goal: typeof source.goal === 'string' ? source.goal.slice(0, 200) : '',
    level: source.level != null ? String(source.level).slice(0, 20) : '',
  };
}

function publicResult(result) {
  const out = { text: String(result.text) };
  if (typeof result.roma === 'string' && result.roma.trim()) out.roma = result.roma.trim();
  return out;
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return jsonError(res, 405, 'method not allowed');

  const body = readBody(req);
  const rawText = typeof body.text === 'string' ? body.text : '';
  const text = rawText.slice(0, MAX_TEXT).trim();
  if (!text) return jsonError(res, 400, 'empty text');

  const from = normalizeLang(body.from);
  const to = normalizeLang(body.to);
  if ((body.from != null && !from) || (body.to != null && !to)) {
    return jsonError(res, 400, 'unsupported language');
  }
  const source = from || 'zh';
  const target = to || 'ko';
  if (source === target) return res.status(200).json({ text });

  const honorific = !!body.honorific;
  const profile = sanitizeProfile(body.profile);

  try {
    let result = null;
    let path = 'keyless';
    if (hasLLMKey()) {
      path = 'llm';
      try {
        result = await llmTranslate({ text, from: source, to: target, honorific, profile });
      } catch (error) {
        // A configured key that fails should not take the whole page down.
        // The keyless path is a real translation, never a browser invention.
        path = 'llm-failed-keyless';
        result = await machineTranslate({ text, from: source, to: target });
      }
    } else {
      result = await machineTranslate({ text, from: source, to: target });
    }

    if (process.env.AI_LOG_CONVERSATIONS === '1') {
      console.log(JSON.stringify({
        route: 'translate',
        path,
        from: source,
        to: target,
        chars: text.length,
        ok: !!(result && result.text),
      }));
    }
    return res.status(200).json(publicResult(result));
  } catch (error) {
    if (process.env.AI_LOG_CONVERSATIONS === '1') {
      console.log(JSON.stringify({ route: 'translate', ok: false, error: 'upstream failed' }));
    }
    const status = error && error.status === 400 ? 400 : 502;
    return jsonError(res, status, 'translation unavailable');
  }
};

module.exports.MAX_TEXT = MAX_TEXT;
module.exports.normalizeLang = normalizeLang;
module.exports.readBody = readBody;
