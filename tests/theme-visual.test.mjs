/**
 * Day/night visual and interaction contract for the home page and auth pages.
 * Uses the repository's throwaway Chrome CDP harness (no external Playwright
 * dependency) so it runs with the existing test command.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import test from "node:test";

const ROOT = new URL("..", import.meta.url);
const THEME_KEY = "koreanSite_theme_v1";
const LEARNING_KEY = "koreanSite_zhcn_draft_v01";
const VIEWPORTS = [
  { name: "375x667", width: 375, height: 667, mobile: true },
  { name: "390x844", width: 390, height: 844, mobile: true },
  { name: "430x932", width: 430, height: 932, mobile: true },
  { name: "1280x800", width: 1280, height: 800, mobile: false },
];
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".vtt": "text/vtt",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".bin": "application/octet-stream",
};

function startSite() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let path = decodeURIComponent(url.pathname);
    if (path === "/korean-site-zhcn" || path === "/korean-site-zhcn/") path = "/index.html";
    else if (path.startsWith("/korean-site-zhcn/")) path = path.slice("/korean-site-zhcn".length);
    if (path === "/") path = "/index.html";
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
    server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function launchChrome() {
  const dir = mkdtempSync(join(tmpdir(), "korean-theme-"));
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
  const pages = new Map();
  browser.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    const page = pages.get(msg.sessionId);
    if (!page || !msg.method) return;
    if (msg.method === "Network.requestWillBeSent") page.requests.push(msg.params.request.url);
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      page.errors.push("console.error: " + msg.params.args.map(arg => arg.value || arg.description || "").join(" "));
    }
    if (msg.method === "Runtime.exceptionThrown") {
      page.errors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || "runtime error");
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
    await send("Network.enable", {}, sessionId);
    // A per-document nonce injected before any page script. Unlike a marker
    // written into the outgoing document, a new document always gets a new
    // nonce, so a same-URL reload can never be mistaken for the old page.
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try { window.__koreanDocToken = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + "-" + Math.random()); } catch (error) {}`
    }, sessionId);
    const page = {
      targetId,
      sessionId,
      requests: [],
      errors: [],
      send: (method, params) => send(method, params || {}, sessionId),
      async evaluate(expression) {
        const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
        return result.result.value;
      },
      async open(url) {
        await send("Page.bringToFront", {}, sessionId);
        // Capture both identity signals of the document we are leaving. A
        // same-URL Page.navigate keeps location.href unchanged while the old
        // document is still live, so URL equality alone is not proof of a
        // fresh document.
        const before = await this.evaluate(`({ token: window.__koreanDocToken || null, origin: performance.timeOrigin })`).catch(() => null);
        await send("Page.navigate", { url }, sessionId);
        let fresh = null;
        for (let attempt = 0; attempt < 50; attempt += 1) {
          try {
            const state = await this.evaluate(`({
              ready: document.readyState,
              href: location.href,
              token: window.__koreanDocToken || null,
              origin: performance.timeOrigin
            })`);
            if (state.ready === "complete" && state.href === url && state.token
              && (!before || (state.token !== before.token && state.origin !== before.origin))) {
              fresh = state;
              break;
            }
          } catch (error) { /* the old execution context was replaced */ }
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        if (!fresh) {
          throw new Error(`fresh document did not commit for ${url} (before=${JSON.stringify(before)})`);
        }
        if (url.includes("index.html")) {
          try {
            const deadline = Date.now() + 10000;
            let content;
            do {
              content = await this.evaluate(`({ok:!!(document.querySelector("#question-stem, #reading-card .choice-opt, #pack-retry") && document.querySelector(".theme-switch")), token:window.__koreanDocToken, origin:performance.timeOrigin})`);
              if (content.ok) break;
              await new Promise(resolve => setTimeout(resolve, 20));
            } while (Date.now() < deadline);
            if (!content || content.token !== fresh.token || content.origin !== fresh.origin) {
              throw new Error(`document changed while waiting for ${url} (${JSON.stringify({ fresh, content })})`);
            }
          } catch (error) {
            if (error.message && error.message.startsWith("document changed")) throw error;
          }
        }
        await this.evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve('ok')))");
      },
      async setSize(width, height, mobile) {
        await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile }, sessionId);
      },
      async setColorScheme(value) {
        await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] }, sessionId);
      },
      async setReducedMotion(value) {
        await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value }] }, sessionId);
      },
      async close() {
        pages.delete(sessionId);
        try { await send("Target.closeTarget", { targetId }, sessionId); } catch (error) {}
      },
    };
    pages.set(sessionId, page);
    return page;
  }

  return {
    newPage,
    async close() { browser.close(); chrome.kill(); },
  };
}

async function waitFor(page, expression, timeout = 8000) {
  // Re-evaluate in the current document on each tick. An awaitPromise polling
  // closure can remain bound to a departing execution context during reload.
  const deadline = Date.now() + timeout;
  do {
    try { if (await page.evaluate(`!!(${expression})`)) return true; }
    catch (error) { /* navigation replaced the current execution context */ }
    await new Promise(resolve => setTimeout(resolve, 30));
  } while (Date.now() < deadline);
  return false;
}

async function waitForAuth(page, timeout = 8000) {
  return waitFor(page, `document.getElementById("auth-status") && document.querySelector(".theme-switch")`, timeout);
}

async function setStoredTheme(page, theme) {
  await page.evaluate(`localStorage.setItem(${JSON.stringify(THEME_KEY)}, ${JSON.stringify(theme)})`);
}

async function resetHome(page, origin, theme, path = "/index.html") {
  // Write the clean record and theme before the app's own scripts run, then
  // navigate once. The old two-navigation version loaded the app, changed
  // storage, and immediately reloaded; that second navigation could abort the
  // first document's CSS/JS/data requests and leave the next document with no
  // theme switch or a retry card, which is the resetHome flake.
  const { identifier } = await page.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try { localStorage.clear(); localStorage.setItem(${JSON.stringify(THEME_KEY)}, ${JSON.stringify(theme)}); } catch (error) {}`
  });
  try {
    await page.open(`${origin}${path}`);
  } finally {
    try {
      await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
    } catch (error) { /* page already gone */ }
  }
  const ready = await waitFor(page, `document.querySelector("#question-stem") && document.querySelectorAll(".choice-opt").length === 4 && document.getElementById("choice-check") && document.querySelector(".theme-switch")`);
  assert.equal(ready, true, `first question did not appear (${path}, ${theme})`);
}

function switchState() {
  return `(() => {
    const all = [...document.querySelectorAll("[role='switch']")];
    const sw = all[0];
    return {
      count: all.length,
      tag: sw ? sw.tagName : "",
      type: sw ? sw.getAttribute("type") : "",
      aria: sw ? sw.getAttribute("aria-checked") : null,
      label: sw ? sw.getAttribute("aria-label") : "",
      theme: document.documentElement.getAttribute("data-theme"),
      pos: sw ? sw.style.getPropertyValue("--pos") : "",
      stored: localStorage.getItem(${JSON.stringify(THEME_KEY)}),
      buttons: all.filter((node) => node.tagName === "BUTTON").length
    };
  })()`;
}

async function pressKey(page, key, code, keyCode) {
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve('ok')))");
}

async function dragSwitch(page, fromRatio, toRatio) {
  const result = await page.evaluate(`(() => {
    const sw = document.querySelector(".theme-switch");
    const r = sw.getBoundingClientRect();
    const startX = r.left + r.width * ${fromRatio};
    const endX = r.left + r.width * ${toRatio};
    const y = r.top + r.height / 2;
    const base = {
      pointerId: 55,
      pointerType: "touch",
      isPrimary: true,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1
    };
    sw.dispatchEvent(new PointerEvent("pointerdown", { ...base, clientX: startX, clientY: y }));
    let mid = null;
    for (const step of [0.2, 0.45, 0.72, 1]) {
      const x = startX + (endX - startX) * step;
      sw.dispatchEvent(new PointerEvent("pointermove", { ...base, clientX: x, clientY: y }));
      if (!mid) mid = { pos: sw.style.getPropertyValue("--pos"), theme: document.documentElement.getAttribute("data-theme") };
    }
    sw.dispatchEvent(new PointerEvent("pointerup", { ...base, clientX: endX, clientY: y, buttons: 0 }));
    return mid;
  })()`);
  await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve('ok')))");
  return result;
}

async function pointerCancelSwitch(page) {
  await page.evaluate(`(() => {
    const sw = document.querySelector(".theme-switch");
    const r = sw.getBoundingClientRect();
    const base = {
      pointerId: 77,
      pointerType: "touch",
      isPrimary: true,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      clientX: r.left + r.width * 0.76,
      clientY: r.top + r.height / 2
    };
    sw.dispatchEvent(new PointerEvent("pointerdown", base));
    sw.dispatchEvent(new PointerEvent("pointermove", { ...base, clientX: r.left + r.width * 0.30 }));
    sw.dispatchEvent(new PointerEvent("pointercancel", base));
  })()`);
  await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve('ok')))");
}

test("day/night switch: one control, drag/click/keyboard, persistence, sync, and no leakage", async (t) => {
  const site = await startSite();
  const browser = await launchChrome();
  const page = await browser.newPage();
  t.after(async () => { await page.close(); await browser.close(); await new Promise((resolve) => site.server.close(resolve)); });

  await page.setSize(390, 844, true);
  await page.setColorScheme("light");

  await t.test("home and auth pages each expose exactly one role=switch button", async () => {
    await resetHome(page, site.origin, "light");
    const home = await page.evaluate(switchState());
    assert.equal(home.count, 1);
    assert.equal(home.buttons, 1);
    assert.equal(home.tag, "BUTTON");
    assert.equal(home.type, "button");
    assert.equal(home.aria, "true");
    assert.match(home.label, /日间|夜间|theme|模式/i);
    assert.equal(home.theme, "light");

    await page.open(`${site.origin}/auth/preview.html?harness=1`);
    await waitForAuth(page);
    const preview = await page.evaluate(switchState());
    assert.equal(preview.count, 1);
    assert.equal(preview.buttons, 1);
    assert.equal(preview.tag, "BUTTON");
    assert.equal(preview.aria, "true");

    await page.open(`${site.origin}/auth/recovery.html?harness=1`);
    await waitForAuth(page);
    const recovery = await page.evaluate(switchState());
    assert.equal(recovery.count, 1);
    assert.equal(recovery.buttons, 1);
    assert.equal(recovery.tag, "BUTTON");
    assert.equal(recovery.aria, "true");
  });

  await t.test("click, ArrowLeft/ArrowRight, Enter and Space toggle and persist", async () => {
    await resetHome(page, site.origin, "light");
    await page.evaluate(`document.querySelector(".theme-switch").click()`);
    let state = await page.evaluate(switchState());
    assert.equal(state.theme, "dark");
    assert.equal(state.aria, "false");
    assert.equal(state.pos, "0");
    assert.equal(state.stored, "dark");

    await page.evaluate(`document.querySelector(".theme-switch").focus()`);
    await pressKey(page, "ArrowRight", "ArrowRight", 39);
    state = await page.evaluate(switchState());
    assert.equal(state.theme, "light");
    assert.equal(state.aria, "true");
    assert.equal(state.stored, "light");

    await pressKey(page, "ArrowLeft", "ArrowLeft", 37);
    state = await page.evaluate(switchState());
    assert.equal(state.theme, "dark");
    assert.equal(state.stored, "dark");

    await pressKey(page, "Enter", "Enter", 13);
    state = await page.evaluate(switchState());
    assert.equal(state.theme, "light");

    await pressKey(page, " ", "Space", 32);
    state = await page.evaluate(switchState());
    assert.equal(state.theme, "dark");
    assert.equal(state.stored, "dark");
  });

  await t.test("a reload and a second tab both follow the independent theme key", async () => {
    await resetHome(page, site.origin, "light");
    await page.evaluate(`document.querySelector(".theme-switch").click()`);
    await page.open(`${site.origin}/index.html`);
    await waitFor(page, `document.querySelector("#question-stem")`);
    let state = await page.evaluate(switchState());
    assert.equal(state.theme, "dark");
    assert.equal(state.aria, "false");
    assert.equal(state.stored, "dark");

    const auth = await browser.newPage();
    try {
      await auth.open(`${site.origin}/auth/preview.html?harness=1`);
      await waitForAuth(auth);
      const inherited = await auth.evaluate(switchState());
      assert.equal(inherited.theme, "dark");
      assert.equal(inherited.aria, "false");

      // Toggling the auth tab must update home through the storage event.
      await auth.evaluate(`document.querySelector(".theme-switch").click()`);
      const synced = await waitFor(page, `document.documentElement.getAttribute("data-theme") === "light"`);
      assert.equal(synced, true);
      state = await page.evaluate(switchState());
      assert.equal(state.theme, "light");
      assert.equal(state.stored, "light");
    } finally {
      await auth.close();
    }
  });

  await t.test("OS preference is used only when no explicit theme is stored", async () => {
    await resetHome(page, site.origin, "light");
    await page.evaluate(`localStorage.removeItem(${JSON.stringify(THEME_KEY)})`);
    await page.setColorScheme("dark");
    await page.open(`${site.origin}/index.html`);
    await waitFor(page, `document.querySelector("#question-stem")`);
    let state = await page.evaluate(switchState());
    assert.equal(state.theme, "dark");
    assert.equal(state.stored, null);

    await setStoredTheme(page, "light");
    await page.open(`${site.origin}/index.html`);
    await waitFor(page, `document.querySelector("#question-stem")`);
    state = await page.evaluate(switchState());
    assert.equal(state.theme, "light");
    assert.equal(state.stored, "light");
    await page.setColorScheme("light");
  });

  await t.test("pointer drag follows --pos, commits with a flick, and leaves no accidental click toggle", async () => {
    await resetHome(page, site.origin, "light");
    await dragSwitch(page, 0.72, 0.15);
    let state = await page.evaluate(switchState());
    assert.equal(state.theme, "dark");
    assert.equal(state.aria, "false");
    assert.equal(state.pos, "0");
    assert.equal(state.stored, "dark");

    await dragSwitch(page, 0.25, 0.86);
    state = await page.evaluate(switchState());
    assert.equal(state.theme, "light");
    assert.equal(state.pos, "1");
    assert.equal(state.stored, "light");

    const mid = await page.evaluate(`(() => {
      const sw = document.querySelector(".theme-switch");
      const r = sw.getBoundingClientRect();
      const base = { pointerId: 91, pointerType: "touch", isPrimary: true, bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: r.left + r.width * 0.78, clientY: r.top + r.height / 2 };
      sw.dispatchEvent(new PointerEvent("pointerdown", base));
      sw.dispatchEvent(new PointerEvent("pointermove", { ...base, clientX: r.left + r.width * 0.60 }));
      return { pos: sw.style.getPropertyValue("--pos"), theme: document.documentElement.getAttribute("data-theme") };
    })()`);
    assert.equal(Number(mid.pos) > 0 && Number(mid.pos) < 1, true);
    assert.equal(mid.theme, "light");
  });

  await t.test("a vertical scroll gesture on the switch does not become a theme tap", async () => {
    await resetHome(page, site.origin, "light");
    const result = await page.evaluate(`(() => {
      const sw = document.querySelector(".theme-switch");
      const r = sw.getBoundingClientRect();
      const base = {
        pointerId: 66,
        pointerType: "touch",
        isPrimary: true,
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2
      };
      sw.dispatchEvent(new PointerEvent("pointerdown", base));
      sw.dispatchEvent(new PointerEvent("pointermove", { ...base, clientX: base.clientX + 2, clientY: base.clientY + 26 }));
      sw.dispatchEvent(new PointerEvent("pointerup", { ...base, clientX: base.clientX + 2, clientY: base.clientY + 26, buttons: 0 }));
      sw.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return {
        theme: document.documentElement.getAttribute("data-theme"),
        stored: localStorage.getItem(${JSON.stringify(THEME_KEY)})
      };
    })()`);
    assert.equal(result.theme, "light");
    assert.equal(result.stored, "light");
  });

  await t.test("pointercancel restores the pre-gesture state without persisting", async () => {
    await resetHome(page, site.origin, "light");
    await pointerCancelSwitch(page);
    const state = await page.evaluate(switchState());
    assert.equal(state.theme, "light");
    assert.equal(state.pos, "1");
    assert.equal(state.stored, "light");
  });

  await t.test("the learning record is byte-identical after theme activity", async () => {
    await resetHome(page, site.origin, "light");
    const sentinel = JSON.stringify({
      uiLang: "zh",
      sentence: "主题不应碰学习记录 · 테마는 학습 기록을 건드리지 않습니다",
      mistakes: { p01: { count: 7, lastAt: "2026-11-24" } },
      reviewQueue: [{ id: "reading:x", due: "2026-11-24" }],
      version: 1,
    });
    await page.evaluate(`localStorage.setItem(${JSON.stringify(LEARNING_KEY)}, ${JSON.stringify(sentinel)})`);
    const before = await page.evaluate(`localStorage.getItem(${JSON.stringify(LEARNING_KEY)})`);
    assert.equal(before, sentinel);
    await page.evaluate(`document.querySelector(".theme-switch").click()`);
    await page.setSize(375, 667, true);
    await page.open(`${site.origin}/index.html`);
    await waitFor(page, `document.querySelector("#question-stem")`);
    await page.evaluate(`document.querySelector(".theme-switch").click()`);
    const after = await page.evaluate(`localStorage.getItem(${JSON.stringify(LEARNING_KEY)})`);
    assert.equal(after, sentinel);
    const keys = await page.evaluate("Object.keys(localStorage).sort()");
    assert.equal(keys.includes(THEME_KEY), true);
    assert.equal(JSON.parse(after).mistakes.p01.count, 7);
  });

  await t.test("theme assets and fonts never load from a CDN", async () => {
    await resetHome(page, site.origin, "light");
    await page.evaluate(`document.querySelector(".theme-switch").click()`);
    await page.open(`${site.origin}/index.html`);
    await waitFor(page, `document.querySelector("#question-stem")`);
    const external = await page.evaluate(`(() => {
      const resources = performance.getEntriesByType("resource").map((entry) => entry.name);
      const linked = [...document.querySelectorAll("link[href], script[src], img[src]")].map((node) => node.getAttribute("href") || node.getAttribute("src"));
      const external = resources.concat(linked).filter((url) => {
        if (!url || url.startsWith("data:") || url.startsWith("blob:")) return false;
        try { return new URL(url, location.href).origin !== location.origin; } catch (error) { return true; }
      });
      const fonts = [...document.fonts].filter((face) => face.status === "loaded");
      return { external, fontCount: fonts.length };
    })()`);
    assert.deepEqual(external.external, []);
    assert.equal(external.fontCount, 0);
    const externalRequests = page.requests.filter((url) => {
      if (!url || !/^https?:/i.test(url)) return false;
      try { return new URL(url).origin !== site.origin; } catch (error) { return true; }
    });
    assert.deepEqual(externalRequests, []);

    const auth = await browser.newPage();
    try {
      await auth.open(`${site.origin}/auth/preview.html?harness=1`);
      await waitForAuth(auth);
      const authExternal = await auth.evaluate(`(() => {
        const resources = performance.getEntriesByType("resource").map((entry) => entry.name);
        return resources.filter((url) => {
          if (!url || url.startsWith("data:") || url.startsWith("blob:")) return false;
          try { return new URL(url, location.href).origin !== location.origin; } catch (error) { return true; }
        });
      })()`);
      assert.deepEqual(authExternal, []);
    } finally {
      await auth.close();
    }
  });

  await t.test("grade/type chips scroll horizontally with hidden native scrollbars and a glowing active pill", async () => {
    await resetHome(page, site.origin, "light");
    const chips = await page.evaluate(`(() => {
      const scrollers = [...document.querySelectorAll(".practice-scroll")];
      let scrollbarDisplay = "";
      for (const sheet of document.styleSheets) {
        let rules = [];
        try { rules = [...sheet.cssRules]; } catch (error) { continue; }
        for (const rule of rules) {
          if (rule.selectorText && rule.selectorText.includes(".practice-scroll::-webkit-scrollbar")) scrollbarDisplay = rule.style.display;
        }
      }
      return scrollers.map((node) => {
        const style = getComputedStyle(node);
        const active = node.querySelector(".btn.active");
        return {
          count: node.querySelectorAll(".btn").length,
          scrollable: node.scrollWidth > node.clientWidth,
          scrollbarWidth: style.scrollbarWidth,
          webkitHidden: scrollbarDisplay,
          activeShadow: active ? getComputedStyle(active).boxShadow : "",
          overflowX: style.overflowX
        };
      });
    })()`);
    assert.equal(chips.length >= 2, true);
    for (const row of chips) {
      assert.equal(row.count >= 2, true);
      assert.equal(row.scrollable, true);
      assert.equal(row.scrollbarWidth, "none");
      assert.equal(row.webkitHidden, "none");
      assert.equal(row.overflowX, "auto");
      assert.notEqual(row.activeShadow, "none");
    }
  });

  await t.test("all four viewports in both themes keep the first question above the fold with no page overflow", async () => {
    for (const viewport of VIEWPORTS) {
      for (const theme of ["light", "dark"]) {
        await page.setSize(viewport.width, viewport.height, viewport.mobile);
        await page.setColorScheme("light");
        await resetHome(page, site.origin, theme);
        const view = await page.evaluate(`(() => {
          const inside = (r) => r.width > 8 && r.height > 8 && r.top >= -1 && r.left >= -1 && r.bottom <= window.innerHeight + 1 && r.right <= window.innerWidth + 1;
          const stem = document.getElementById("question-stem");
          const options = [...document.querySelectorAll(".choice-opt")];
          const check = document.getElementById("choice-check");
          const sw = document.querySelector(".theme-switch");
          return {
            theme: document.documentElement.getAttribute("data-theme"),
            options: options.length,
            stemIn: inside(stem.getBoundingClientRect()),
            optionsIn: options.every((node) => inside(node.getBoundingClientRect())),
            checkIn: inside(check.getBoundingClientRect()),
            start: !!document.getElementById("session-start"),
            gateHidden: document.getElementById("auth-gate").hidden,
            locked: document.body.classList.contains("auth-locked"),
            overflow: document.documentElement.scrollWidth <= window.innerWidth,
            switchIn: inside(sw.getBoundingClientRect())
          };
        })()`);
        assert.equal(view.theme, theme, `${viewport.name} ${theme}`);
        assert.equal(view.options, 4, `${viewport.name} ${theme}`);
        assert.equal(view.stemIn, true, `${viewport.name} ${theme} stem`);
        assert.equal(view.optionsIn, true, `${viewport.name} ${theme} options`);
        assert.equal(view.checkIn, true, `${viewport.name} ${theme} check`);
        assert.equal(view.start, false, `${viewport.name} ${theme}`);
        assert.equal(view.gateHidden, true, `${viewport.name} ${theme}`);
        assert.equal(view.locked, false, `${viewport.name} ${theme}`);
        assert.equal(view.overflow, true, `${viewport.name} ${theme}`);
        assert.equal(view.switchIn, true, `${viewport.name} ${theme} switch`);

        await page.evaluate(`document.querySelector(".choice-opt").click()`);
        await page.evaluate(`document.getElementById("choice-check").click()`);
        const marked = await page.evaluate(`document.getElementById("choice-result").textContent`);
        assert.match(marked, /正确！|不对/, `${viewport.name} ${theme} submit`);
        await page.evaluate(`document.getElementById("choice-next").click()`);
        const advanced = await page.evaluate(`document.getElementById("question-stem").textContent.trim()`);
        assert.notEqual(advanced, "", `${viewport.name} ${theme} next`);
      }
    }
  });

  await t.test("the canvas background covers the viewport and full document in both themes", async () => {
    const readCanvas = () => page.evaluate(`(() => {
      const body = document.body;
      const root = document.documentElement;
      const rect = body.getBoundingClientRect();
      const style = getComputedStyle(body);
      return {
        theme: root.getAttribute("data-theme"),
        viewportHeight: window.innerHeight,
        bodyHeight: rect.height,
        bodyBottom: rect.bottom + window.scrollY,
        documentHeight: root.scrollHeight,
        bottomHitInBody: body.contains(document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 1)),
        backgroundImage: style.backgroundImage,
        backgroundAttachment: style.backgroundAttachment,
        bodyColor: style.backgroundColor,
        htmlColor: getComputedStyle(root).backgroundColor
      };
    })()`);
    const assertCanvas = (canvas, label) => {
      assert.equal(canvas.bodyHeight >= canvas.viewportHeight - 0.5, true, `${label} body shorter than viewport`);
      assert.equal(canvas.bottomHitInBody, true, `${label} viewport bottom is not painted by body`);
      assert.equal(canvas.bodyBottom >= canvas.documentHeight - 0.5, true, `${label} body stops before document end`);
      assert.notEqual(canvas.backgroundImage, "none", `${label} body has no canvas gradient`);
      const attachments = canvas.backgroundAttachment.split(",").map((value) => value.trim());
      assert.equal(attachments.every((value) => value === "scroll"), true, `${label} fixed background clips at the viewport`);
      assert.equal(canvas.bodyColor, canvas.htmlColor, `${label} body/html fallback colours diverge`);
    };

    for (const viewport of VIEWPORTS) {
      for (const theme of ["light", "dark"]) {
        await page.setSize(viewport.width, viewport.height, viewport.mobile);
        await resetHome(page, site.origin, theme);
        const canvas = await readCanvas();
        assert.equal(canvas.theme, theme, `${viewport.name} ${theme}`);
        assertCanvas(canvas, `${viewport.name} ${theme}`);
      }
    }

    // The auth screen is ~1805px tall: fixed backgrounds used to stop at the
    // 800px viewport edge, leaving a second flat band halfway down the page.
    await page.setSize(1280, 800, false);
    for (const theme of ["light", "dark"]) {
      for (const path of ["/auth/preview.html?harness=1", "/auth/recovery.html?harness=1"]) {
        await setStoredTheme(page, theme);
        await page.open(`${site.origin}${path}`);
        const ready = await waitForAuth(page);
        assert.equal(ready, true, `${path} ${theme} auth shell`);
        const canvas = await readCanvas();
        assert.equal(canvas.theme, theme, `${path} ${theme}`);
        assertCanvas(canvas, `${path} ${theme}`);
      }
    }
    await page.setColorScheme("light");
  });

  await t.test("the smallest viewport also cold-opens through the /korean-site-zhcn/ subpath in both themes", async () => {
    await page.setSize(375, 667, true);
    for (const theme of ["light", "dark"]) {
      await resetHome(page, site.origin, theme, "/korean-site-zhcn/index.html");
      const view = await page.evaluate(`(() => {
        const inside = (r) => r.width > 8 && r.height > 8 && r.top >= -1 && r.left >= -1 && r.bottom <= window.innerHeight + 1 && r.right <= window.innerWidth + 1;
        return {
          theme: document.documentElement.getAttribute("data-theme"),
          stem: inside(document.getElementById("question-stem").getBoundingClientRect()),
          options: [...document.querySelectorAll(".choice-opt")].every((node) => inside(node.getBoundingClientRect())),
          check: inside(document.getElementById("choice-check").getBoundingClientRect()),
          overflow: document.documentElement.scrollWidth <= window.innerWidth
        };
      })()`);
      assert.deepEqual(view, { theme, stem: true, options: true, check: true, overflow: true });
    }
  });

  await t.test("reduced motion removes nonessential transitions while click still toggles", async () => {
    await resetHome(page, site.origin, "light");
    await page.setReducedMotion("reduce");
    await page.open(`${site.origin}/index.html`);
    await waitFor(page, `document.querySelector("#question-stem")`);
    const motion = await page.evaluate(`(() => {
      const track = getComputedStyle(document.querySelector(".theme-track"));
      const thumb = getComputedStyle(document.querySelector(".theme-thumb"));
      const panel = getComputedStyle(document.querySelector(".panel.active"));
      return { track: track.transitionDuration, thumb: thumb.transitionDuration, panel: panel.animationName };
    })()`);
    assert.equal(motion.track, "0s");
    assert.equal(motion.thumb, "0s");
    assert.equal(motion.panel, "none");
    await page.evaluate(`document.querySelector(".theme-switch").click()`);
    const state = await page.evaluate(switchState());
    assert.equal(state.theme, "dark");
    await page.setReducedMotion("no-preference");
    await page.setColorScheme("light");
  });

  await t.test("no runtime errors and the switch keeps an accessible focus ring", async () => {
    await resetHome(page, site.origin, "light");
    const focus = await page.evaluate(`(() => {
      const sw = document.querySelector(".theme-switch");
      sw.focus();
      let ruleOutline = "";
      for (const sheet of document.styleSheets) {
        let rules = [];
        try { rules = [...sheet.cssRules]; } catch (error) { continue; }
        for (const rule of rules) {
          if (rule.selectorText && rule.selectorText.includes(".theme-switch:focus-visible")) {
            ruleOutline = rule.style.outline;
          }
        }
      }
      return {
        active: document.activeElement === sw,
        tabIndex: sw.tabIndex,
        ruleOutline
      };
    })()`);
    assert.equal(focus.active, true);
    assert.notEqual(focus.tabIndex, -1);
    assert.match(focus.ruleOutline, /3px/);
  });

  t.diagnostic(`page runtime errors: ${JSON.stringify(page.errors)}`);
  assert.deepEqual(page.errors, []);
});

/* ------------------------------------------------------------------ *
 * UI language glass slider (three-position)
 * ------------------------------------------------------------------ */

function langStateExpr() {
  return `(() => {
    const seg = document.getElementById("ui-lang-seg");
    const buttons = [...seg.querySelectorAll("button[data-lang]")];
    const thumb = seg.querySelector(".lang-thumb");
    const box = (node) => {
      const r = node.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const cs = (node, pseudo) => getComputedStyle(node, pseudo || null);
    let savedLang = null;
    try { savedLang = JSON.parse(localStorage.getItem("koreanSite_zhcn_draft_v01") || "{}").uiLang || null; } catch (error) {}
    const before = thumb ? cs(thumb, "::before") : null;
    const segStyle = cs(seg);
    return {
      brand: (document.getElementById("brand-name") || {}).textContent || "",
      htmlLang: document.documentElement.lang,
      storedLang: savedLang,
      theme: document.documentElement.getAttribute("data-theme"),
      seg: box(seg),
      segStyle: {
        background: segStyle.backgroundColor,
        backgroundImage: segStyle.backgroundImage,
        boxShadow: segStyle.boxShadow,
        overflowX: segStyle.overflowX,
        overflowY: segStyle.overflowY,
        afterContent: cs(seg, "::after").content
      },
      thumbCount: seg.querySelectorAll(".lang-thumb").length,
      pos: parseFloat(seg.style.getPropertyValue("--lang-pos")),
      thumb: thumb ? {
        box: box(thumb),
        z: cs(thumb).zIndex,
        pointerEvents: cs(thumb).pointerEvents,
        boxShadow: cs(thumb).boxShadow,
        backgroundImage: cs(thumb).backgroundImage,
        transitionDuration: cs(thumb).transitionDuration,
        transitionTimingFunction: cs(thumb).transitionTimingFunction,
        before: {
          content: before.content,
          maskImage: before.maskImage,
          webkitMaskImage: before.webkitMaskImage,
          maskComposite: before.maskComposite || before.webkitMaskComposite || "",
          padding: before.padding,
          pointerEvents: before.pointerEvents
        }
      } : null,
      buttons: buttons.map((button) => {
        const style = cs(button);
        return {
          lang: button.dataset.lang,
          text: button.textContent.trim(),
          pressed: button.getAttribute("aria-pressed"),
          active: button.classList.contains("active"),
          box: box(button),
          background: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          boxShadow: style.boxShadow,
          color: style.color,
          z: style.zIndex,
          whiteSpace: style.whiteSpace,
          overflow: style.overflow,
          textOverflow: style.textOverflow,
          scrollWidth: button.scrollWidth,
          clientWidth: button.clientWidth
        };
      })
    };
  })()`;
}

function parseRgb(value) {
  const match = String(value).match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1].split(",").map((part) => parseFloat(part.trim()));
  return { r: parts[0], g: parts[1], b: parts[2], a: Number.isFinite(parts[3]) ? parts[3] : 1 };
}

function relativeLuminance(rgb) {
  const channel = (value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function assertThumbAligned(state, lang, label) {
  const button = state.buttons.find((item) => item.lang === lang);
  assert.ok(button, `${label}: missing ${lang} button`);
  assert.ok(state.thumb, `${label}: missing single moving thumb`);
  assert.equal(button.pressed, "true", `${label}: ${lang} not aria-pressed`);
  assert.equal(button.active, true, `${label}: ${lang} lacks active compatibility class`);
  for (const edge of ["left", "right", "top", "bottom"]) {
    assert.ok(
      Math.abs(state.thumb.box[edge] - button.box[edge]) <= 1.5,
      `${label}: thumb ${edge} ${state.thumb.box[edge]} != button ${edge} ${button.box[edge]}`
    );
  }
}

async function clickLang(page, lang) {
  const point = await page.evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(`#ui-lang-seg button[data-lang="${lang}"]`)});
    const r = button.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
  await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve('ok'))))");
  await new Promise((resolve) => setTimeout(resolve, 240));
}

async function dragLangToNext(page, fraction) {
  const geometry = await page.evaluate(`(() => {
    const seg = document.getElementById("ui-lang-seg");
    const buttons = [...seg.querySelectorAll("button[data-lang]")];
    const rects = buttons.map((button) => button.getBoundingClientRect());
    const centers = rects.map((r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 }));
    const current = buttons.findIndex((button) => button.getAttribute("aria-pressed") === "true");
    const target = centers[Math.min(current + 1, buttons.length - 1)];
    const start = centers[current];
    return {
      start,
      end: { x: start.x + (target.x - start.x) * ${fraction}, y: start.y },
      targetIndex: Math.min(current + 1, buttons.length - 1)
    };
  })()`);
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: geometry.start.x, y: geometry.start.y, button: "left", buttons: 1, clickCount: 1 });
  for (const step of [0.25, 0.5, 0.75, 1]) {
    await page.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: geometry.start.x + (geometry.end.x - geometry.start.x) * step,
      y: geometry.start.y,
      button: "left",
      buttons: 1,
    });
  }
  const mid = await page.evaluate(langStateExpr());
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: geometry.end.x, y: geometry.end.y, button: "left", buttons: 0, clickCount: 1 });
  await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve('ok'))))");
  await new Promise((resolve) => setTimeout(resolve, 240));
  const after = await page.evaluate(langStateExpr());
  return { mid, after, targetIndex: geometry.targetIndex };
}

test("UI language slider: one glass thumb, real clicks, continuous drag, keyboard, and both themes", async (t) => {
  const site = await startSite();
  const browser = await launchChrome();
  const page = await browser.newPage();
  t.after(async () => { await page.close(); await browser.close(); await new Promise((resolve) => site.server.close(resolve)); });

  await page.setSize(390, 844, true);
  await page.setColorScheme("light");
  await resetHome(page, site.origin, "light");

  await t.test("keeps three original language buttons and exactly one moving thumb with no active fill", async () => {
    const state = await page.evaluate(langStateExpr());
    assert.equal(state.buttons.length, 3);
    assert.deepEqual(state.buttons.map((button) => button.text), ["中文", "한국어", "English"]);
    assert.deepEqual(state.buttons.map((button) => button.lang), ["zh", "ko", "en"]);
    assert.equal(state.thumbCount, 1);
    assert.equal(state.segStyle.afterContent, "none");
    for (const button of state.buttons) {
      assert.equal(button.background, "rgba(0, 0, 0, 0)", `${button.lang} still has an opaque active/fill background`);
      assert.equal(button.backgroundImage, "none", `${button.lang} still has an active/fill gradient`);
      assert.equal(button.boxShadow, "none", `${button.lang} still has an active/fill glow`);
      assert.equal(button.whiteSpace, "nowrap", `${button.lang} can wrap`);
      assert.equal(button.scrollWidth <= button.clientWidth + 1, true, `${button.lang} is truncated`);
    }
    assertThumbAligned(state, "zh", "initial zh");
    assert.equal(state.brand, "与你同行");
    assert.equal(state.htmlLang, "zh-CN");
  });

  await t.test("clicking all three labels moves the thumb and switches real UI language plus persistence", async () => {
    const expected = {
      zh: { brand: "与你同行", htmlLang: "zh-CN" },
      ko: { brand: "당신과 동행", htmlLang: "ko" },
      en: { brand: "Together With You", htmlLang: "en" },
    };
    const thumbLefts = [];
    for (const lang of ["zh", "ko", "en", "ko", "zh"]) {
      await clickLang(page, lang);
      const state = await page.evaluate(langStateExpr());
      assertThumbAligned(state, lang, `click ${lang}`);
      assert.equal(state.storedLang, lang, `click ${lang} did not persist uiLang`);
      assert.equal(state.htmlLang, expected[lang].htmlLang, `click ${lang} html lang`);
      assert.equal(state.brand, expected[lang].brand, `click ${lang} visible UI copy`);
      assert.equal(state.buttons.filter((button) => button.pressed === "true").length, 1);
      thumbLefts.push(Math.round(state.thumb.box.left));
    }
    assert.equal(new Set(thumbLefts.slice(0, 3)).size, 3, `thumb did not move across all three slots: ${thumbLefts}`);
  });

  await t.test("thumb stays inside the active button at all four sizes in both themes", async () => {
    for (const viewport of VIEWPORTS) {
      for (const theme of ["light", "dark"]) {
        await page.setSize(viewport.width, viewport.height, viewport.mobile);
        await page.setColorScheme("light");
        await resetHome(page, site.origin, theme);
        for (const lang of ["zh", "ko", "en"]) {
          await clickLang(page, lang);
          const state = await page.evaluate(langStateExpr());
          const label = `${viewport.name} ${theme} ${lang}`;
          assert.equal(state.theme, theme, label);
          assert.equal(state.thumbCount, 1, `${label} thumb count`);
          assertThumbAligned(state, lang, label);
          assert.equal(state.thumb.box.left >= state.seg.left - 1, true, `${label} thumb escapes track left`);
          assert.equal(state.thumb.box.right <= state.seg.right + 1, true, `${label} thumb escapes track right`);
          const segBackground = parseRgb(state.segStyle.background);
          assert.ok(segBackground, `${label} track has no parseable background colour`);
          for (const button of state.buttons) {
            assert.equal(button.whiteSpace, "nowrap", `${label} ${button.lang} wrap`);
            assert.equal(button.scrollWidth <= button.clientWidth + 1, true, `${label} ${button.lang} truncation`);
            const foreground = parseRgb(button.color);
            assert.ok(foreground, `${label} ${button.lang} has no text colour`);
            assert.ok(
              contrastRatio(foreground, segBackground) >= 4.5,
              `${label} ${button.lang} contrast ${contrastRatio(foreground, segBackground).toFixed(2)}`
            );
            assert.ok(
              Number(button.z) > Number(state.thumb.z),
              `${label} ${button.lang} text is not above the thumb (${button.z} <= ${state.thumb.z})`
            );
          }
          assert.equal(state.thumb.pointerEvents, "none", `${label} thumb intercepts labels`);
        }
        const overflow = await page.evaluate(`document.documentElement.scrollWidth <= window.innerWidth`);
        assert.equal(overflow, true, `${viewport.name} ${theme} page overflow`);
      }
    }
  });

  await t.test("a continuous horizontal drag follows fractional position and snaps to the nearest slot", async () => {
    await page.setSize(390, 844, true);
    await page.setColorScheme("light");
    await resetHome(page, site.origin, "light");

    const first = await dragLangToNext(page, 0.66);
    assert.ok(first.mid.pos > 0.25 && first.mid.pos < 1, `mid pos not fractional: ${first.mid.pos}`);
    assert.equal(first.mid.thumbCount, 1);
    assert.ok(first.mid.thumb.box.left > first.mid.buttons[0].box.left, "thumb did not follow drag");
    assert.ok(first.mid.thumb.box.left < first.mid.buttons[1].box.right, "thumb jumped past the drag");
    assert.equal(first.targetIndex, 1);
    assert.equal(first.after.storedLang, "ko", "release did not snap to the nearest ko slot");
    assert.equal(first.after.brand, "당신과 동행");
    assertThumbAligned(first.after, "ko", "snap ko");

    const second = await dragLangToNext(page, 0.66);
    assert.ok(second.mid.pos > 1.25 && second.mid.pos < 2, `second mid pos not fractional: ${second.mid.pos}`);
    assert.equal(second.after.storedLang, "en", "release did not snap to the nearest en slot");
    assert.equal(second.after.brand, "Together With You");
    assertThumbAligned(second.after, "en", "snap en");

    const themeAfter = await page.evaluate(`localStorage.getItem("koreanSite_theme_v1")`);
    assert.equal(themeAfter, "light", "language drag leaked into the theme key");
  });

  await t.test("pointercancel restores the pre-gesture slot and does not persist", async () => {
    await resetHome(page, site.origin, "light");
    await page.evaluate(`(() => {
      const seg = document.getElementById("ui-lang-seg");
      const buttons = [...seg.querySelectorAll("button[data-lang]")];
      const start = buttons[0].getBoundingClientRect();
      const end = buttons[2].getBoundingClientRect();
      const base = {
        pointerId: 321,
        pointerType: "touch",
        isPrimary: true,
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        clientX: start.left + start.width / 2,
        clientY: start.top + start.height / 2
      };
      seg.dispatchEvent(new PointerEvent("pointerdown", base));
      seg.dispatchEvent(new PointerEvent("pointermove", { ...base, clientX: end.left + end.width / 2, clientY: base.clientY }));
      seg.dispatchEvent(new PointerEvent("pointercancel", { ...base, clientX: end.left + end.width / 2 }));
    })()`);
    await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve('ok'))))");
    const state = await page.evaluate(langStateExpr());
    assert.equal(state.pos, 0);
    assert.equal(state.storedLang, null, "pointercancel persisted language");
    assert.equal(state.brand, "与你同行");
    assertThumbAligned(state, "zh", "pointercancel");
  });

  await t.test("a vertical swipe over the slider never switches language", async () => {
    await resetHome(page, site.origin, "light");
    await page.evaluate("window.scrollTo(0, 0)");
    await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    const point = await page.evaluate(`(() => {
      const r = document.querySelector("#ui-lang-seg button[data-lang='zh']").getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y, id: 1, force: 1 }] });
    for (const step of [0.25, 0.5, 0.75, 1]) {
      await page.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: point.x + 2, y: point.y - 70 * step, id: 1, force: 1 }],
      });
    }
    await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve('ok'))))");
    const state = await page.evaluate(langStateExpr());
    assert.equal(state.storedLang, null, "vertical swipe persisted a language");
    assert.equal(state.brand, "与你同行");
    assertThumbAligned(state, "zh", "vertical swipe");
    await page.send("Emulation.setTouchEmulationEnabled", { enabled: false, maxTouchPoints: 1 });
    await page.evaluate("window.scrollTo(0, 0)");
  });

  await t.test("keyboard arrows, Home, End, Enter and Space operate the retained buttons", async () => {
    await resetHome(page, site.origin, "light");
    const settle = () => page.evaluate("new Promise((resolve) => setTimeout(() => requestAnimationFrame(() => resolve('ok')), 240))");
    await page.evaluate(`document.querySelector("#ui-lang-seg button[data-lang='zh']").focus()`);
    await pressKey(page, "ArrowRight", "ArrowRight", 39);
    await settle();
    let state = await page.evaluate(langStateExpr());
    assert.equal(state.storedLang, "ko");
    assert.equal(await page.evaluate(`document.activeElement && document.activeElement.getAttribute("data-lang")`), "ko");
    assertThumbAligned(state, "ko", "ArrowRight");

    await pressKey(page, "ArrowLeft", "ArrowLeft", 37);
    await settle();
    state = await page.evaluate(langStateExpr());
    assert.equal(state.storedLang, "zh");
    assertThumbAligned(state, "zh", "ArrowLeft");

    await pressKey(page, "End", "End", 35);
    await settle();
    state = await page.evaluate(langStateExpr());
    assert.equal(state.storedLang, "en");
    assertThumbAligned(state, "en", "End");

    await pressKey(page, "Home", "Home", 36);
    await settle();
    state = await page.evaluate(langStateExpr());
    assert.equal(state.storedLang, "zh");
    assertThumbAligned(state, "zh", "Home");

    await page.evaluate(`document.querySelector("#ui-lang-seg button[data-lang='ko']").focus()`);
    await pressKey(page, "Enter", "Enter", 13);
    await settle();
    state = await page.evaluate(langStateExpr());
    assert.equal(state.storedLang, "ko");
    assertThumbAligned(state, "ko", "Enter");

    await page.evaluate(`document.querySelector("#ui-lang-seg button[data-lang='en']").focus()`);
    await pressKey(page, " ", "Space", 32);
    await settle();
    state = await page.evaluate(langStateExpr());
    assert.equal(state.storedLang, "en");
    assertThumbAligned(state, "en", "Space");
  });

  await t.test("the glass edge is masked in both themes with no overlay across the labels", async () => {
    for (const theme of ["light", "dark"]) {
      await resetHome(page, site.origin, theme);
      await clickLang(page, "en");
      const state = await page.evaluate(langStateExpr());
      const label = `${theme} masked edge`;
      assert.equal(state.theme, theme);
      assert.ok(state.thumb, `${label}: no thumb`);
      assert.equal(state.thumb.before.content !== "none", true, `${label}: no rim pseudo element`);
      assert.match(state.thumb.before.maskImage, /linear-gradient/, `${label}: rim is not masked`);
      assert.match(state.thumb.before.maskComposite, /exclude|xor/, `${label}: mask is not excluded`);
      assert.match(state.thumb.before.padding, /1\.25px/, `${label}: rim is not a thin outside ring`);
      assert.equal(state.thumb.before.pointerEvents, "none", `${label}: rim intercepts text`);
      assert.notEqual(state.thumb.boxShadow, "none", `${label}: no outer directional halo`);
      assert.match(state.thumb.backgroundImage, /linear-gradient/, `${label}: thumb is not a glass surface`);
      assert.match(state.segStyle.backgroundImage, /linear-gradient/, `${label}: track has no glass gradient`);
      assert.equal(state.segStyle.afterContent, "none", `${label}: overlay pseudo element above labels`);
      for (const button of state.buttons) {
        assert.ok(Number(button.z) > Number(state.thumb.z), `${label}: ${button.lang} text below glass`);
      }
      if (theme === "light") {
        assert.match(state.thumb.boxShadow, /rgba\(255, 1[6-9][0-9], 4[0-9]/, `${label}: day halo is not warm gold`);
        assert.match(state.segStyle.background, /rgb\((24[0-9]|25[0-5]), (2[2-5][0-9]), (2[0-3][0-9])\)/, `${label}: day track is not warm porcelain`);
      } else {
        assert.match(state.thumb.boxShadow, /rgba\((1[0-9][0-9]|2[0-5][0-9]), (1[8-9][0-9]|2[0-5][0-9]), 255|rgba\((1[0-9][0-9]|2[0-5][0-9]), 2[2-5][0-9], 2[0-5][0-9]/, `${label}: night halo is not blue-white/mint`);
        assert.match(state.segStyle.background, /rgb\(([0-9]|1[0-9]), ([0-9]|1[0-9]), ([0-9]|1[0-9]|2[0-5])\)/, `${label}: night track is not obsidian`);
      }
    }
  });

  await t.test("click movement uses the accepted theme-switch easing and reduced motion disables it", async () => {
    await resetHome(page, site.origin, "light");
    const motion = await page.evaluate(`(() => {
      const thumb = getComputedStyle(document.querySelector("#ui-lang-seg .lang-thumb"));
      const themeThumb = getComputedStyle(document.querySelector(".theme-thumb"));
      return {
        timing: thumb.transitionTimingFunction,
        duration: thumb.transitionDuration,
        themeTiming: themeThumb.transitionTimingFunction,
        themeDuration: themeThumb.transitionDuration
      };
    })()`);
    assert.equal(motion.timing.split(",")[0].trim(), motion.themeTiming.split(",")[0].trim(), "language thumb easing differs from the approved theme switch");
    assert.equal(motion.duration.split(",")[0].trim(), motion.themeDuration.split(",")[0].trim(), "language thumb duration differs from the approved theme switch");

    await page.setReducedMotion("reduce");
    await page.open(`${site.origin}/index.html`);
    await waitFor(page, `document.querySelector("#question-stem") && document.querySelector("#ui-lang-seg .lang-thumb")`);
    const reduced = await page.evaluate(`(() => {
      const thumb = getComputedStyle(document.querySelector("#ui-lang-seg .lang-thumb"));
      const seg = getComputedStyle(document.getElementById("ui-lang-seg"));
      return { thumb: thumb.transitionDuration, seg: seg.transitionDuration };
    })()`);
    for (const duration of reduced.thumb.split(",")) assert.equal(duration.trim(), "0s");
    for (const duration of reduced.seg.split(",")) assert.equal(duration.trim(), "0s");
    await clickLang(page, "ko");
    const state = await page.evaluate(langStateExpr());
    assert.equal(state.storedLang, "ko");
    assertThumbAligned(state, "ko", "reduced motion click");
    await page.setReducedMotion("no-preference");
  });

  t.diagnostic(`page runtime errors: ${JSON.stringify(page.errors)}`);
  assert.deepEqual(page.errors, []);
});

// Shared controls retain semantic states while all pages use the same glass rim.
test("all action buttons share an outside-only glass rim in home and auth", async (t) => {
  const site = await startSite();
  const browser = await launchChrome();
  const page = await browser.newPage();
  t.after(async () => { await page.close(); await browser.close(); await new Promise(resolve => site.server.close(resolve)); });
  for (const theme of ["light", "dark"]) {
    await resetHome(page, site.origin, theme);
    for (const path of ["/index.html", "/auth/preview.html?harness=1", "/auth/recovery.html?harness=1"]) {
      if (path !== "/index.html") { await page.open(site.origin + path); await waitForAuth(page); }
      const controls = await page.evaluate(`Array.from(document.querySelectorAll('button:not(.theme-switch):not(#ui-lang-seg button)')).map(button => {
        const style = getComputedStyle(button);
        const rim = getComputedStyle(button, '::before');
        return {text:button.textContent.trim(), disabled:button.disabled, rim:style.getPropertyValue('--action-rim').trim(), mask:rim.maskComposite, glow:style.boxShadow, image:style.backgroundImage, color:style.color};
      })`);
      assert.ok(controls.length > 5, path + ": " + await page.evaluate(`JSON.stringify({url:location.href,visibility:document.visibilityState,ready:document.readyState,text:document.body.innerText.slice(0,300),scripts:[...document.scripts].map(s=>s.src)})`));
      for (const control of controls) {
        assert.ok(control.rim, `${theme} ${path}: ${control.text}`);
        assert.ok(control.mask.split(",").every(value => value.trim() === "exclude"), control.text);
        if (control.disabled) assert.equal(control.glow, "none", control.text);
        else assert.match(control.image, /linear-gradient/, control.text);
      }
    }
  }
});

async function nativeTouch(page, selector, distance, axis = "x") {
  const start = await page.evaluate(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  const point = (fraction) => ({x:start.x+(axis==="x"?distance*fraction:0),y:start.y+(axis==="y"?distance*fraction:0),id:1,force:1,radiusX:2,radiusY:2});
  await page.send("Input.dispatchTouchEvent", {type:"touchStart",touchPoints:[point(0)]});
  let mid;
  for(let i=1;i<=8;i++) {
    await page.send("Input.dispatchTouchEvent", {type:"touchMove",touchPoints:[point(i/8)]});
    if(i===4) mid=await page.evaluate(`({theme:Number(document.querySelector('.theme-switch').style.getPropertyValue('--pos')),lang:Number(document.querySelector('#ui-lang-seg').style.getPropertyValue('--lang-pos'))})`);
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  await page.send("Input.dispatchTouchEvent", {type:"touchEnd",touchPoints:[]});
  await new Promise(resolve=>setTimeout(resolve,550));
  return mid;
}
async function nativeTap(page, selector) {
  const p=await page.evaluate(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,id:1};})()`);
  await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});
  await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await new Promise(resolve=>setTimeout(resolve,550));
}
test("native touch: isolated header controls never lose capture or bounce after release",async(t)=>{
  const site=await startSite();const browser=await launchChrome();const page=await browser.newPage();
  t.after(async()=>{await page.close();await browser.close();await new Promise(resolve=>site.server.close(resolve));});
  await page.setSize(390,844,true);
  await page.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  await resetHome(page,site.origin,'light');
  await t.test('login and both capsules have safe independent hit areas without header scrolling',async()=>{
    for(const [width,height] of [[360,800],[375,667],[390,844],[430,932],[1280,800]]){
      await page.setSize(width,height,width<900);
      const layout=await page.evaluate(`(() => {
        const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
        const a=rect('.auth-top-btn'),theme=rect('.theme-switch'),lang=rect('#ui-lang-seg');
        const gap=b=>({x:Math.max(b.left-a.right,a.left-b.right),y:Math.max(b.top-a.bottom,a.top-b.bottom)});
        const tools=document.querySelector('.header-tools');
        return {theme:gap(theme),lang:gap(lang),noScroll:tools.scrollWidth<=tools.clientWidth,noOverflow:document.documentElement.scrollWidth<=innerWidth};
      })()`);
      for(const gap of [layout.theme,layout.lang])assert.ok(gap.x>=14||gap.y>=8,`${width}: ${JSON.stringify(layout)}`);
      assert.equal(layout.noScroll,true);assert.equal(layout.noOverflow,true);
    }
    await page.setSize(390,844,true);
  });
  await t.test('theme thumb real-touch drag works both ways, survives delayed clicks and persists',async()=>{
    let mid=await nativeTouch(page,'.theme-thumb',-30);assert.ok(mid.theme>0&&mid.theme<1,JSON.stringify(mid));
    assert.equal(await page.evaluate('document.documentElement.dataset.theme'),'dark');
    await page.evaluate(`document.querySelector('.theme-switch').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
    assert.equal(await page.evaluate('document.documentElement.dataset.theme'),'dark');
    await page.open(site.origin+'/index.html');assert.equal(await page.evaluate('document.documentElement.dataset.theme'),'dark');
    mid=await nativeTouch(page,'.theme-thumb',30);assert.ok(mid.theme>0&&mid.theme<1,JSON.stringify(mid));
    assert.equal(await page.evaluate('document.documentElement.dataset.theme'),'light');
    await page.open(site.origin+'/index.html');assert.equal(await page.evaluate('document.documentElement.dataset.theme'),'light');
    await nativeTap(page,'.theme-switch');assert.equal(await page.evaluate('document.documentElement.dataset.theme'),'dark');
    await nativeTap(page,'.theme-switch');assert.equal(await page.evaluate('document.documentElement.dataset.theme'),'light');
  });
  await t.test('language thumb real-touch Chinese/Korean/English round trip keeps the same node and actual UI',async()=>{
    await page.evaluate(`window.__nativeThumb=document.querySelector('.lang-thumb');window.__authClicks=0;document.querySelector('.auth-top-btn').addEventListener('click',()=>window.__authClicks++);`);
    for(const [distance,expected] of [[1,'ko'],[1,'en'],[-1,'ko'],[-1,'zh']]){
      const step=await page.evaluate(`uiLangGeometry(document.querySelector('#ui-lang-seg')).travel`);
      const mid=await nativeTouch(page,'.lang-thumb',step*distance);
      assert.ok(Math.abs(mid.lang-Math.round(mid.lang))>.1,JSON.stringify(mid));
      await page.evaluate(`document.querySelector('#ui-lang-seg button[data-lang="${expected === 'en' ? 'zh' : 'en'}"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
      const result=await page.evaluate(`({lang:document.documentElement.lang,active:document.querySelector('#ui-lang-seg button.active').dataset.lang,same:window.__nativeThumb===document.querySelector('.lang-thumb'),auth:window.__authClicks,gate:document.querySelector('#auth-gate').hidden})`);
      assert.equal(result.active,expected);assert.equal(result.same,true);assert.equal(result.auth,0);assert.equal(result.gate,true);
      assert.equal(result.lang,expected==='zh'?'zh-CN':expected);
    }
    for(const lang of ['en','ko','zh']){await nativeTap(page,`#ui-lang-seg button[data-lang="${lang}"]`);assert.equal(await page.evaluate(`document.querySelector('#ui-lang-seg button.active').dataset.lang`),lang);}
    const result=await page.evaluate('({clicks:window.__authClicks,path:location.pathname})');assert.equal(result.clicks,0);assert.equal(result.path,'/index.html');
  });
  await t.test('touch scrolling outside capsules remains native and no console/runtime errors occur',async()=>{
    await page.setSize(390,500,true);
    await nativeTouch(page,'#question-stem',-180,'y');
    assert.ok(await page.evaluate('scrollY>20'));
    assert.deepEqual(page.errors,[]);
  });
});
