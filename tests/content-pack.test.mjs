/**
 * Content pack integration. Uses a throwaway browser profile and synthetic answers only.
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
const FILES = {
  "data/krdict-graded-300/graded-vocab-300.json": "e264ff4f301a45d951d0a72948212cb1906a308480f55e6ee10aeda1d9e9fc30",
  "data/krdict-graded-300/graded-exercises-pack.json": "e6899aa04d791bffd5e754d0c6bfff7776a8df28fbd091eb177e01c6d605160d",
  "data/krdict-graded-300/ATTRIBUTION-CC-BY-SA-2.0-KR.json": "5dd6d5c340b027f02ed94eaf0b32e9cd6f7ef68f9a8b6b990eb6f596e6bcbb6c",
  "data/videos/nmk-18863/nmk-18863-verified-cues.json": "09306e1e9897f02750477924fd4ba3323184c69e640104882ccdb6e74521dce6",
  "data/videos/nmk-18863/nmk-18863.ko.vtt": "3bc9c42c80cf1507b9e44e479863a3f8560e5ba8c737ff942d3eb4138401ab4f",
  "data/videos/nmk-18863/nmk-18863.zh.vtt": "89a0273df935ae0bc4befb2c2435ef56b2926a6efacb572e8f746118569c50ae",
  "data/videos/nmk-18863/nmk-18863.en.vtt": "58acd166af0e1e8c210a507c48307e2bb5bcf29741066d0ace18856fa0229cb4",
};
const PACK = JSON.parse(readFileSync(new URL("../data/krdict-graded-300/graded-exercises-pack.json", import.meta.url), "utf8"));
const VOCAB = JSON.parse(readFileSync(new URL("../data/krdict-graded-300/graded-vocab-300.json", import.meta.url), "utf8"));

test("the seven content files keep the supplied SHA256", () => {
  for (const [rel, expected] of Object.entries(FILES)) {
    const body = readFileSync(new URL("../" + rel, import.meta.url));
    const actual = createHash("sha256").update(body).digest("hex");
    assert.equal(actual, expected, rel);
  }
  for (const grade of ["beginner", "intermediate", "advanced"]) {
    assert.equal(VOCAB.items.filter((item) => item.grade === grade).length, 100, grade);
    assert.equal(VOCAB.items.filter((item) => item.grade === grade && item.topikVerified === true).length, 0, grade);
  }
  assert.equal(PACK.integrationContract.neverMapToTopik, true);
  assert.equal(PACK.audioAssetsIncluded, false);
});

function startSite() {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".vtt": "text/vtt", ".png": "image/png", ".ico": "image/x-icon" };
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let path = decodeURIComponent(url.pathname);
    if (path === "/korean-site-zhcn" || path === "/korean-site-zhcn/") path = "/index.html";
    else if (path.startsWith("/korean-site-zhcn/")) path = path.slice("/korean-site-zhcn".length);
    if (path === "/") path = "/index.html";
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
    server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function launchChrome() {
  const dir = mkdtempSync(join(tmpdir(), "korean-content-"));
  const chrome = spawn("google-chrome", ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
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
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  return {
    evaluate,
    async open(url) {
      await send("Page.navigate", { url }, sessionId);
      await evaluate("document.readyState");
      await evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve('ok')))");
    },
    async shot(name) {
      mkdirSync("/opt/cursor/artifacts/content-pack", { recursive: true });
      const { data } = await send("Page.captureScreenshot", { format: "png" }, sessionId);
      writeFileSync(join("/opt/cursor/artifacts/content-pack", `${name}.png`), Buffer.from(data, "base64"));
    },
    async close() { browser.close(); chrome.kill(); },
  };
}

async function clickButton(page, label) {
  const status = await page.evaluate(`(() => {
    const label = ${JSON.stringify(label)};
    const found = [...document.querySelectorAll("#panel-practice button, #main-nav button, #panel-daily button, #panel-video button, .site-foot button, #auth-top-btn")].find((button) => {
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

async function fresh(page, origin) {
  await page.open(`${origin}/index.html`);
  await page.evaluate("localStorage.clear()");
  await page.open(`${origin}/index.html`);
  const ready = await page.evaluate(`new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const button = document.querySelector("[data-grade='beginner']");
      if (button && button.textContent.includes("100")) resolve(true);
      else if (Date.now() - start > 8000) resolve(false);
      else setTimeout(tick, 40);
    };
    tick();
  })`);
  assert.equal(ready, true, "graded pack did not load");
}

function firstOf(type, grade) {
  return PACK[type].find((item) => item.grade === grade);
}

test("graded practice, video, and real sign-in entry", async (t) => {
  const site = await startSite();
  const page = await launchChrome();
  t.after(async () => { await page.close(); await new Promise((resolve) => site.server.close(resolve)); });

  await t.test("first screen is practice, beginner 100, and start is enabled", async () => {
    await fresh(page, site.origin);
    const view = await page.evaluate(`(() => {
      const start = document.getElementById("session-start");
      const beginner = document.querySelector("[data-grade='beginner']");
      return {
        active: document.querySelector(".panel.active").id,
        gateHidden: document.getElementById("auth-gate").hidden,
        locked: document.body.classList.contains("auth-locked"),
        startDisabled: start.disabled,
        beginner: beginner.textContent.trim(),
        beginnerOn: beginner.classList.contains("active"),
        grades: [...document.querySelectorAll("[data-grade]")].map((button) => button.textContent.trim()),
        topik: [...document.querySelectorAll("[data-level]")].filter((button) => button.getAttribute("data-level") !== "ungraded").map((button) => button.textContent.trim()),
        text: document.body.innerText
      };
    })()`);
    assert.equal(view.active, "panel-practice");
    assert.equal(view.gateHidden, true);
    assert.equal(view.locked, false);
    assert.equal(view.startDisabled, false);
    assert.equal(view.beginnerOn, true);
    assert.deepEqual(view.grades, ["词典初级 · 100", "词典中级 · 100", "词典高级 · 100"]);
    assert.deepEqual(view.topik, ["TOPIK 1 · 0", "TOPIK 2 · 0", "TOPIK 3 · 0", "TOPIK 4 · 0", "TOPIK 5 · 0", "TOPIK 6 · 0"]);
    assert.match(view.text, /TOPIK 1–6 官方核定：0（待官方授权词表）/);
    assert.match(view.text, /국립국어원/);
    assert.match(view.text, /CC BY-SA 2.0 KR/);
    assert.equal(view.text.includes("真实登录尚未接通"), false);
    assert.equal(view.text.includes("视频未上线"), false);
    await page.shot("practice-beginner");
  });

  await t.test("each dictionary grade keeps 100 words and does not invent a TOPIK count", async () => {
    await fresh(page, site.origin);
    for (const [label, mode, count] of [["词义选择", "choice", "100"], ["选词拼句", "tiles", "30"], ["选项连线", "match", "15"], ["听写", "dictation", "100"]]) {
      await clickButton(page, label);
      const line = await page.evaluate(`[...document.querySelectorAll("#panel-practice p")].map((p) => p.textContent.trim())`);
      assert.equal(line.includes(`本档本题: ${count}`), true, label);
      assert.equal(line.some((item) => item.startsWith("已核实题目: ") && item !== "已核实题目: 0" && !item.startsWith("已核实题目: 0")), false, label);
    }
    await clickButton(page, "词典中级 · 100");
    await clickButton(page, "词典高级 · 100");
    const grades = await page.evaluate(`[...document.querySelectorAll("[data-grade]")].map((button) => button.textContent.trim())`);
    assert.deepEqual(grades, ["词典初级 · 100", "词典中级 · 100", "词典高级 · 100"]);
  });

  await t.test("a wrong meaning choice is saved and reviews the same prompt", async () => {
    const item = firstOf("choice", "beginner");
    const wrong = item.options.find((option) => option.id !== item.answerOptionId);
    await fresh(page, site.origin);
    await clickButton(page, "词义选择");
    await clickButton(page, "开始");
    const before = await page.evaluate("document.querySelector('#panel-practice').innerText");
    assert.equal(before.includes(item.targetKo), true);
    assert.equal(before.includes(item.explanationKo), false);
    assert.equal(before.includes("answerOptionId"), false);
    await clickButton(page, wrong.textZh);
    await clickButton(page, "检查");
    const saved = await page.evaluate(`(() => {
      const raw = JSON.parse(localStorage.getItem("koreanSite_zhcn_draft_v01") || "{}");
      return { mistakes: raw.mistakes || {}, reviewQueue: raw.reviewQueue || [], text: document.body.innerText };
    })()`);
    const id = Object.keys(saved.mistakes)[0];
    assert.equal(id, "choice:" + item.id);
    assert.equal(saved.mistakes[id].count, 1);
    assert.equal(saved.reviewQueue[0].id, id);
    assert.match(saved.text, /不对/);
    await page.evaluate("document.getElementById('choice-check') && document.getElementById('choice-check').click()");
    assert.equal((await page.evaluate(`JSON.parse(localStorage.getItem('koreanSite_zhcn_draft_v01')).mistakes[${JSON.stringify(id)}].count`)), 1);
    await page.open(`${site.origin}/index.html`);
    await clickButton(page, "每日复习");
    await clickButton(page, "开始今日复习");
    const review = await page.evaluate("document.querySelector('#panel-practice').innerText");
    assert.equal(review.includes(item.targetKo), true);
    assert.equal(review.includes(wrong.textZh), true);
    assert.match(review, /词义选择/);
  });

  await t.test("a wrong graded sentence returns to the same tiles", async () => {
    const item = firstOf("tile", "beginner");
    await fresh(page, site.origin);
    await clickButton(page, "选词拼句");
    await clickButton(page, "开始");
    const before = await page.evaluate("document.querySelector('#panel-practice').innerText");
    assert.equal(before.includes(item.meaningHintZh), true);
    assert.equal(before.includes(item.answerSentenceKo), false);
    await page.evaluate("document.querySelector('.tile').click()");
    await clickButton(page, "检查");
    const saved = await page.evaluate(`(() => {
      const raw = JSON.parse(localStorage.getItem("koreanSite_zhcn_draft_v01"));
      return { id: Object.keys(raw.mistakes)[0], count: raw.mistakes[Object.keys(raw.mistakes)[0]].count, due: raw.reviewQueue[0].id };
    })()`);
    assert.equal(saved.id, "tile:" + item.id);
    assert.equal(saved.count, 1);
    assert.equal(saved.due, saved.id);
    await page.open(`${site.origin}/index.html`);
    await clickButton(page, "每日复习");
    const sawHint = await page.evaluate(`new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (document.body.innerText.includes(${JSON.stringify(item.meaningHintZh)})) resolve(true);
        else if (Date.now() - start > 8000) resolve(false);
        else setTimeout(tick, 40);
      };
      tick();
    })`);
    assert.equal(sawHint, true);
    await clickButton(page, "开始今日复习");
    const tiles = await page.evaluate(`[...document.querySelectorAll(".tile")].map((button) => button.textContent.trim()).sort()`);
    assert.deepEqual(tiles, item.tiles.map((tile) => tile.text).sort());
    assert.equal((await page.evaluate("document.querySelector('#panel-practice').innerText")).includes(item.answerSentenceKo), false);
  });

  await t.test("a wrong graded link board reviews the same four pairs", async () => {
    const item = firstOf("match", "beginner");
    const rights = item.answerPairs.map((pair) => pair.rightId);
    const wrong = item.answerPairs.map((pair, index) => [pair.leftId, rights[(index + 1) % rights.length]]);
    await fresh(page, site.origin);
    await clickButton(page, "选项连线");
    await clickButton(page, "开始");
    const visible = await page.evaluate("document.querySelector('#panel-practice').innerText");
    assert.equal(visible.includes("answerPairs"), false);
    for (const [leftId, rightId] of wrong) {
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
    const saved = await page.evaluate(`(() => {
      const raw = JSON.parse(localStorage.getItem("koreanSite_zhcn_draft_v01"));
      return { id: Object.keys(raw.mistakes)[0], count: raw.mistakes[Object.keys(raw.mistakes)[0]].count };
    })()`);
    assert.equal(saved.id, "match:" + item.id);
    assert.equal(saved.count, 1);
    await page.open(`${site.origin}/index.html`);
    await clickButton(page, "每日复习");
    await clickButton(page, "开始今日复习");
    const texts = await page.evaluate(`[...document.querySelectorAll(".match-item")].map((button) => button.textContent.trim()).sort()`);
    const expected = item.left.map((side) => side.textKo).concat(item.right.map((side) => side.textZh)).sort();
    assert.deepEqual(texts, expected);
  });

  await t.test("a wrong graded dictation stays hidden and reviews the same hint", async () => {
    const item = firstOf("dictation", "beginner");
    await fresh(page, site.origin);
    await clickButton(page, "听写");
    await clickButton(page, "开始");
    const before = await page.evaluate("document.querySelector('#dictation-mount').innerText");
    assert.equal(before.includes(item.meaningHintZh), true);
    assert.equal(before.includes(item.answerKo), false);
    assert.equal(before.includes(item.speechTextKo), false);
    await page.evaluate(`(() => {
      const input = document.getElementById("d-input");
      input.value = "가나다QA오답";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await clickButton(page, "检查");
    const saved = await page.evaluate(`(() => {
      const raw = JSON.parse(localStorage.getItem("koreanSite_zhcn_draft_v01"));
      return { id: Object.keys(raw.mistakes)[0], count: raw.mistakes[Object.keys(raw.mistakes)[0]].count, text: document.querySelector("#dictation-mount").innerText };
    })()`);
    assert.equal(saved.id, "dict:" + item.id);
    assert.equal(saved.count, 1);
    assert.equal(saved.text.includes(item.answerKo), false);
    await page.open(`${site.origin}/index.html`);
    await clickButton(page, "每日复习");
    await clickButton(page, "开始今日复习");
    const review = await page.evaluate("document.querySelector('#dictation-mount').innerText");
    assert.equal(review.includes(item.meaningHintZh), true);
    assert.equal(review.includes(item.answerKo), false);
  });

  await t.test("grammar stays on its own bank and still reviews the same prompt", async () => {
    await fresh(page, site.origin);
    await clickButton(page, "语法");
    await clickButton(page, "开始");
    const prompt = await page.evaluate("document.querySelector('#gex-choices').previousElementSibling.textContent.trim()");
    const picked = await page.evaluate(`(() => {
      const current = window.__draft.grammar;
      const correct = current.ids[current.index];
      const choice = [...document.querySelectorAll("#gex-choices .choice")].find((button) => button.getAttribute("data-gid") !== correct);
      choice.click();
      return "clicked";
    })()`);
    assert.equal(picked, "clicked");
    await clickButton(page, "检查");
    const id = await page.evaluate(`Object.keys(JSON.parse(localStorage.getItem("koreanSite_zhcn_draft_v01")).mistakes)[0]`);
    assert.match(id, /^grammar:/);
    await page.open(`${site.origin}/index.html`);
    await clickButton(page, "每日复习");
    await clickButton(page, "开始今日复习");
    const reviewed = await page.evaluate("document.querySelector('#gex-choices').previousElementSibling.textContent.trim()");
    assert.equal(reviewed, prompt);
  });

  await t.test("video loads 25 cues, toggles languages, seeks, and degrades offline", async () => {
    await fresh(page, site.origin);
    const opened = await page.evaluate(`(() => {
      const button = [...document.querySelectorAll("#main-nav button")].find((item) => item.textContent.replace(/\\s+/g, "").endsWith("视频学习"));
      if (!button) return "missing";
      button.click();
      return "clicked";
    })()`);
    assert.equal(opened, "clicked");
    const ready = await page.evaluate(`new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (document.querySelectorAll(".cue-row").length === 25) resolve(true);
        else if (Date.now() - start > 8000) resolve(false);
        else setTimeout(tick, 40);
      };
      tick();
    })`);
    assert.equal(ready, true);
    const info = await page.evaluate(`(() => {
      const video = document.getElementById("study-video");
      return {
        src: video.getAttribute("src"),
        crossorigin: video.getAttribute("crossorigin"),
        tracks: [...video.querySelectorAll("track")].map((track) => track.getAttribute("src")),
        text: document.querySelector("#panel-video").innerText
      };
    })()`);
    assert.equal(info.src, "https://www.museum.go.kr/file/stream/31888");
    assert.equal(info.crossorigin, null);
    assert.equal(info.tracks.length, 3);
    assert.equal(info.tracks.every((src) => src.includes("/data/videos/nmk-18863/nmk-18863.")), true);
    assert.match(info.text, /3:22/);
    assert.match(info.text, /文化·进阶辅助（非TOPIK官方核定）/);
    assert.match(info.text, /국립중앙박물관/);
    assert.match(info.text, /KOGL1/);
    const hidden = await page.evaluate(`(() => {
      const box = document.getElementById("cap-zh");
      box.click();
      const nodes = [...document.querySelectorAll("#cue-list [data-lang='zh'], #cue-now [data-lang='zh']")];
      return nodes.length > 0 && nodes.every((node) => node.classList.contains("lang-off"));
    })()`);
    assert.equal(hidden, true);
    const seek = await page.evaluate(`(() => {
      document.querySelector(".cue-row").click();
      return document.getElementById("study-video").currentTime;
    })()`);
    assert.equal(seek, 6);
    await page.evaluate("document.querySelector('[data-rate=\"1.25\"]').click()");
    assert.equal(await page.evaluate("document.getElementById('study-video').playbackRate"), 1.25);
    await page.evaluate("document.getElementById('study-video').dispatchEvent(new Event('error'))");
    const after = await page.evaluate("document.querySelector('#panel-video').innerText");
    assert.match(after, /25 句三语对照和韩语朗读仍可以学习/);
    assert.equal(await page.evaluate("document.querySelectorAll('.cue-row').length"), 25);
    assert.equal(await page.evaluate("document.querySelectorAll('.cue-read').length"), 25);
    await page.shot("video-fallback");
  });

  await t.test("the account button opens the PKCE page and leaves local study data alone", async () => {
    await fresh(page, site.origin);
    await page.evaluate(`localStorage.setItem("koreanSite_zhcn_draft_v01", JSON.stringify({ uiLang: "zh", mistakes: { p01: { count: 2 } }, reviewQueue: [], version: 1 }))`);
    await page.evaluate("document.getElementById('auth-top-btn').click()");
    const landed = await page.evaluate(`new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (location.pathname.endsWith("/auth/preview.html")) resolve(location.pathname);
        else if (Date.now() - start > 4000) resolve(location.pathname);
        else setTimeout(tick, 40);
      };
      tick();
    })`);
    assert.equal(landed.endsWith("/auth/preview.html"), true);
    const kept = await page.evaluate(`JSON.parse(localStorage.getItem("koreanSite_zhcn_draft_v01")).mistakes.p01.count`);
    assert.equal(kept, 2);
  });

  await t.test("a Pages-style subpath still loads the graded pack", async () => {
    await page.open(`${site.origin}/korean-site-zhcn/index.html`);
    const ready = await page.evaluate(`new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const button = document.querySelector("[data-grade='beginner']");
        if (button && button.textContent.includes("100")) resolve(location.pathname);
        else if (Date.now() - start > 8000) resolve("");
        else setTimeout(tick, 40);
      };
      tick();
    })`);
    assert.equal(ready, "/korean-site-zhcn/index.html");
  });
});
