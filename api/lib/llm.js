'use strict';

const { translatePrompt } = require('./translate-prompt');

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-chat';
const LLM_TIMEOUT_MS = 20000;

function hasLLMKey() {
  return typeof process.env.AI_API_KEY === 'string' && process.env.AI_API_KEY.trim().length > 0;
}

function baseUrl() {
  return (process.env.AI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function pickModel() {
  const single = String(process.env.AI_TRANSLATE_MODEL || '').trim();
  if (single) return single;
  const allowed = String(process.env.AI_ALLOWED_MODELS || process.env.AI_DEFAULT_MODEL || DEFAULT_MODEL)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return allowed[0] || DEFAULT_MODEL;
}

/**
 * Chat model is chosen on the server only. A client-supplied model id is
 * ignored by the chat handler.
 */
function pickChatModel() {
  const chat = String(process.env.AI_CHAT_MODEL || '').trim();
  if (chat) return chat;
  return pickModel();
}

function timeoutSignal(ms) {
  try {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(ms);
    }
  } catch (error) { /* older runtimes */ }
  return undefined;
}

function parseLLMContent(raw) {
  let content = String(raw || '').trim();
  if (!content) throw new Error('empty upstream content');
  content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(content.slice(start, end + 1));
      if (parsed && typeof parsed.text === 'string' && parsed.text.trim()) {
        const out = { text: parsed.text.trim() };
        if (typeof parsed.roma === 'string' && parsed.roma.trim()) out.roma = parsed.roma.trim();
        return out;
      }
    } catch (error) { /* fall through to raw text */ }
  }
  return { text: content };
}

function sanitizeProfile(profile) {
  const source = profile && typeof profile === 'object' ? profile : {};
  return {
    nativeLang: typeof source.nativeLang === 'string' ? source.nativeLang.slice(0, 20) : '',
    goal: typeof source.goal === 'string' ? source.goal.slice(0, 200) : '',
    level: source.level != null ? String(source.level).slice(0, 20) : '',
  };
}

async function llmTranslate({ text, from, to, honorific, profile }) {
  if (!hasLLMKey()) throw new Error('AI_API_KEY missing');
  const model = pickModel();
  const system = translatePrompt();
  const user = JSON.stringify({
    text,
    from,
    to,
    honorific: !!honorific,
    profile: sanitizeProfile(profile),
  });
  const response = await fetch(baseUrl() + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + process.env.AI_API_KEY.trim(),
    },
    body: JSON.stringify({
      model,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: user },
      ],
      max_tokens: 1200,
    }),
    signal: timeoutSignal(LLM_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error('upstream LLM error');
    error.status = 502;
    error.upstreamStatus = response.status;
    throw error;
  }
  const content = data && data.choices && data.choices[0]
    && data.choices[0].message && data.choices[0].message.content;
  return parseLLMContent(content);
}

function clampTokens(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 600;
  return Math.max(64, Math.min(1600, Math.floor(parsed)));
}

/**
 * Plain-text tutor chat completion. Do not run the result through
 * parseLLMContent: that helper extracts the translation JSON shape.
 */
async function llmChat({ messages, system, maxTokens } = {}) {
  if (!hasLLMKey()) {
    const error = new Error('AI_API_KEY missing');
    error.code = 'ai_unconfigured';
    error.status = 503;
    throw error;
  }

  const history = (Array.isArray(messages) ? messages : [])
    .filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
    .map((message) => ({ role: message.role, content: String(message.content || '') }))
    .filter((message) => message.content.trim())
    .slice(-20);

  if (!history.length) {
    const error = new Error('empty messages');
    error.code = 'invalid_request';
    error.status = 400;
    throw error;
  }

  const response = await fetch(baseUrl() + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + process.env.AI_API_KEY.trim(),
    },
    body: JSON.stringify({
      model: pickChatModel(),
      messages: [
        ...(system ? [{ role: 'system', content: String(system) }] : []),
        ...history,
      ],
      max_tokens: clampTokens(maxTokens),
      temperature: 0.7,
    }),
    signal: timeoutSignal(LLM_TIMEOUT_MS),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error('upstream LLM error');
    error.code = 'ai_upstream_error';
    error.status = 502;
    error.upstreamStatus = response.status;
    throw error;
  }

  const content = data && data.choices && data.choices[0]
    && data.choices[0].message && data.choices[0].message.content;
  const reply = String(content == null ? '' : content).trim();
  if (!reply) {
    const error = new Error('empty upstream reply');
    error.code = 'ai_upstream_error';
    error.status = 502;
    throw error;
  }
  return reply;
}

module.exports = {
  hasLLMKey,
  llmTranslate,
  llmChat,
  parseLLMContent,
  sanitizeProfile,
  pickModel,
  pickChatModel,
};
