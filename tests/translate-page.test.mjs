/**
 * Standalone translate page contract.
 *
 * Runs with the same throwaway Chrome CDP harness used by the other suites.
 * The local static server mocks POST /api/translate so the test never touches
 * the public network.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import test from "node:test";

const ROOT = new URL("..", import.meta.url);
const MOCK_KO = "안녕하세요, 만나서 반갑습니다.";
const MOCK_ZH = "你好，很高兴见到你。";
const MOCK_EN = "Hello, nice to meet you.";
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
  const state = { requests: [], failNext: false };
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let path = decodeURIComponent(url.pathname);
    if (path === "/korean-site-zhcn" || path === "/korean-site-zhcn/") path = "/index.html";
    else if (path.startsWith("/korean-site-zhcn/")) path = path.slice("/korean-site-zhcn".length);
    if (path === "/") path = "/index.html";
    if (path === "/api/translate") {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": req.headers.origin || "*",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "Content-Type",
        });
        res.end();
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "method not allowed" }));
        return;
      }
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        let body = {};
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch (error) { body = {}; }
        state.requests.push({ method: req.method, path, body });
        if (state.failNext) {
          state.failNext = false;
          res.writeHead(502, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "mock upstream down" }));
          return;
        }
        const to = body.to === "zh" ? "zh" : body.to === "en" ? "en" : "ko";
        const text = to === "zh" ? MOCK_ZH : to === "en" ? MOCK_EN : MOCK_KO;
        const payload = { text };
        if (to === "ko") payload.roma = "annyeonghaseyo";
        res.writeHead(200, { "content-type": "application/json" });
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
  const dir = mkdtempSync(join(tmpdir(), "korean-translate-"));
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

  async function newPage() {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Page.enable", {}, sessionId);
    await send("Runtime.enable", {}, sessionId);
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try { window.__koreanDocToken = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + "-" + Math.random()); } catch (error) {}`
    }, sessionId);
    const page = {
      targetId,
      sessionId,
      async evaluate(expression) {
        const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
        return result.result.value;
      },
      async navigate(url) {
        await send("Page.navigate", { url }, sessionId);
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

function rectsScript() {
  return `(() => {
    const source = document.querySelector("#tr-source-pane").getBoundingClientRect();
    const target = document.querySelector("#tr-target-pane").getBoundingClientRect();
    return {
      source: { left: source.left, right: source.right, top: source.top, bottom: source.bottom, width: source.width },
      target: { left: target.left, right: target.right, top: target.top, bottom: target.bottom, width: target.width },
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth
    };
  })()`;
}

test("standalone translate page: chrome, layout, swap, live API, theme, and practice tab", async (t) => {
  const site = await startSite();
  const browser = await launchChrome();
  const page = await browser.newPage();
  t.after(async () => {
    await page.close();
    await browser.close();
    await new Promise((resolve) => site.server.close(resolve));
  });

  await page.setSize(1280, 800, false);
  await page.open(`${site.origin}/translate.html`);
  const ready = await waitFor(page, `document.querySelector("#tr-source") && document.querySelector("#main-nav a.active") && document.querySelector(".theme-switch")`);
  assert.equal(ready, true, "translate page did not boot");

  await t.test("nav marks translate active and other items point back to index", async () => {
    const nav = await page.evaluate(`(() => {
      const links = [...document.querySelectorAll("#main-nav a")];
      return {
        count: links.length,
        active: links.filter((link) => link.classList.contains("active")).map((link) => ({
          text: link.textContent.trim(),
          href: link.getAttribute("href"),
          current: link.getAttribute("aria-current")
        })),
        others: links.filter((link) => !link.classList.contains("active")).map((link) => link.getAttribute("href")),
        themeSwitches: document.querySelectorAll("[data-theme-switch] .theme-switch").length,
        langLabels: [...document.querySelectorAll("#ui-lang-seg button")].map((button) => button.textContent.trim())
      };
    })()`);
    assert.equal(nav.count, 9);
    assert.equal(nav.active.length, 1);
    assert.match(nav.active[0].text, /翻译|번역|Translate/);
    assert.match(nav.active[0].href, /(^|\/)translate\.html$/);
    assert.equal(nav.active[0].current, "page");
    assert.ok(nav.others.every((href) => href === "index.html" || href.startsWith("index.html?panel=")), nav.others.join(","));
    assert.ok(nav.others.some((href) => href === "index.html?panel=video"));
    assert.ok(nav.others.some((href) => href === "index.html?panel=daily"));
    assert.equal(nav.themeSwitches, 1);
    assert.deepEqual(nav.langLabels, ["中文", "한국어", "English"]);
  });

  await t.test("the index 翻译 control navigates to translate.html", async () => {
    await page.open(`${site.origin}/index.html`);
    await waitFor(page, `document.querySelector("#main-nav a")`);
    const href = await page.evaluate(`(() => {
      const link = [...document.querySelectorAll("#main-nav a")].find((item) => /翻译|번역|Translate/.test(item.textContent));
      if (!link) return null;
      const value = link.getAttribute("href");
      link.click();
      return value;
    })()`);
    assert.equal(href, "translate.html");
    const arrived = await waitFor(page, `location.pathname.endsWith("/translate.html") && !!document.querySelector("#tr-source")`);
    assert.equal(arrived, true, "clicking the nav link did not open translate.html");
  });

  await t.test("?panel=translate and a leftover translate hash redirect to the standalone page", async () => {
    await page.navigate(`${site.origin}/index.html?panel=translate`);
    const redirected = await waitFor(page, `location.pathname.endsWith("/translate.html") && !!document.querySelector("#tr-source")`);
    assert.equal(redirected, true, "?panel=translate was not redirected");
    assert.equal(await page.evaluate("location.search.includes('panel=translate')"), false);

    await page.navigate(`${site.origin}/index.html#panel-translate`);
    const hashRedirected = await waitFor(page, `location.pathname.endsWith("/translate.html") && !!document.querySelector("#tr-source")`);
    assert.equal(hashRedirected, true, "a leftover translate hash was not redirected");
  });

  await t.test("desktop panes are side by side and narrow panes stack", async () => {
    await page.setSize(1280, 800, false);
    await page.open(`${site.origin}/translate.html`);
    await waitFor(page, `document.querySelector("#tr-source-pane")`);
    const desktop = await page.evaluate(rectsScript());
    assert.ok(desktop.target.left >= desktop.source.right - 2, `target left ${desktop.target.left} < source right ${desktop.source.right}`);
    assert.ok(Math.abs(desktop.target.top - desktop.source.top) < 100, "desktop panes are not aligned");
    assert.ok(desktop.source.width > 250 && desktop.target.width > 250);

    await page.setSize(390, 844, true);
    await page.open(`${site.origin}/translate.html`);
    await waitFor(page, `document.querySelector("#tr-source-pane")`);
    const narrow = await page.evaluate(rectsScript());
    assert.ok(narrow.target.top >= narrow.source.bottom - 2, `target top ${narrow.target.top} < source bottom ${narrow.source.bottom}`);
    assert.ok(narrow.source.width > 300);
  });

  await t.test("no page-level horizontal overflow at 375, 390, 430, and 1280", async () => {
    for (const viewport of [
      { width: 375, height: 667, mobile: true },
      { width: 390, height: 844, mobile: true },
      { width: 430, height: 932, mobile: true },
      { width: 1280, height: 800, mobile: false },
    ]) {
      await page.setSize(viewport.width, viewport.height, viewport.mobile);
      await page.open(`${site.origin}/translate.html`);
      await waitFor(page, `document.querySelector("#tr-source-pane")`);
      const view = await page.evaluate(`({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth
      })`);
      assert.ok(view.scrollWidth <= view.innerWidth, `${viewport.width}x${viewport.height}: ${view.scrollWidth} > ${view.innerWidth}`);
    }
  });

  await t.test("typing calls POST /api/translate and renders the server text", async () => {
    await page.setSize(1280, 800, false);
    await page.open(`${site.origin}/translate.html`);
    await waitFor(page, `document.querySelector("#tr-source")`);
    site.state.requests.length = 0;
    await page.evaluate(`(() => {
      const field = document.querySelector("#tr-source");
      field.value = "你好，世界";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    const got = await waitFor(page, `document.querySelector("#tr-target").value.trim().length > 0`, 8000);
    assert.equal(got, true, "target pane stayed empty");
    const result = await page.evaluate(`({
      target: document.querySelector("#tr-target").value,
      roma: document.querySelector("#tr-roma").hidden ? "" : document.querySelector("#tr-roma").textContent,
      errorHidden: document.querySelector("#tr-error").hidden
    })`);
    assert.equal(result.target, MOCK_KO);
    assert.match(result.roma, /annyeonghaseyo/);
    assert.equal(result.errorHidden, true);
    assert.ok(site.state.requests.length >= 1);
    const request = site.state.requests[site.state.requests.length - 1];
    assert.equal(request.method, "POST");
    assert.equal(request.path, "/api/translate");
    assert.equal(request.body.text, "你好，世界");
    assert.equal(request.body.from, "zh");
    assert.equal(request.body.to, "ko");
    assert.equal(typeof request.body.honorific, "boolean");
  });

  await t.test("swap exchanges both languages and both texts", async () => {
    const before = await page.evaluate(`({
      from: document.querySelector("#tr-from").value,
      to: document.querySelector("#tr-to").value,
      source: document.querySelector("#tr-source").value,
      target: document.querySelector("#tr-target").value
    })`);
    await page.evaluate(`document.querySelector("#tr-swap").click()`);
    await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve('ok')))");
    const after = await page.evaluate(`({
      from: document.querySelector("#tr-from").value,
      to: document.querySelector("#tr-to").value,
      source: document.querySelector("#tr-source").value,
      target: document.querySelector("#tr-target").value
    })`);
    assert.equal(after.from, before.to);
    assert.equal(after.to, before.from);
    assert.equal(after.source, before.target);
    assert.equal(after.target, before.source);
  });

  await t.test("a failed request shows a clear error and does not invent text", async () => {
    await page.open(`${site.origin}/translate.html`);
    await waitFor(page, `document.querySelector("#tr-source")`);
    site.state.failNext = true;
    await page.evaluate(`(() => {
      const field = document.querySelector("#tr-source");
      field.value = "这次请求会失败";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    const failed = await waitFor(page, `!document.querySelector("#tr-error").hidden && document.querySelector("#tr-error").textContent.trim().length > 0`, 8000);
    assert.equal(failed, true, "error message did not appear");
    const state = await page.evaluate(`({
      target: document.querySelector("#tr-target").value,
      error: document.querySelector("#tr-error").textContent
    })`);
    assert.equal(state.target, "");
    assert.match(state.error, /翻译失败|Translation failed/);
    assert.match(state.error, /mock upstream down|HTTP 502|服务器|server/i);
  });

  await t.test("theme switch mounts and toggles the shared theme key", async () => {
    const before = await page.evaluate(`({
      theme: document.documentElement.getAttribute("data-theme"),
      stored: localStorage.getItem("koreanSite_theme_v1"),
      switches: document.querySelectorAll(".theme-switch").length
    })`);
    assert.equal(before.switches, 1);
    await page.evaluate(`document.querySelector(".theme-switch").click()`);
    await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve('ok')))");
    const after = await page.evaluate(`({
      theme: document.documentElement.getAttribute("data-theme"),
      stored: localStorage.getItem("koreanSite_theme_v1")
    })`);
    assert.notEqual(after.theme, before.theme);
    assert.equal(after.stored, after.theme);
  });

  await t.test("conversation practice is a secondary tab and keeps the original", async () => {
    await page.open(`${site.origin}/translate.html`);
    await waitFor(page, `document.querySelector("#tab-conversation")`);
    await page.evaluate(`document.querySelector("#tab-conversation").click()`);
    const opened = await waitFor(page, `!document.querySelector("#view-conversation").hidden && !!document.querySelector("#conv-input-a")`);
    assert.equal(opened, true);
    assert.equal(await page.evaluate("document.querySelector('#view-translator').hidden"), true);
    await page.evaluate(`(() => {
      const field = document.querySelector("#conv-input-a");
      field.value = "안녕하세요";
      field.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector('button[data-act="send"][data-side="a"]').click();
    })()`);
    const card = await waitFor(page, `(() => {
      const feed = document.querySelector("#conv-feed-a .conv-card");
      if (!feed) return false;
      const translated = feed.querySelector(".conv-trans");
      return !!translated && !translated.classList.contains("pending")
        && feed.querySelector(".conv-orig").textContent.includes("안녕하세요");
    })()`, 8000);
    assert.equal(card, true, "conversation card was not rendered");
    const text = await page.evaluate(`document.querySelector("#conv-feed-a .conv-card .conv-trans").textContent.trim()`);
    assert.equal(text, MOCK_ZH);
  });

  await t.test("language slider switches the UI, keeps the shared language field, and preserves learning records", async () => {
    await page.evaluate(`(() => {
      const raw = JSON.parse(localStorage.getItem("koreanSite_zhcn_draft_v01") || "{}");
      raw.mistakes = { p01: { count: 3, stages: { listening: 3 }, parts: {} } };
      raw.reviewQueue = [{ id: "p01", due: "2026-01-01" }];
      localStorage.setItem("koreanSite_zhcn_draft_v01", JSON.stringify(raw));
    })()`);
    await page.evaluate(`document.querySelector('#ui-lang-seg button[data-lang="en"]').click()`);
    await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve('ok')))");
    const view = await page.evaluate(`(() => {
      const raw = JSON.parse(localStorage.getItem("koreanSite_zhcn_draft_v01") || "{}");
      return {
        nav: document.querySelector("#main-nav a.active").textContent.trim(),
        lang: document.documentElement.lang,
        stored: raw.uiLang,
        mistakeCount: raw.mistakes && raw.mistakes.p01 && raw.mistakes.p01.count,
        reviewLength: Array.isArray(raw.reviewQueue) ? raw.reviewQueue.length : -1,
        showEN: raw.showEN
      };
    })()`);
    assert.match(view.nav, /Translate/);
    assert.equal(view.lang, "en");
    assert.equal(view.stored, "en");
    assert.equal(view.mistakeCount, 3);
    assert.equal(view.reviewLength, 1);
    assert.equal(view.showEN, true);
  });
});
