/**
 * In-page Korean tutor contract.
 *
 * Uses the throwaway Chrome CDP harness from the other page tests. The local
 * static server mocks /api/chat, so no real model or Supabase project is used.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import test from "node:test";

const ROOT = new URL("..", import.meta.url);
const SESSION_KEY = "korean-site-auth-session";
const LEARNING_KEY = "koreanSite_zhcn_draft_v01";
const MOCK_REPLY = "토마토 스크램블 에그예요. 문장으로 한 번 말해 보세요.";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".vtt": "text/vtt",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".bin": "application/octet-stream",
};

function startSite() {
  const state = { chatRequests: [], mode: "success" };
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let path = decodeURIComponent(url.pathname);
    if (path === "/korean-site-zhcn" || path === "/korean-site-zhcn/") path = "/index.html";
    else if (path.startsWith("/korean-site-zhcn/")) path = path.slice("/korean-site-zhcn".length);
    if (path === "/") path = "/index.html";

    if (path === "/api/chat") {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": req.headers.origin || "*",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "Content-Type, Authorization",
        });
        res.end();
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "method not allowed", code: "method_not_allowed" }));
        return;
      }
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        let body = {};
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch (error) { body = {}; }
        state.chatRequests.push({ method: req.method, path, body, authorization: req.headers.authorization || "" });
        const modes = {
          login: [401, { error: "login required", code: "login_required" }],
          membership: [403, { error: "membership required", code: "membership_required" }],
          quota: [403, { error: "AI quota exhausted", code: "quota_exhausted" }],
          membership_unconfigured: [503, { error: "membership not configured", code: "membership_unconfigured" }],
          ai_unconfigured: [503, { error: "AI service not configured", code: "ai_unconfigured" }],
          upstream: [502, { error: "tutor unavailable", code: "ai_upstream_error" }],
        };
        if (state.mode === "success") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ reply: MOCK_REPLY, quotaRemaining: 4 }));
          return;
        }
        const [status, payload] = modes[state.mode] || modes.upstream;
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      });
      return;
    }

    try {
      const body = readFileSync(join(ROOT.pathname, path));
      res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("missing");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}`, state }));
  });
}

async function launchChrome() {
  const dir = mkdtempSync(join(tmpdir(), "korean-tutor-"));
  const chrome = spawn("google-chrome", [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--remote-debugging-port=0",
    `--user-data-dir=${dir}`,
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let buf = "";
  const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("chrome did not expose DevTools")), 15000);
    const onData = (chunk) => {
      buf += chunk.toString();
      const match = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    };
    chrome.stderr.on("data", onData);
    chrome.stdout.on("data", onData);
    chrome.on("exit", () => reject(new Error("chrome exited")));
  });
  const version = await (await fetch(wsUrl.replace(/^ws/, "http").replace(/\/devtools\/browser.*$/, "/json/version"))).json();
  const browser = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve) => browser.addEventListener("open", resolve, { once: true }));
  let seq = 0;
  const pending = new Map();
  browser.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    browser.send(JSON.stringify({ id, method, params, sessionId }));
  });

  async function newPage(initScript) {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Page.enable", {}, sessionId);
    await send("Runtime.enable", {}, sessionId);
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try { window.__koreanDocToken = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + "-" + Math.random()); } catch (error) {}`
        + (initScript ? `\n${initScript}` : ""),
    }, sessionId);
    const page = {
      targetId,
      sessionId,
      async evaluate(expression) {
        const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
        return result.result.value;
      },
      async open(url) {
        const before = await this.evaluate("window.__koreanDocToken || null").catch(() => null);
        await send("Page.navigate", { url }, sessionId);
        let fresh = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          try {
            const state = await this.evaluate(`({
              ready: document.readyState,
              href: location.href,
              token: window.__koreanDocToken || null
            })`);
            if (state.ready === "complete" && state.href === url && state.token && state.token !== before) {
              fresh = true;
              break;
            }
          } catch (error) { /* old execution context */ }
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        if (!fresh) throw new Error("fresh document did not commit for " + url);
        await this.evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve('ok')))");
      },
      async setSize(width, height, mobile) {
        await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile }, sessionId);
      },
      async close() {
        try { await send("Target.closeTarget", { targetId }, sessionId); } catch (error) {}
      },
    };
    return page;
  }

  return { newPage, async close() { browser.close(); chrome.kill(); } };
}

async function waitFor(page, expression, timeout = 8000) {
  const deadline = Date.now() + timeout;
  do {
    try {
      if (await page.evaluate(`!!(${expression})`)) return true;
    } catch (error) { /* navigation replaced the current execution context */ }
    await new Promise((resolve) => setTimeout(resolve, 30));
  } while (Date.now() < deadline);
  return false;
}

async function boot(page, site) {
  await page.open(`${site.origin}/index.html`);
  const ready = await waitFor(page, `window.__koreanSite && document.querySelector("#main-nav")`);
  assert.equal(ready, true, "index.html did not boot");
}

async function openTutor(page) {
  await page.evaluate(`window.__koreanSite.showPanel('ai')`);
  const ready = await waitFor(page, `document.querySelector("#panel-ai.active") && document.querySelector("#ai-input")`);
  assert.equal(ready, true, "tutor panel did not render");
}

async function setSession(page, token = "fake-access-token") {
  await page.evaluate(`(() => {
    localStorage.setItem(${JSON.stringify(SESSION_KEY)}, JSON.stringify({
      access_token: ${JSON.stringify(token)},
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "11111111-1111-4111-8111-111111111111" }
    }));
  })()`);
}

async function resetChat(page) {
  await page.evaluate(`(() => {
    const api = window.__koreanSite;
    api.state.aiChat.messages = [];
    api.state.aiChat.autoSpeak = false;
    api.saveState();
    api.showPanel('ai');
  })()`);
}

async function sendTutorMessage(page, text) {
  await page.evaluate(`(() => {
    const input = document.getElementById('ai-input');
    input.value = ${JSON.stringify(text)};
    document.getElementById('ai-send').click();
  })()`);
}

test("in-page Korean tutor: endpoint, gating, voice controls, and mocked replies", async (t) => {
  const site = await startSite();
  const browser = await launchChrome();
  const page = await browser.newPage();
  t.after(async () => {
    await page.close();
    await browser.close();
    await new Promise((resolve) => site.server.close(resolve));
  });

  await page.setSize(390, 844, true);
  await boot(page, site);

  await t.test("AI_ENDPOINT uses /api/chat locally and the Vercel origin on GitHub Pages", async () => {
    const endpoints = await page.evaluate(`(() => {
      const api = window.__koreanSite;
      return {
        current: api.AI_ENDPOINT,
        translate: api.TRANSLATE_ENDPOINT,
        github: api.apiEndpointForHost('macshi716.github.io', 'chat'),
        vercel: api.apiEndpointForHost('preview-abc.vercel.app', 'chat'),
        localhost: api.apiEndpointForHost('localhost', 'chat'),
        empty: api.apiEndpointForHost('', 'chat')
      };
    })()`);
    assert.equal(endpoints.current, "/api/chat");
    assert.equal(endpoints.translate, "/api/translate");
    assert.equal(endpoints.github, "https://korean-site-zhcn.vercel.app/api/chat");
    assert.equal(endpoints.vercel, "/api/chat");
    assert.equal(endpoints.localhost, "/api/chat");
    assert.equal(endpoints.empty, "https://korean-site-zhcn.vercel.app/api/chat");
  });

  await t.test("opening the ai panel never covers Practice with the login gate", async () => {
    await openTutor(page);
    const view = await page.evaluate(`({
      gateHidden: document.getElementById('auth-gate').hidden,
      locked: document.body.classList.contains('auth-locked'),
      mic: !!document.getElementById('ai-mic'),
      autoSpeak: !!document.getElementById('ai-autospeak'),
      send: !!document.getElementById('ai-send'),
      text: document.getElementById('panel-ai').innerText
    })`);
    assert.equal(view.gateHidden, true);
    assert.equal(view.locked, false);
    assert.equal(view.mic, true);
    assert.equal(view.autoSpeak, true);
    assert.equal(view.send, true);
    assert.match(view.text, /会员|membership|멤버십/);
    assert.match(view.text, /购买|purchase|결제/);
  });

  await t.test("no real session: send shows login copy, offers sign-in, and never calls /api/chat", async () => {
    await page.evaluate(`localStorage.removeItem(${JSON.stringify(SESSION_KEY)})`);
    await page.evaluate(`localStorage.removeItem(${JSON.stringify(LEARNING_KEY)})`);
    await boot(page, site);
    await openTutor(page);
    site.state.chatRequests.length = 0;
    await sendTutorMessage(page, "안녕하세요");
    const shown = await waitFor(page, `document.querySelector('#panel-ai .ai-msg.system[data-code="login_required"]')`);
    assert.equal(shown, true, "login-required message did not appear");
    const view = await page.evaluate(`({
      requests: ${site.state.chatRequests.length},
      assistant: document.querySelectorAll('#panel-ai .ai-msg.assistant').length,
      text: document.querySelector('#panel-ai .ai-msg.system').innerText,
      signIn: !!document.querySelector('#panel-ai [data-ai-login]'),
      gateHidden: document.getElementById('auth-gate').hidden
    })`);
    assert.equal(view.requests, 0);
    assert.equal(view.assistant, 0);
    assert.equal(view.signIn, true);
    assert.match(view.text, /真实账号|real account|실제 계정/);
    assert.equal(view.gateHidden, true);
  });

  await t.test("a mocked 401 surfaces login copy, sends the bearer token, and inserts no fake lesson", async () => {
    site.state.mode = "login";
    await setSession(page, "expired-or-invalid-token");
    await resetChat(page);
    site.state.chatRequests.length = 0;
    await sendTutorMessage(page, "이거 한국어로 뭐예요?");
    const shown = await waitFor(page, `document.querySelector('#panel-ai .ai-msg.system[data-code="login_required"]')`);
    assert.equal(shown, true);
    const view = await page.evaluate(`({
      assistant: document.querySelectorAll('#panel-ai .ai-msg.assistant').length,
      text: document.querySelector('#panel-ai .ai-msg.system').innerText
    })`);
    assert.equal(view.assistant, 0);
    assert.match(view.text, /真实账号|real account|실제 계정/);
    assert.equal(site.state.chatRequests.length, 1);
    assert.equal(site.state.chatRequests[0].authorization, "Bearer expired-or-invalid-token");
    assert.equal("model" in site.state.chatRequests[0].body, false);
    assert.equal(site.state.chatRequests[0].body.messages.slice(-1)[0].content, "이거 한국어로 뭐예요?");
  });

  await t.test("a mocked 403 membership error says purchase is not connected and inserts no reply", async () => {
    site.state.mode = "membership";
    await setSession(page);
    await resetChat(page);
    site.state.chatRequests.length = 0;
    await sendTutorMessage(page, "안녕하세요");
    const shown = await waitFor(page, `document.querySelector('#panel-ai .ai-msg.system[data-code="membership_required"]')`);
    assert.equal(shown, true);
    const view = await page.evaluate(`({
      assistant: document.querySelectorAll('#panel-ai .ai-msg.assistant').length,
      text: document.querySelector('#panel-ai .ai-msg.system').innerText
    })`);
    assert.equal(view.assistant, 0);
    assert.match(view.text, /会员|membership|멤버십/);
    assert.match(view.text, /购买|purchase|결제/);
    assert.equal(site.state.chatRequests.length, 1);
  });

  await t.test("a mocked 403 quota error never spends site learning energy and inserts no reply", async () => {
    site.state.mode = "quota";
    await setSession(page);
    await resetChat(page);
    site.state.chatRequests.length = 0;
    await sendTutorMessage(page, "안녕하세요");
    const shown = await waitFor(page, `document.querySelector('#panel-ai .ai-msg.system[data-code="quota_exhausted"]')`);
    assert.equal(shown, true);
    const view = await page.evaluate(`({
      assistant: document.querySelectorAll('#panel-ai .ai-msg.assistant').length,
      text: document.querySelector('#panel-ai .ai-msg.system').innerText
    })`);
    assert.equal(view.assistant, 0);
    assert.match(view.text, /额度|quota|할당량/);
    assert.match(view.text, /学习能量|learning energy|학습 에너지/);
    assert.equal(site.state.chatRequests.length, 1);
  });

  await t.test("a mocked 503 unconfigured server stays honest and inserts no reply", async () => {
    for (const mode of ["membership_unconfigured", "ai_unconfigured"]) {
      site.state.mode = mode;
      await setSession(page);
      await resetChat(page);
      site.state.chatRequests.length = 0;
      await sendTutorMessage(page, "안녕하세요");
      const shown = await waitFor(page, `document.querySelector('#panel-ai .ai-msg.system[data-code="${mode}"]')`);
      assert.equal(shown, true, mode + " message did not appear");
      const view = await page.evaluate(`({
        assistant: document.querySelectorAll('#panel-ai .ai-msg.assistant').length,
        text: document.querySelector('#panel-ai .ai-msg.system').innerText
      })`);
      assert.equal(view.assistant, 0);
      assert.match(view.text, /尚未配置|not configured|아직 설정되지/);
      assert.equal(site.state.chatRequests.length, 1);
    }
  });

  await t.test("a successful mocked reply renders the assistant bubble and respects auto-speak off", async () => {
    site.state.mode = "success";
    await setSession(page);
    await resetChat(page);
    const toggled = await page.evaluate(`(() => {
      const button = document.getElementById('ai-autospeak');
      if (!button) return null;
      if (button.getAttribute('aria-pressed') !== 'false') button.click();
      return {
        pressed: button.getAttribute('aria-pressed'),
        stored: window.__koreanSite.state.aiChat.autoSpeak
      };
    })()`);
    assert.equal(toggled.pressed, "false");
    assert.equal(toggled.stored, false);
    site.state.chatRequests.length = 0;
    await sendTutorMessage(page, "tomato scrambled eggs 怎么说?");
    const shown = await waitFor(page, `document.querySelector('#panel-ai .ai-msg.assistant')`);
    assert.equal(shown, true, "assistant bubble did not appear");
    const view = await page.evaluate(`({
      reply: document.querySelector('#panel-ai .ai-msg.assistant .ai-msg-body').innerText,
      assistant: document.querySelectorAll('#panel-ai .ai-msg.assistant').length,
      system: document.querySelectorAll('#panel-ai .ai-msg.system').length,
      status: document.getElementById('ai-status').innerText,
      speakButton: !!document.querySelector('#panel-ai [data-ai-speak-msg]')
    })`);
    assert.equal(view.reply, MOCK_REPLY);
    assert.equal(view.assistant, 1);
    assert.equal(view.system, 0);
    assert.match(view.status, /4/);
    assert.equal(view.speakButton, true);
    assert.equal(site.state.chatRequests.length, 1);
    assert.equal(site.state.chatRequests[0].body.messages.slice(-1)[0].role, "user");
    assert.equal("model" in site.state.chatRequests[0].body, false);
  });

  await t.test("without SpeechRecognition the mic explains itself instead of faking input", async () => {
    const noSpeech = await browser.newPage(`
      try {
        Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
        Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
      } catch (error) {
        window.SpeechRecognition = undefined;
        window.webkitSpeechRecognition = undefined;
      }
    `);
    try {
      await noSpeech.setSize(390, 844, true);
      await boot(noSpeech, site);
      await openTutor(noSpeech);
      const view = await noSpeech.evaluate(`({
        sr: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
        note: document.getElementById('ai-mic-note') ? document.getElementById('ai-mic-note').innerText : '',
        disabled: document.getElementById('ai-mic').getAttribute('aria-disabled')
      })`);
      assert.equal(view.sr, false);
      assert.equal(view.disabled, "true");
      assert.match(view.note, /不支持|not supported|지원하지/);
      await noSpeech.evaluate(`document.getElementById('ai-mic').click()`);
      const toast = await noSpeech.evaluate(`document.getElementById('toast').innerText`);
      assert.match(toast, /不支持|not supported|지원하지/);
    } finally {
      await noSpeech.close();
    }
  });
});
