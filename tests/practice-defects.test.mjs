/**
 * Synthetic checks for the three acceptance failures.
 * Uses a throwaway browser profile and never reads a real learner record.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import test from "node:test";
import { ensureArtifactDir } from "./test-artifacts.mjs";

const ROOT = new URL("..", import.meta.url);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".bin": "application/octet-stream",
  ".txt": "text/plain",
  ".md": "text/plain",
  ".vtt": "text/vtt",
};

function startSite() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let path = decodeURIComponent(url.pathname);
    if (path === "/") path = "/index.html";
    const file = join(ROOT.pathname, path);
    try {
      const body = readFileSync(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("missing");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

async function launchChrome() {
  const dir = mkdtempSync(join(tmpdir(), "korean-practice-"));
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
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    chrome.stderr.on("data", onData);
    chrome.stdout.on("data", onData);
    chrome.on("exit", () => reject(new Error("chrome exited before DevTools")));
  });
  const version = await (await fetch(wsUrl.replace(/^ws/, "http").replace(/\/devtools\/browser.*$/, "/json/version"))).json();
  const browser = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve) => { browser.addEventListener("open", resolve, { once: true }); });
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
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "evaluate failed");
    return result.result.value;
  }
  async function open(url) {
    const navToken = `nav-${Date.now()}-${Math.random()}`;
    try { await evaluate(`window.__koreanNavToken = ${JSON.stringify(navToken)}`); } catch (error) {}
    await send("Page.navigate", { url }, sessionId);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const state = await evaluate("({ ready: document.readyState, href: location.href, token: window.__koreanNavToken || null })");
        if (state.ready === "complete" && state.href === url && state.token !== navToken) break;
      } catch (error) { /* the old execution context was replaced */ }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    if (url.includes("index.html")) {
      try {
        await evaluate(`new Promise((resolve) => {
          let ticks = 0;
          const tick = () => {
            if (document.querySelector("#question-stem, #reading-card .choice-opt, #pack-retry")) resolve(true);
            else if (++ticks > 500) resolve(false);
            else setTimeout(tick, 20);
          };
          tick();
        })`);
      } catch (error) {}
    }
    await evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve('ok')))");
  }
  const shotDir = ensureArtifactDir("practice-defect-fixes");
  return {
    evaluate,
    open,
    async shot(name) {
      const { data } = await send("Page.captureScreenshot", { format: "png" }, sessionId);
      writeFileSync(join(shotDir, `${name}.png`), Buffer.from(data, "base64"));
    },
    async close() {
      browser.close();
      chrome.kill();
    },
  };
}

async function ensureStarted(page) {
  const status = await page.evaluate(`(() => {
    if (document.querySelector(".choice-opt, .tile, .match-item, #d-input, #gex-choices, #reading-card")) return "ready";
    const start = document.getElementById("session-start");
    if (start && !start.disabled) { start.click(); return "started"; }
    return "missing";
  })()`);
  assert.equal(status === "ready" || status === "started", true, "practice question did not open");
  await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve('ok')))");
}

async function clickButton(page, label) {
  const status = await page.evaluate(`new Promise((resolve) => {
    const label = ${JSON.stringify(label)};
    function textOf(button) { return button.textContent.replace(/\\s+/g, " ").trim(); }
    function matches(text) {
      return text === label || text.endsWith(label) || text.startsWith(label + " ") || text.startsWith(label + " ·");
    }
    const practiceOnly = new Set(["词义选择", "选词拼句", "选项连线", "听写", "语法", "实用阅读", "未分级"]);
    const started = Date.now();
    const tick = () => {
      const roots = practiceOnly.has(label)
        ? [document.querySelector("#panel-practice")]
        : [document.querySelector("#panel-practice"), document.querySelector("#main-nav"), document.body];
      for (const root of roots) {
        if (!root) continue;
        const found = [...root.querySelectorAll("button")].find((button) => matches(textOf(button)) && !button.disabled);
        if (found) { found.click(); resolve("clicked"); return; }
      }
      if (Date.now() - started > 8000) resolve("missing");
      else setTimeout(tick, 40);
    };
    tick();
  })`);
  assert.equal(status, "clicked", `button not found: ${label}`);
  await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve('ok')))");
}

async function clickNav(page, label) {
  const status = await page.evaluate(`(() => {
    const label = ${JSON.stringify(label)};
    const found = [...document.querySelectorAll("#main-nav button")].find((button) => button.textContent.replace(/\\s+/g, "").endsWith(label));
    if (!found) return "missing";
    found.click();
    return "clicked";
  })()`);
  assert.equal(status, "clicked", `nav not found: ${label}`);
  await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve('ok')))");
}

function storage(page) {
  return page.evaluate(`(() => {
    const raw = JSON.parse(localStorage.getItem("koreanSite_zhcn_draft_v01") || "{}");
    return {
      mistakes: raw.mistakes || {},
      reviewQueue: raw.reviewQueue || [],
      active: document.querySelector(".panel.active") && document.querySelector(".panel.active").id,
      gateHidden: document.getElementById("auth-gate").hidden,
      locked: document.body.classList.contains("auth-locked"),
      text: document.body.innerText
    };
  })()`);
}

test("practice defects: tile mistakes, same-day review, and ungraded labels", async (t) => {
  const site = await startSite();
  const page = await launchChrome();
  t.after(async () => {
    await page.close();
    await new Promise((resolve) => site.server.close(resolve));
  });

  await t.test("a wrong tile sentence is saved once and can be reviewed after refresh", async () => {
    await page.open(`${site.origin}/index.html`);
    await page.evaluate("localStorage.clear()");
    await page.open(`${site.origin}/index.html`);
    await clickButton(page, "选词拼句");
    await clickButton(page, "未分级");
    await ensureStarted(page);
    const prompt = await page.evaluate(`(() => {
      const heads = [...document.querySelectorAll("#panel-practice p strong")];
      return heads.length ? heads[heads.length - 1].textContent : "";
    })()`);
    assert.notEqual(prompt, "");
    const tileClick = await page.evaluate(`(() => {
      const tile = document.querySelector(".tile");
      if (!tile) return "missing";
      tile.click();
      return "clicked";
    })()`);
    assert.equal(tileClick, "clicked");
    await clickButton(page, "检查");
    await page.shot("tile-wrong");
    const after = await storage(page);
    assert.match(after.text, /不对/);
    const ids = Object.keys(after.mistakes);
    assert.equal(ids.length, 1);
    assert.equal(after.mistakes[ids[0]].count, 1);
    assert.equal(after.reviewQueue.length, 1);
    assert.equal(after.reviewQueue[0].id, ids[0]);
    await page.evaluate("document.getElementById('tile-check') && document.getElementById('tile-check').click()");
    const again = await storage(page);
    assert.equal(again.mistakes[ids[0]].count, 1);
    await page.open(`${site.origin}/index.html`);
    const kept = await storage(page);
    assert.equal(kept.mistakes[ids[0]].count, 1);
    assert.equal(kept.active, "panel-practice");
    assert.equal(kept.gateHidden, true);
    await clickButton(page, "每日复习");
    const daily = await storage(page);
    assert.equal(daily.text.includes("开始今日复习"), true);
    assert.equal(await page.evaluate("document.getElementById('daily-start').disabled"), false);
    assert.equal(daily.text.includes(prompt), true);
    await page.shot("tile-daily");
    await clickButton(page, "开始今日复习");
    const review = await storage(page);
    assert.match(review.text, /选词拼句/);
    assert.equal(review.text.includes(prompt), true);
    await page.shot("tile-review-original");
    assert.equal(review.gateHidden, true);
  });

  await t.test("a new dictation mistake is due for today's review", async () => {
    await page.open(`${site.origin}/index.html`);
    await page.evaluate("localStorage.clear()");
    await page.open(`${site.origin}/index.html`);
    await clickButton(page, "听写");
    await clickButton(page, "未分级");
    await ensureStarted(page);
    await page.evaluate(`(() => {
      const input = document.getElementById("d-input");
      input.value = "가나다QA오답";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await clickButton(page, "检查");
    const saved = await storage(page);
    const ids = Object.keys(saved.mistakes);
    assert.equal(ids.length, 1);
    assert.equal(saved.mistakes[ids[0]].count, 1);
    assert.equal(saved.reviewQueue.length, 1);
    await clickButton(page, "每日复习");
    const daily = await storage(page);
    assert.equal(await page.evaluate("document.getElementById('daily-start').disabled"), false);
    assert.doesNotMatch(daily.text, /今天没有到期条目/);
    await page.shot("dictation-daily");
    assert.match(daily.text, /次数: 1/);
  });

  await t.test("a mismatched linking board is saved once and reviews the same four entries", async () => {
    await page.open(`${site.origin}/index.html`);
    await page.evaluate("localStorage.clear()");
    await page.open(`${site.origin}/index.html`);
    await clickButton(page, "选项连线");
    await clickButton(page, "未分级");
    await ensureStarted(page);
    const words = await page.evaluate(`[...document.querySelectorAll("[data-side='r']")].map((button) => button.textContent.trim())`);
    assert.equal(words.length, 4);
    const paired = await page.evaluate(`(() => {
      const ids = [...document.querySelectorAll("[data-side='l']")].map((button) => button.getAttribute("data-id"));
      if (ids.length !== 4 || new Set(ids).size !== 4) return null;
      return ids.map((id, index) => [id, ids[(index + 1) % ids.length]]);
    })()`);
    assert.equal(paired && paired.length, 4);
    for (const [leftId, rightId] of paired) {
      const step = await page.evaluate(`(() => {
        const left = document.querySelector("[data-side='l'][data-id='${leftId}']");
        const right = document.querySelector("[data-side='r'][data-id='${rightId}']");
        if (!left || !right) return "missing";
        left.click();
        right.click();
        return "clicked";
      })()`);
      assert.equal(step, "clicked");
    }
    await clickButton(page, "检查");
    await page.shot("match-wrong");
    const after = await storage(page);
    assert.match(after.text, /不对/);
    const ids = Object.keys(after.mistakes);
    assert.equal(ids.length, 1);
    assert.match(ids[0], /^match:/);
    assert.equal(after.mistakes[ids[0]].count, 1);
    assert.equal(after.reviewQueue.length, 1);
    assert.equal(after.reviewQueue[0].id, ids[0]);
    await page.evaluate("document.getElementById('match-check') && document.getElementById('match-check').click()");
    assert.equal((await storage(page)).mistakes[ids[0]].count, 1);
    await page.open(`${site.origin}/index.html`);
    assert.equal((await storage(page)).mistakes[ids[0]].count, 1);
    await clickButton(page, "每日复习");
    const daily = await storage(page);
    assert.equal(await page.evaluate("document.getElementById('daily-start').disabled"), false);
    for (const word of words) assert.equal(daily.text.includes(word), true, word);
    await page.shot("match-daily");
    await clickButton(page, "开始今日复习");
    const review = await storage(page);
    assert.match(review.text, /选项连线/);
    const reviewed = await page.evaluate(`[...document.querySelectorAll("[data-side='r']")].map((button) => button.textContent.trim()).sort()`);
    assert.deepEqual(reviewed, words.slice().sort());
    await page.shot("match-review-original");
  });

  await t.test("a wrong grammar choice is saved once and reviews the same prompt", async () => {
    await page.open(`${site.origin}/index.html`);
    await page.evaluate("localStorage.clear()");
    await page.open(`${site.origin}/index.html`);
    await clickButton(page, "语法");
    await clickButton(page, "未分级");
    await ensureStarted(page);
    const prompt = await page.evaluate("document.querySelector('#gex-choices').previousElementSibling.textContent.trim()");
    assert.notEqual(prompt, "");
    const picked = await page.evaluate(`(() => {
      const current = window.__draft.grammar;
      const correct = current.ids[current.index];
      const choice = [...document.querySelectorAll("#gex-choices .choice")].find((button) => button.getAttribute("data-gid") !== correct);
      if (!choice) return "missing";
      choice.click();
      return "clicked";
    })()`);
    assert.equal(picked, "clicked");
    await clickButton(page, "检查");
    await page.shot("grammar-wrong");
    const after = await storage(page);
    assert.match(after.text, /不对/);
    const ids = Object.keys(after.mistakes);
    assert.equal(ids.length, 1);
    assert.match(ids[0], /^grammar:/);
    assert.equal(after.mistakes[ids[0]].count, 1);
    assert.equal(after.reviewQueue.length, 1);
    await page.evaluate("document.getElementById('gex-check') && document.getElementById('gex-check').click()");
    assert.equal((await storage(page)).mistakes[ids[0]].count, 1);
    await page.open(`${site.origin}/index.html`);
    assert.equal((await storage(page)).mistakes[ids[0]].count, 1);
    await clickButton(page, "每日复习");
    const daily = await storage(page);
    assert.equal(await page.evaluate("document.getElementById('daily-start').disabled"), false);
    assert.equal(daily.text.includes(prompt), true);
    await page.shot("grammar-daily");
    await clickButton(page, "开始今日复习");
    const review = await storage(page);
    assert.match(review.text, /语法/);
    const reviewedPrompt = await page.evaluate("document.querySelector('#gex-choices').previousElementSibling.textContent.trim()");
    assert.equal(reviewedPrompt, prompt);
    await page.shot("grammar-review-original");
  });

  await t.test("ungraded pools are not labeled as verified questions", async () => {
    await page.open(`${site.origin}/index.html`);
    await page.evaluate("localStorage.clear()");
    await page.open(`${site.origin}/index.html`);
    const modes = [
      ["选词拼句", "4"],
      ["选项连线", "14"],
      ["听写", "45"],
      ["语法", "7"],
    ];
    for (const [mode, count] of modes) {
      await clickButton(page, mode);
      await clickButton(page, "未分级");
      const lines = await page.evaluate(`[...document.querySelectorAll("#panel-practice p")].map((p) => p.textContent.trim())`);
      assert.equal(lines.some((line) => line === `已核实题目: ${count}`), false, mode);
      assert.equal(lines.some((line) => line === `未分级: ${count}`), true, mode);
      if (mode === "选词拼句") await page.shot("ungraded-tiles-label");
      assert.equal(lines.some((line) => line.startsWith("已核实题目: 0")), true, mode);
    }
    const topik = await page.evaluate(`[...document.querySelectorAll("[data-level]")].filter((b) => b.getAttribute("data-level") !== "ungraded").map((b) => b.textContent.trim())`);
    assert.deepEqual(topik, ["TOPIK 1 · 0", "TOPIK 2 · 0", "TOPIK 3 · 0", "TOPIK 4 · 0", "TOPIK 5 · 0", "TOPIK 6 · 0"]);
  });

  await t.test("fresh entry, saved progress, materials, and a repeated dictation miss stay intact", async () => {
    await page.open(`${site.origin}/index.html`);
    await page.evaluate("localStorage.clear()");
    await page.open(`${site.origin}/index.html`);
    let view = await storage(page);
    assert.equal(view.active, "panel-practice");
    assert.equal(view.gateHidden, true);
    assert.equal(view.locked, false);
    await page.evaluate(`(() => {
      localStorage.setItem("lastPanel", "materials");
      localStorage.setItem("panel", "settings");
      localStorage.setItem("koreanSite_zhcn_draft_v01", JSON.stringify({
        uiLang: "zh",
        mistakes: { p01: { count: 3, stages: { listening: 3 }, parts: {}, lastAt: "2026-11-21" } },
        reviewQueue: [],
        version: 1
      }));
    })()`);
    await page.open(`${site.origin}/index.html`);
    view = await storage(page);
    assert.equal(view.active, "panel-practice");
    assert.equal(view.gateHidden, true);
    assert.equal(view.mistakes.p01.count, 3);
    await clickNav(page, "语法");
    await page.evaluate(`(() => {
      const button = document.querySelector(".panel.active [data-jump='materials']");
      if (!button) return "missing";
      button.click();
      return "clicked";
    })()`);
    view = await storage(page);
    assert.equal(view.active, "panel-materials");
    assert.match(view.text, /学习资料/);
    await clickNav(page, "练习");
    view = await storage(page);
    assert.equal(view.active, "panel-practice");
    await clickButton(page, "听写");
    await clickButton(page, "未分级");
    await ensureStarted(page);
    await page.evaluate(`(() => {
      const input = document.getElementById("d-input");
      input.value = "가나다QA오답";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await clickButton(page, "检查");
    view = await storage(page);
    assert.equal(view.mistakes.p01.count, 4);
    await clickButton(page, "查看详解");
    const explained = await page.evaluate("document.getElementById('dictation-mount').innerText");
    assert.match(explained, /查看详解|풀이|explanation|不对/);
    await clickButton(page, "下一题");
    const nextQuestion = await page.evaluate("document.getElementById('dictation-mount').innerText");
    assert.doesNotMatch(nextQuestion, /不对/);
    assert.match(nextQuestion, /请输入韩语/);
  });
});
