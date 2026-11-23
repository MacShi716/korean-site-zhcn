/**
 * First-question cold start, Hangil reading, video overflow, and login copy.
 * Uses a throwaway browser profile and never reads a real learner record.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import test from "node:test";

const ROOT = new URL("..", import.meta.url);
const HANGIL = JSON.parse(readFileSync(new URL("../data/hangil-reading-55/hangil-text-mcq.json", import.meta.url), "utf8"));
const SHOTS = "/opt/cursor/artifacts";
const VIEWPORTS = [
  { name: "375x667", width: 375, height: 667, mobile: true },
  { name: "390x844", width: 390, height: 844, mobile: true },
  { name: "430x932", width: 430, height: 932, mobile: true },
  { name: "1280x800", width: 1280, height: 800, mobile: false },
];

test("Hangil reading files keep the supplied bytes and are not TOPIK", () => {
  const json = readFileSync(new URL("../data/hangil-reading-55/hangil-text-mcq.json", import.meta.url));
  const license = readFileSync(new URL("../data/hangil-reading-55/LICENSE-HANGIL-MIT.txt", import.meta.url));
  assert.equal(createHash("sha256").update(json).digest("hex"), "7d3ca99b0ab07e3fd5fb255ff06ec5fee7dd4153ad34ac94da8e535362b09eaa");
  assert.equal(createHash("sha256").update(license).digest("hex"), "804739d091ac6139ed32457ead8d5c05c49c7d564dd4447fb011b4a2269e622f");
  assert.equal(HANGIL.items.length, 55);
  for (const item of HANGIL.items) {
    assert.equal(item.type, "reading-mcq");
    assert.equal(item.topikVerified, false);
    assert.equal(item.topikLevel, null);
    assert.equal(item.options.length, 4);
    assert.equal(item.options.some((option) => option.id === item.answerOptionId), true);
    assert.equal(typeof item.contextKo, "string");
    assert.equal(typeof item.promptKo, "string");
    assert.equal(typeof item.explanationEn, "string");
  }
  assert.match(license.toString("utf8"), /MIT License/);
  assert.match(license.toString("utf8"), /Copyright \(c\) 2026 DOUBLEEM/);
});

function startSite() {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".json": "application/json",
    ".css": "text/css",
    ".vtt": "text/vtt",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".txt": "text/plain",
    ".wasm": "application/wasm",
  };
  const state = { failPack: false };
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let path = decodeURIComponent(url.pathname);
    if (path === "/korean-site-zhcn" || path === "/korean-site-zhcn/") path = "/index.html";
    else if (path.startsWith("/korean-site-zhcn/")) path = path.slice("/korean-site-zhcn".length);
    if (path === "/") path = "/index.html";
    if (state.failPack && /graded-exercises-pack|graded-vocab-300|hangil-text-mcq/.test(path)) {
      res.writeHead(404);
      res.end("missing");
      return;
    }
    try {
      const body = readFileSync(join(ROOT.pathname, path));
      res.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream" });
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
  const dir = mkdtempSync(join(tmpdir(), "korean-first-"));
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
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  mkdirSync(SHOTS, { recursive: true });
  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  return {
    evaluate,
    async setSize(width, height, mobile) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile }, sessionId);
    },
    async open(url) {
      await send("Page.navigate", { url }, sessionId);
      await evaluate("document.readyState");
      await evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve('ok')))");
    },
    async shot(name) {
      const { data } = await send("Page.captureScreenshot", { format: "png" }, sessionId);
      writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(data, "base64"));
    },
    async close() { browser.close(); chrome.kill(); },
  };
}

async function clickButton(page, label) {
  const status = await page.evaluate(`(() => {
    const label = ${JSON.stringify(label)};
    const found = [...document.querySelectorAll("button")].find((button) => {
      const text = button.textContent.replace(/\\s+/g, " ").trim();
      return !button.disabled && (text === label || text.endsWith(label) || text.startsWith(label + " ") || text.startsWith(label + " ·"));
    });
    if (!found) return "missing";
    found.click();
    return "clicked";
  })()`);
  assert.equal(status, "clicked", `button not found: ${label}`);
  await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve('ok')))");
}

async function coldOpen(page, url) {
  await page.open(url);
  await page.evaluate("localStorage.clear()");
  await page.open(url);
  const ready = await page.evaluate(`new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const stem = document.querySelector("#question-stem");
      const opt = document.querySelector(".choice-opt");
      const submit = document.getElementById("choice-check");
      if (stem && opt && submit && stem.textContent.trim()) resolve(true);
      else if (Date.now() - start > 8000) resolve(false);
      else setTimeout(tick, 40);
    };
    tick();
  })`);
  assert.equal(ready, true, `question did not appear at ${url}`);
}

function inViewScript(selector) {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok: false, missing: true };
    const r = el.getBoundingClientRect();
    return {
      ok: r.width > 8 && r.height > 8 && r.top >= -1 && r.left >= -1 && r.bottom <= window.innerHeight + 1 && r.right <= window.innerWidth + 1,
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      height: window.innerHeight,
      text: el.textContent.trim().slice(0, 40)
    };
  })()`;
}

test("cold open shows a real question, reading works, video fits, and login copy is current", async (t) => {
  const site = await startSite();
  const page = await launchChrome();
  t.after(async () => { await page.close(); await new Promise((resolve) => site.server.close(resolve)); });

  for (const viewport of VIEWPORTS) {
    await t.test(`cold open at ${viewport.name} shows the first question inside the viewport`, async () => {
      await page.setSize(viewport.width, viewport.height, viewport.mobile);
      for (const path of ["/index.html", "/korean-site-zhcn/index.html"]) {
        await coldOpen(page, `${site.origin}${path}`);
        const view = await page.evaluate(`(() => {
          const stem = document.querySelector("#question-stem").getBoundingClientRect();
          const options = [...document.querySelectorAll(".choice-opt")].map((el) => el.getBoundingClientRect());
          const submit = document.getElementById("choice-check").getBoundingClientRect();
          const inside = (r) => r.width > 8 && r.height > 8 && r.top >= -1 && r.left >= -1 && r.bottom <= window.innerHeight + 1 && r.right <= window.innerWidth + 1;
          return {
            stem: document.querySelector("#question-stem").textContent.trim(),
            optionCount: options.length,
            stemIn: inside(stem),
            optionsIn: options.every(inside),
            submitIn: inside(submit),
            start: !!document.getElementById("session-start"),
            gateHidden: document.getElementById("auth-gate").hidden,
            locked: document.body.classList.contains("auth-locked"),
            scroll: document.documentElement.scrollWidth <= window.innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            audio: document.querySelectorAll("audio").length,
            topikText: document.querySelector(".practice-sources").textContent,
            credit: document.querySelector(".practice-credit").textContent
          };
        })()`);
        assert.equal(view.start, false, path);
        assert.equal(view.gateHidden, true, path);
        assert.equal(view.locked, false, path);
        assert.equal(view.optionCount, 4, path);
        assert.equal(view.stemIn, true, `${path} stem ${view.stem}`);
        assert.equal(view.optionsIn, true, path);
        assert.equal(view.submitIn, true, path);
        assert.equal(view.scroll, true, `${path} scroll ${view.scrollWidth}>${view.innerWidth}`);
        assert.equal(view.audio, 0, path);
        assert.match(view.topikText, /TOPIK 1–6 官方核定：0/);
        assert.match(view.credit, /국립국어원/);
        assert.match(view.credit, /CC BY-SA 2.0 KR/);
        const before = view.stem;
        await page.evaluate("document.querySelector('.choice-opt').click()");
        await clickButton(page, "检查");
        const marked = await page.evaluate("document.querySelector('#choice-result').textContent");
        assert.match(marked, /正确！|不对/);
        assert.equal(await page.evaluate("document.body.innerText.includes('answerOptionId')"), false);
        await clickButton(page, "下一题");
        const nextStem = await page.evaluate("document.querySelector('#question-stem').textContent.trim()");
        assert.notEqual(nextStem, before);
        if (viewport.name === "390x844" && path === "/index.html") await page.shot("mobile-390-first-question");
      }
    });
  }

  await t.test("finishing or leaving a round does not open another one", async () => {
    await page.setSize(390, 844, true);
    await coldOpen(page, `${site.origin}/index.html`);
    await clickButton(page, "选词拼句");
    await clickButton(page, "未分级");
    for (let i = 0; i < 4; i += 1) {
      const tile = await page.evaluate(`(() => {
        const button = document.querySelector(".tile");
        if (!button) return "missing";
        button.click();
        return "clicked";
      })()`);
      assert.equal(tile, "clicked", `tile ${i}`);
      await clickButton(page, "检查");
      await clickButton(page, "下一题");
    }
    const done = await page.evaluate("document.querySelector('#panel-practice').innerText");
    assert.match(done, /本轮做完/);
    await page.evaluate("new Promise((resolve) => setTimeout(resolve, 400))");
    const stayed = await page.evaluate(`(() => ({
      text: document.querySelector('#panel-practice').innerText,
      phase: window.__draft.session && window.__draft.session.phase,
      tiles: document.querySelectorAll('.tile').length
    }))()`);
    assert.match(stayed.text, /本轮做完/);
    assert.equal(stayed.phase, "done");
    assert.equal(stayed.tiles, 0);
    await clickButton(page, "再练一轮");
    assert.equal(await page.evaluate("document.querySelectorAll('.tile').length > 0"), true);
    await clickButton(page, "结束本轮");
    await page.evaluate("new Promise((resolve) => setTimeout(resolve, 300))");
    const exited = await page.evaluate(`(() => ({
      text: document.querySelector('#panel-practice').innerText,
      phase: window.__draft.session && window.__draft.session.phase
    }))()`);
    assert.match(exited.text, /本轮已退出/);
    assert.equal(exited.phase, null);
  });

  await t.test("a failed pack is an error with retry, not zero questions", async () => {
    site.state.failPack = true;
    await page.setSize(390, 844, true);
    await page.open(`${site.origin}/index.html`);
    await page.evaluate("localStorage.clear()");
    await page.open(`${site.origin}/index.html`);
    const failed = await page.evaluate(`new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const retry = document.getElementById("pack-retry");
        if (retry) resolve(document.querySelector("#pack-status").innerText);
        else if (Date.now() - start > 8000) resolve("");
        else setTimeout(tick, 40);
      };
      tick();
    })`);
    assert.match(failed, /不是 0 道题/);
    assert.equal(failed.includes("词典初级 · 0"), false);
    assert.equal(await page.evaluate("document.querySelector('[data-grade]') === null"), true);
    site.state.failPack = false;
    await clickButton(page, "重试");
    const back = await page.evaluate(`new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (document.querySelector("#question-stem")) resolve(true);
        else if (Date.now() - start > 8000) resolve(false);
        else setTimeout(tick, 40);
      };
      tick();
    })`);
    assert.equal(back, true);
  });

  await t.test("Hangil reading shuffles options, hides the answer, and reviews the same item", async () => {
    await page.setSize(390, 844, true);
    await coldOpen(page, `${site.origin}/index.html`);
    const item = HANGIL.items[0];
    const orders = [];
    for (let i = 0; i < 8; i += 1) {
      await clickButton(page, "实用阅读");
      orders.push(await page.evaluate(`[...document.querySelectorAll("#reading-card .choice-opt")].map((button) => button.getAttribute("data-choice")).join(",")`));
    }
    assert.equal(new Set(orders).size > 1, true, orders.join(" | "));
    const before = await page.evaluate(`(() => {
      const card = document.getElementById("reading-card");
      return {
        text: card.innerText,
        html: card.innerHTML,
        options: [...card.querySelectorAll(".choice-opt")].map((button) => button.textContent.trim())
      };
    })()`);
    assert.equal(before.text.includes(item.contextKo), true);
    assert.equal(before.text.includes(item.promptKo), true);
    assert.equal(before.text.includes(item.explanationEn), false);
    assert.equal(before.html.includes("answerOptionId"), false);
    assert.equal(before.html.includes(item.explanationEn), false);
    assert.deepEqual(before.options.slice().sort(), item.options.map((option) => option.text).sort());
    await page.shot("mobile-390-reading");
    const wrong = item.options.find((option) => option.id !== item.answerOptionId);
    await clickButton(page, wrong.text);
    await clickButton(page, "检查");
    const marked = await page.evaluate("document.querySelector('#choice-result').innerText");
    assert.match(marked, /不对/);
    assert.equal(marked.includes(item.explanationEn), true);
    const saved = await page.evaluate(`(() => {
      const raw = JSON.parse(localStorage.getItem("koreanSite_zhcn_draft_v01"));
      const id = "reading:" + ${JSON.stringify(item.id)};
      return { count: raw.mistakes[id] && raw.mistakes[id].count, due: raw.reviewQueue[0] && raw.reviewQueue[0].id };
    })()`);
    assert.equal(saved.count, 1);
    assert.equal(saved.due, "reading:" + item.id);
    await page.evaluate("document.getElementById('choice-check') && document.getElementById('choice-check').click()");
    assert.equal(await page.evaluate(`JSON.parse(localStorage.getItem("koreanSite_zhcn_draft_v01")).mistakes[${JSON.stringify("reading:" + item.id)}].count`), 1);
    await page.open(`${site.origin}/index.html`);
    const reloaded = await page.evaluate(`new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const button = [...document.querySelectorAll("#main-nav button")].find((item) => item.textContent.includes("每日复习") || item.textContent.includes("复习"));
        if (button) resolve(true);
        else if (Date.now() - start > 8000) resolve(false);
        else setTimeout(tick, 40);
      };
      tick();
    })`);
    assert.equal(reloaded, true);
    await clickButton(page, "每日复习");
    const daily = await page.evaluate("document.querySelector('#panel-daily').innerText");
    assert.equal(daily.includes(item.contextKo), true);
    await clickButton(page, "开始今日复习");
    const review = await page.evaluate(`new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const card = document.getElementById("reading-card");
        if (card && card.innerText.includes(${JSON.stringify(item.contextKo)})) resolve(card.innerText);
        else if (Date.now() - start > 8000) resolve("");
        else setTimeout(tick, 40);
      };
      tick();
    })`);
    assert.equal(review.includes(item.promptKo), true);
    assert.equal(review.includes(item.explanationEn), false);
    assert.match(review, /实用阅读/);
    const credit = await page.evaluate("document.querySelector('#panel-practice').innerText");
    assert.match(credit, /Hangil_app/);
    assert.match(credit, /MIT/);
    assert.match(credit, /不是 TOPIK 官方真题/);
  });

  await t.test("video and the main pages do not overflow horizontally", async () => {
    for (const viewport of VIEWPORTS) {
      await page.setSize(viewport.width, viewport.height, viewport.mobile);
      await coldOpen(page, `${site.origin}/index.html`);
      const home = await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth");
      assert.equal(home, true, `home ${viewport.name}`);
      await page.evaluate(`(() => {
        const button = [...document.querySelectorAll("#main-nav button")].find((item) => item.textContent.replace(/\\s+/g, "").endsWith("视频学习"));
        button.click();
      })()`);
      const ready = await page.evaluate(`new Promise((resolve) => {
        const start = Date.now();
        const tick = () => {
          if (document.querySelectorAll(".cue-row").length === 25) resolve(true);
          else if (Date.now() - start > 8000) resolve(false);
          else setTimeout(tick, 40);
        };
        tick();
      })`);
      assert.equal(ready, true, viewport.name);
      const video = await page.evaluate(`(() => {
        const link = document.querySelector("#panel-video a.source-link");
        const rect = link.getBoundingClientRect();
        return {
          scroll: document.documentElement.scrollWidth <= window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          href: link.getAttribute("href"),
          text: link.textContent,
          right: rect.right,
          cues: document.querySelectorAll(".cue-row").length,
          body: document.querySelector("#panel-video").innerText
        };
      })()`);
      assert.equal(video.scroll, true, `${viewport.name} ${video.scrollWidth}>${video.innerWidth}`);
      assert.equal(video.cues, 25);
      assert.equal(video.right <= viewport.width + 1, true, video.right);
      assert.match(video.href, /museum\.go\.kr/);
      assert.equal(video.text, video.href);
      assert.match(video.body, /국립중앙박물관/);
      assert.match(video.body, /KOGL1|공공누리/);
      if (viewport.name === "390x844") {
        await page.evaluate("document.querySelector('#panel-video .source-link').scrollIntoView({ block: 'center' })");
        await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve('ok')))");
        const still = await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth");
        assert.equal(still, true);
        await page.shot("mobile-390-video");
      }
      for (const panel of ["materials", "browse", "settings", "daily"]) {
        await page.evaluate(`window.__koreanSite.showPanel(${JSON.stringify(panel)})`);
        await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve('ok')))");
        const fit = await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth");
        assert.equal(fit, true, `${panel} ${viewport.name}`);
      }
    }
  });

  await t.test("the login page no longer claims it is unwired or a demo", async () => {
    await page.setSize(390, 844, true);
    await page.open(`${site.origin}/index.html`);
    await page.evaluate(`localStorage.setItem("koreanSite_zhcn_draft_v01", JSON.stringify({ uiLang: "zh", mistakes: { p01: { count: 2 } }, reviewQueue: [], version: 1 }))`);
    await page.open(`${site.origin}/auth/preview.html`);
    await page.evaluate("new Promise((resolve) => setTimeout(resolve, 300))");
    const view = await page.evaluate(`(() => {
      const raw = JSON.parse(localStorage.getItem("koreanSite_zhcn_draft_v01") || "{}");
      return {
        text: document.body.innerText,
        html: document.body.innerHTML,
        count: raw.mistakes && raw.mistakes.p01 && raw.mistakes.p01.count,
        title: document.title
      };
    })()`);
    assert.equal(view.count, 2);
    assert.match(view.text, /账号登录/);
    assert.match(view.text, /游客/);
    assert.match(view.text, /不会读取或上传/);
    assert.match(view.text, /自定义发信/);
    assert.match(view.text, /暂未启用/);
    assert.equal(view.text.includes("未接入"), false);
    assert.equal(view.text.includes("000000"), false);
    assert.equal(view.text.includes("演示"), false);
    assert.equal(view.text.includes("Vercel"), false);
    assert.equal(view.text.includes("GitHub Pages"), false);
    assert.equal(view.text.includes("Supabase"), false);
    assert.equal(view.html.includes("sb_secret_"), false);
    assert.equal(view.html.includes("sb_publishable_"), false);
    assert.equal(view.html.includes("service_role"), false);
    await page.shot("auth-login");
  });
});
