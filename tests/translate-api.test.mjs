import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const handler = require('../api/translate.js');

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    ended: false,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.ended = true; return this; },
    end() { this.ended = true; return this; },
  };
}

async function call(req) {
  const res = mockRes();
  await handler(req, res);
  return res;
}

function clearEnv() {
  delete process.env.AI_API_KEY;
  delete process.env.AI_BASE_URL;
  delete process.env.AI_DEFAULT_MODEL;
  delete process.env.AI_ALLOWED_MODELS;
  delete process.env.AI_TRANSLATE_MODEL;
  delete process.env.AI_LOG_CONVERSATIONS;
}

function installFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    calls.push({ url: href, options });
    for (const route of routes) {
      if (route.match(href)) return route.reply(href, options, calls);
    }
    throw new Error('unexpected fetch: ' + href);
  };
  return calls;
}

test('translate api: CORS preflight, method, and empty-body handling', async (t) => {
  clearEnv();
  t.after(clearEnv);

  let res = await call({ method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:4321' }, body: null });
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['access-control-allow-origin'], 'http://127.0.0.1:4321');
  assert.match(res.headers['access-control-allow-methods'], /POST/);

  res = await call({ method: 'OPTIONS', headers: { Origin: 'https://macshi716.github.io' }, body: null });
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['access-control-allow-origin'], 'https://macshi716.github.io');

  res = await call({ method: 'OPTIONS', headers: { Origin: 'https://korean-site-zhcn.vercel.app' }, body: null });
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['access-control-allow-origin'], 'https://korean-site-zhcn.vercel.app');

  res = await call({ method: 'GET', headers: { Origin: 'http://localhost:3000' }, body: null });
  assert.equal(res.statusCode, 405);

  res = await call({ method: 'POST', headers: { Origin: 'https://macshi716.github.io' }, body: {} });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'empty text');

  res = await call({ method: 'POST', headers: {}, body: { text: '   ' } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'empty text');
});

test('translate api: keyless MyMemory path returns the documented shape', async (t) => {
  clearEnv();
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; clearEnv(); });
  const calls = installFetch([
    {
      match: (href) => href.includes('api.mymemory.translated.net'),
      reply: () => ({
        ok: true,
        status: 200,
        json: async () => ({ responseStatus: 200, responseData: { translatedText: '안녕하세요' } }),
      }),
    },
  ]);

  const res = await call({
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:4321', 'Content-Type': 'application/json' },
    body: { text: '你好', from: 'zh', to: 'ko', honorific: true, profile: { nativeLang: 'zh' } },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { text: '안녕하세요' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /langpair=zh-CN%7Cko-KR/);
  assert.match(calls[0].url, /q=%E4%BD%A0%E5%A5%BD/);
  assert.equal(calls[0].options.method, 'GET');
});

test('translate api: AI_API_KEY selects the OpenAI-compatible path', async (t) => {
  clearEnv();
  process.env.AI_API_KEY = 'unit-test-key';
  process.env.AI_DEFAULT_MODEL = 'deepseek-chat';
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; clearEnv(); });
  const calls = installFetch([
    {
      match: (href) => href.endsWith('/chat/completions'),
      reply: () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"text":"안녕하세요","roma":"annyeonghaseyo"}' } }],
        }),
      }),
    },
  ]);

  const res = await call({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { text: 'hello', from: 'en', to: 'ko', honorific: true },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { text: '안녕하세요', roma: 'annyeonghaseyo' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer unit-test-key');
  assert.match(calls[0].url, /api\.deepseek\.com\/v1\/chat\/completions$/);
  const sent = JSON.parse(calls[0].options.body);
  assert.equal(sent.model, 'deepseek-chat');
  assert.equal(sent.messages[0].role, 'system');
  assert.match(sent.messages[0].content, /JSON/);
  assert.match(sent.messages[1].content, /hello/);
});

test('translate api: MyMemory failure falls through to the keyless secondary', async (t) => {
  clearEnv();
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; clearEnv(); });
  const calls = installFetch([
    {
      match: (href) => href.includes('api.mymemory.translated.net'),
      reply: () => ({ ok: false, status: 503, json: async () => ({}) }),
    },
    {
      match: (href) => href.includes('translate.googleapis.com'),
      reply: () => ({
        ok: true,
        status: 200,
        json: async () => [[['안녕하세요', '你好', null, null, 10]], null, 'zh-CN'],
      }),
    },
  ]);

  const res = await call({
    method: 'POST',
    headers: {},
    body: { text: '你好', from: 'zh', to: 'ko' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.text, '안녕하세요');
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /translate\.googleapis\.com/);
});

test('translate api: configured key failure still tries the keyless path', async (t) => {
  clearEnv();
  process.env.AI_API_KEY = 'unit-test-key';
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; clearEnv(); });
  const calls = installFetch([
    {
      match: (href) => href.endsWith('/chat/completions'),
      reply: () => ({ ok: false, status: 500, json: async () => ({}) }),
    },
    {
      match: (href) => href.includes('api.mymemory.translated.net'),
      reply: () => ({
        ok: true,
        status: 200,
        json: async () => ({ responseStatus: 200, responseData: { translatedText: '안녕하세요' } }),
      }),
    },
  ]);

  const res = await call({
    method: 'POST',
    headers: {},
    body: { text: 'hello', from: 'en', to: 'ko' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.text, '안녕하세요');
  assert.equal(calls.length, 2);
});

test('translate api: unsupported language and same-language identity', async (t) => {
  clearEnv();
  t.after(clearEnv);
  let res = await call({ method: 'POST', headers: {}, body: { text: 'hi', from: 'fr', to: 'ko' } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'unsupported language');

  res = await call({ method: 'POST', headers: {}, body: { text: '그대로', from: 'ko', to: 'ko' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { text: '그대로' });
});
