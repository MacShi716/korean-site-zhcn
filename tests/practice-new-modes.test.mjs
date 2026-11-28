/**
 * Six new practice modes: picture to word, picture to word (reverse),
 * listen and choose meaning, spelling, text flashcards, and timed match.
 * Uses a throwaway Chrome profile and synthetic answers only.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import test from "node:test";

const ROOT = new URL("..", import.meta.url);
const MANIFEST = JSON.parse(readFileSync(new URL("../data/practice-modes-20261128/image-manifest.json", import.meta.url), "utf8"));
const PACK = JSON.parse(readFileSync(new URL("../data/krdict-graded-300/graded-exercises-pack.json", import.meta.url), "utf8"));
const VOCAB = JSON.parse(readFileSync(new URL("../data/krdict-graded-300/graded-vocab-300.json", import.meta.url), "utf8"));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".vtt": "text/vtt",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
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
  const dir = mkdtempSync(join(tmpdir(), "korean-new-modes-"));
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
            if (document.querySelector("#question-stem, #pack-retry")) resolve(true);
            else if (++ticks > 500) resolve(false);
            else setTimeout(tick, 20);
          };
          tick();
        })`);
      } catch (error) {}
    }
    await evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve('ok')))");
  }
  return {
    evaluate,
    open,
    async setSize(width, height, mobile) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile }, sessionId);
    },
    async close() { browser.close(); chrome.kill(); },
  };
}

async function clickButton(page, label) {
  const status = await page.evaluate(`new Promise((resolve) => {
    const label = ${JSON.stringify(label)};
    function textOf(button) { return button.textContent.replace(/\\s+/g, " ").trim(); }
    function matches(text) {
      return text === label || text.endsWith(label) || text.startsWith(label + " ") || text.startsWith(label + " ·");
    }
    const started = Date.now();
    const tick = () => {
      const roots = [document.querySelector("#panel-practice"), document.querySelector("#panel-daily"), document.querySelector("#main-nav"), document.body].filter(Boolean);
      for (const root of roots) {
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

async function waitFor(page, selector, timeout = 8000) {
  return page.evaluate(`new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (document.querySelector(${JSON.stringify(selector)})) resolve(true);
      else if (Date.now() - started > ${timeout}) resolve(false);
      else setTimeout(tick, 30);
    };
    tick();
  })`);
}

async function openFresh(page, origin) {
  await page.open(`${origin}/index.html`);
  await page.evaluate("localStorage.clear()");
  await page.open(`${origin}/index.html`);
  const ready = await page.evaluate(`new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (window.__draft && window.__draft.packStatus === "ready" && document.querySelector("#question-stem")) resolve(true);
      else if (Date.now() - started > 8000) resolve(false);
      else setTimeout(tick, 40);
    };
    tick();
  })`);
  assert.equal(ready, true, "cold practice question did not open");
}

function currentItemId(page) {
  return page.evaluate("window.__draft.session.order[window.__draft.session.index]");
}

function mistake(page, id) {
  return page.evaluate(`(() => {
    const raw = JSON.parse(localStorage.getItem("koreanSite_zhcn_draft_v01") || "{}");
    return (raw.mistakes || {})[${JSON.stringify(id)}] || null;
  })()`);
}

async function clickCheck(page, selector) {
  const status = await page.evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    if (!button || button.disabled) return "missing";
    button.click();
    return "clicked";
  })()`);
  assert.equal(status, "clicked", `check button missing: ${selector}`);
  await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve('ok')))");
}

test("picture manifest is complete, local, text-free, and licensed", () => {
  assert.equal(MANIFEST.counts.total, 300);
  assert.equal(MANIFEST.counts.picturable, MANIFEST.images.length);
  assert.equal(MANIFEST.counts.skipped, MANIFEST.skipped.length);
  assert.equal(MANIFEST.counts.picturable + MANIFEST.counts.skipped, 300);
  assert.equal(new Set(MANIFEST.images.map((row) => row.id)).size, MANIFEST.images.length);
  assert.equal(new Set(MANIFEST.skipped.map((row) => row.id)).size, MANIFEST.skipped.length);
  assert.equal(MANIFEST.images.some((row) => MANIFEST.skipped.some((skip) => skip.id === row.id)), false);
  const imageIds = new Set(MANIFEST.images.map((row) => row.id));
  for (const grade of ["beginner", "intermediate", "advanced"]) {
    const rows = MANIFEST.images.filter((row) => row.grade === grade);
    assert.equal(rows.length, MANIFEST.counts.byGrade.picturable[grade], grade);
    assert.ok(rows.length >= 4, `${grade} needs at least four pictures for a four-image question`);
  }
  for (const row of MANIFEST.images) {
    assert.match(row.file, /^assets\/practice-images\/openmoji\/[0-9A-F-]+\.svg$/, row.id);
    const file = new URL(`../${row.file}`, import.meta.url);
    assert.equal(existsSync(file), true, row.file);
    const svg = readFileSync(file, "utf8");
    assert.match(svg, /<svg\b/i, row.file);
    assert.equal(/<text\b|<tspan\b/i.test(svg), false, `${row.file} contains visible text`);
    assert.equal(row.distractorIds.length, 3, row.id);
    assert.equal(new Set(row.distractorIds).size, 3, row.id);
    assert.equal(row.distractorIds.includes(row.id), false, row.id);
    for (const id of row.distractorIds) assert.equal(imageIds.has(id), true, `${row.id} distractor ${id}`);
    assert.equal(row.license, "CC-BY-SA-4.0", row.id);
    assert.match(row.sourceUrl, /openmoji/, row.id);
  }
  for (const row of MANIFEST.skipped) {
    assert.ok(row.reasonCode, row.id);
    assert.ok(row.reason && row.reason.length > 20, `${row.headwordKo} needs a reason`);
  }
  for (const word of ["가격", "기분", "문제", "이름", "공부", "교통", "나이", "휴가", "휴일"]) {
    const row = MANIFEST.skipped.find((item) => item.headwordKo === word);
    assert.ok(row, `${word} should be skipped, not illustrated`);
    assert.ok(row.reason.length > 10, word);
  }
  const attribution = readFileSync(new URL("../assets/practice-images/openmoji/ATTRIBUTION.md", import.meta.url), "utf8");
  assert.match(attribution, /OpenMoji/);
  assert.match(attribution, /CC BY-SA 4\.0/);
  const license = readFileSync(new URL("../assets/practice-images/openmoji/LICENSE-CC-BY-SA-4.0.txt", import.meta.url), "utf8");
  assert.match(license, /Attribution-ShareAlike 4\.0 International/);
  const packFile = JSON.parse(readFileSync(new URL("../data/practice-modes-20261128/practice-modes-pack.json", import.meta.url), "utf8"));
  assert.equal(packFile.credits.openmojiLicenseFile, "assets/practice-images/openmoji/LICENSE-CC-BY-SA-4.0.txt");
  assert.equal(packFile.modeConfig.timedMatch.defaultEnabled, false);
});

test("six new practice modes work with real clicks", async (t) => {
  const site = await startSite();
  const page = await launchChrome();
  t.after(async () => {
    await page.close();
    await new Promise((resolve) => site.server.close(resolve));
  });

  await t.test("cold open keeps choice first and shows the new tabs", async () => {
    await page.setSize(390, 844, true);
    await openFresh(page, site.origin);
    const view = await page.evaluate(`(() => ({
      mode: window.__draft.mode,
      stem: document.querySelector("#question-stem").textContent.trim(),
      optionCount: document.querySelectorAll(".choice-opt").length,
      tabs: [...document.querySelectorAll("[data-pmode]")].map((button) => button.getAttribute("data-pmode")),
      check: !!document.getElementById("choice-check"),
      overflow: document.documentElement.scrollWidth <= window.innerWidth
    }))()`);
    assert.equal(view.mode, "choice");
    assert.ok(view.stem.length > 0);
    assert.equal(view.optionCount, 4);
    assert.equal(view.check, true);
    assert.equal(view.overflow, true);
    for (const mode of ["pic-word", "pic-word-reverse", "listen-meaning", "spelling", "flashcard", "match"]) {
      assert.equal(view.tabs.includes(mode), true, `missing tab ${mode}`);
    }
  });

  await t.test("each new mode opens at beginner and grades one answer", async () => {
    await page.setSize(390, 844, true);
    await openFresh(page, site.origin);

    await clickButton(page, "看词选图");
    let id = await currentItemId(page);
    let countText = await page.evaluate("document.querySelector('.practice-countline').innerText");
    assert.match(countText, /55/);
    assert.equal(await page.evaluate(`!!document.querySelector('#pic-word-card img')`), true);
    assert.equal(await page.evaluate(`document.querySelector('#pic-word-card').innerText.includes(${JSON.stringify(VOCAB.items.find((row) => row.id === id).glossZh)})`), false);
    await page.evaluate(`document.querySelector('.pic-opt[data-word-id="${id}"]').click()`);
    await clickCheck(page, "#pic-check");
    assert.match(await page.evaluate("document.querySelector('#pic-result').innerText"), /正确/);

    await clickButton(page, "看图选词");
    id = await currentItemId(page);
    countText = await page.evaluate("document.querySelector('.practice-countline').innerText");
    assert.match(countText, /55/);
    assert.equal(await page.evaluate("!!document.querySelector('#pic-prompt')"), true);
    await page.evaluate(`document.querySelector('.word-opt[data-word-id="${id}"]').click()`);
    await clickCheck(page, "#picrev-check");
    assert.match(await page.evaluate("document.querySelector('#picrev-result').innerText"), /正确/);

    await clickButton(page, "听音选义");
    id = await currentItemId(page);
    countText = await page.evaluate("document.querySelector('.practice-countline').innerText");
    assert.match(countText, /100/);
    const listenBefore = await page.evaluate(`(() => {
      const item = ${JSON.stringify(VOCAB.items.find((row) => row.id === id))};
      const card = document.getElementById("listen-card");
      return {
        hasWord: card.innerText.includes(item.headwordKo),
        hasExample: item.exampleKo ? card.innerText.includes(item.exampleKo) : false,
        options: card.querySelectorAll(".gloss-opt").length,
        audio: !!document.getElementById("listen-play")
      };
    })()`);
    assert.equal(listenBefore.hasWord, false);
    assert.equal(listenBefore.hasExample, false);
    assert.equal(listenBefore.options, 4);
    assert.equal(listenBefore.audio, true);
    await page.evaluate("window.__speakCalls = 0; window.speakKo = function () { window.__speakCalls += 1; }");
    await page.evaluate("document.getElementById('listen-play').click()");
    assert.equal(await page.evaluate("window.__speakCalls"), 1);
    await page.evaluate(`document.querySelector('.gloss-opt[data-word-id="${id}"]').click()`);
    await clickCheck(page, "#listen-check");
    assert.match(await page.evaluate("document.querySelector('#listen-result').innerText"), /正确/);
    await clickButton(page, "下一题");
    const wrongListenId = await currentItemId(page);
    await page.evaluate(`(() => {
      const correct = ${JSON.stringify(wrongListenId)};
      const wrong = [...document.querySelectorAll(".gloss-opt")].find((button) => button.getAttribute("data-word-id") !== correct);
      wrong.click();
    })()`);
    await clickCheck(page, "#listen-check");
    assert.match(await page.evaluate("document.querySelector('#listen-result').innerText"), /不对/);
    assert.equal((await mistake(page, `listenmean:${wrongListenId}`)).count, 1);

    await clickButton(page, "拼写");
    const spellState = await page.evaluate("({ variant: window.__draft.spell.variant, chars: window.__draft.spell.chars, missing: window.__draft.spell.missingIndex, id: window.__draft.spell.id })");
    assert.equal(spellState.variant, "fill");
    assert.ok(spellState.chars.length >= 2);
    await page.evaluate(`(() => {
      const state = window.__draft.spell;
      const input = document.getElementById("spell-input");
      input.value = state.chars[state.missingIndex];
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await clickCheck(page, "#spell-check");
    assert.match(await page.evaluate("document.querySelector('#spell-result').innerText"), /正确/);

    await clickButton(page, "文字闪卡");
    id = await currentItemId(page);
    const word = VOCAB.items.find((row) => row.id === id).headwordKo;
    countText = await page.evaluate("document.querySelector('.practice-countline').innerText");
    assert.match(countText, /100/);
    await page.evaluate(`(() => {
      const input = document.getElementById("flash-input");
      input.value = ${JSON.stringify("not-the-word")};
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await clickCheck(page, "#flash-check");
    assert.match(await page.evaluate("document.querySelector('#flash-result').innerText"), /不对|错误/);

    await clickButton(page, "选项连线");
    id = await currentItemId(page);
    const matchItem = PACK.match.find((row) => row.id === id);
    assert.ok(matchItem);
    assert.equal(await page.evaluate("!!document.getElementById('match-timed-toggle')"), true);
    assert.equal(await page.evaluate("!!document.getElementById('match-timer')"), false);
    await page.evaluate(`(() => {
      const pairs = ${JSON.stringify(matchItem.answerPairs.map((pair) => ({ l: pair.leftId, r: pair.rightId })))};
      for (const pair of pairs) {
        document.querySelector('.match-item[data-side="l"][data-id="' + pair.l + '"]').click();
        document.querySelector('.match-item[data-side="r"][data-id="' + pair.r + '"]').click();
      }
    })()`);
    await clickCheck(page, "#match-check");
    assert.match(await page.evaluate("document.querySelector('#match-result').innerText"), /正确/);
  });

  await t.test("wrong picture, reverse and spelling answers enter daily review with the same prompt", async () => {
    await page.setSize(390, 844, true);

    await openFresh(page, site.origin);
    await clickButton(page, "看词选图");
    const picId = await currentItemId(page);
    await page.evaluate(`(() => {
      const correct = ${JSON.stringify(picId)};
      const wrong = [...document.querySelectorAll(".pic-opt")].find((button) => button.getAttribute("data-word-id") !== correct);
      wrong.click();
    })()`);
    await clickCheck(page, "#pic-check");
    assert.match(await page.evaluate("document.querySelector('#pic-result').innerText"), /不对/);
    assert.equal((await mistake(page, `picword:${picId}`)).count, 1);
    await clickNav(page, "每日复习");
    await waitFor(page, "#daily-start");
    await clickButton(page, "开始今日复习");
    const picReview = await page.evaluate(`new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const card = document.getElementById("pic-word-card");
        if (card) resolve({ id: card.getAttribute("data-pic-word-id"), stem: document.getElementById("question-stem").textContent.trim() });
        else if (Date.now() - started > 8000) resolve(null);
        else setTimeout(tick, 40);
      };
      tick();
    })`);
    assert.ok(picReview);
    assert.equal(picReview.id, picId);
    assert.equal(picReview.stem, VOCAB.items.find((row) => row.id === picId).headwordKo);
    assert.ok(await page.evaluate("document.querySelector('.practice-credit').innerText.includes('OpenMoji')"));

    await openFresh(page, site.origin);
    await clickButton(page, "看图选词");
    const revId = await currentItemId(page);
    await page.evaluate(`(() => {
      const correct = ${JSON.stringify(revId)};
      const wrong = [...document.querySelectorAll(".word-opt")].find((button) => button.getAttribute("data-word-id") !== correct);
      wrong.click();
    })()`);
    await clickCheck(page, "#picrev-check");
    assert.match(await page.evaluate("document.querySelector('#picrev-result').innerText"), /不对/);
    assert.equal((await mistake(page, `picwordrev:${revId}`)).count, 1);
    await clickNav(page, "每日复习");
    await waitFor(page, "#daily-start");
    await clickButton(page, "开始今日复习");
    const revReview = await page.evaluate(`new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const card = document.getElementById("pic-reverse-card");
        if (card) resolve({ id: card.getAttribute("data-pic-word-id"), prompt: card.querySelector("#pic-prompt") && card.querySelector("#pic-prompt").getAttribute("src") });
        else if (Date.now() - started > 8000) resolve(null);
        else setTimeout(tick, 40);
      };
      tick();
    })`);
    assert.ok(revReview);
    assert.equal(revReview.id, revId);
    assert.match(revReview.prompt, /assets\/practice-images\/openmoji\/.*\.svg/);

    await openFresh(page, site.origin);
    await clickButton(page, "拼写");
    const spell = await page.evaluate("({ id: window.__draft.spell.id, token: window.__draft.spell.token, chars: window.__draft.spell.chars, missing: window.__draft.spell.missingIndex })");
    await page.evaluate(`(() => {
      const input = document.getElementById("spell-input");
      input.value = "wrong";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await clickCheck(page, "#spell-check");
    assert.match(await page.evaluate("document.querySelector('#spell-result').innerText"), /不对/);
    assert.equal((await mistake(page, `spell:${spell.token}`)).count, 1);
    await clickNav(page, "每日复习");
    await waitFor(page, "#daily-start");
    await clickButton(page, "开始今日复习");
    const spellReview = await page.evaluate(`new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const card = document.getElementById("spell-card");
        if (card) resolve({ id: card.getAttribute("data-spell-id"), variant: card.getAttribute("data-spell-variant"), prompt: card.innerText });
        else if (Date.now() - started > 8000) resolve(null);
        else setTimeout(tick, 40);
      };
      tick();
    })`);
    assert.ok(spellReview);
    assert.equal(spellReview.id, spell.id);
    assert.equal(spellReview.variant, "fill");
    assert.match(spellReview.prompt, /拼写/);
  });

  await t.test("spelling serves fill, assemble, and full variants and grades them", async () => {
    await page.setSize(390, 844, true);
    await openFresh(page, site.origin);
    await clickButton(page, "拼写");
    assert.equal(await page.evaluate("window.__draft.spell.variant"), "fill");
    await page.evaluate(`(() => {
      const state = window.__draft.spell;
      const input = document.getElementById("spell-input");
      input.value = state.chars[state.missingIndex];
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await clickCheck(page, "#spell-check");
    assert.match(await page.evaluate("document.querySelector('#spell-result').innerText"), /正确/);
    await clickButton(page, "下一题");
    assert.equal(await page.evaluate("window.__draft.spell.variant"), "assemble");
    await page.evaluate(`(() => {
      const chars = window.__draft.spell.chars.slice();
      for (const ch of chars) {
        const button = [...document.querySelectorAll("[data-spell-tile]")].find((node) => node.textContent === ch);
        button.click();
      }
    })()`);
    await clickCheck(page, "#spell-check");
    assert.match(await page.evaluate("document.querySelector('#spell-result').innerText"), /正确/);
    await clickButton(page, "下一题");
    assert.equal(await page.evaluate("window.__draft.spell.variant"), "full");
    await page.evaluate(`(() => {
      const input = document.getElementById("spell-input");
      input.value = window.__draft.spell.chars.join("");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await clickCheck(page, "#spell-check");
    assert.match(await page.evaluate("document.querySelector('#spell-result').innerText"), /正确/);
  });

  await t.test("flashcard requeues a wrong card later in the same session", async () => {
    await page.setSize(390, 844, true);
    await openFresh(page, site.origin);
    await clickButton(page, "文字闪卡");
    const firstId = await currentItemId(page);
    await page.evaluate(`(() => {
      const input = document.getElementById("flash-input");
      input.value = "wrong";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await clickCheck(page, "#flash-check");
    assert.match(await page.evaluate("document.querySelector('#flash-result').innerText"), /不对/);
    const queued = await page.evaluate("({ total: window.__draft.session.total, last: window.__draft.session.order[window.__draft.session.order.length - 1] })");
    assert.equal(queued.total, 101);
    assert.equal(queued.last, firstId);
    await clickButton(page, "下一题");
    const secondId = await currentItemId(page);
    assert.notEqual(secondId, firstId);
    await page.evaluate(`(() => {
      const input = document.getElementById("flash-input");
      input.value = "wrong";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await clickCheck(page, "#flash-check");
    await clickButton(page, "下一题");
    await clickNav(page, "每日复习");
    await waitFor(page, "#daily-start");
    await clickButton(page, "开始今日复习");
    const reviewMode = await page.evaluate("window.__draft.mode");
    assert.equal(reviewMode, "flashcard");
    const reviewOrder = await page.evaluate("window.__draft.session.order.slice()");
    assert.equal(reviewOrder.length, 2);
    const reviewFirst = reviewOrder[0];
    await page.evaluate(`(() => {
      const input = document.getElementById("flash-input");
      input.value = "wrong";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await clickCheck(page, "#flash-check");
    await clickButton(page, "下一题");
    const reviewSecond = await page.evaluate("window.__draft.session.order[window.__draft.session.index]");
    assert.notEqual(reviewSecond, reviewFirst);
    await page.evaluate(`(() => {
      const input = document.getElementById("flash-input");
      input.value = ${JSON.stringify(VOCAB.items.find((row) => row.id === reviewSecond).headwordKo)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await clickCheck(page, "#flash-check");
    await clickButton(page, "下一题");
    const again = await page.evaluate("window.__draft.session.order[window.__draft.session.index]");
    assert.equal(again, reviewFirst);
  });

  await t.test("timed match shows a timer and marks unfinished pairs wrong, while untimed stays default", async () => {
    await page.setSize(390, 844, true);
    await openFresh(page, site.origin);
    await clickButton(page, "选项连线");
    const firstId = await currentItemId(page);
    const firstItem = PACK.match.find((row) => row.id === firstId);
    assert.equal(await page.evaluate("!!document.getElementById('match-timer')"), false);
    await page.evaluate(`(() => {
      const pairs = ${JSON.stringify(firstItem.answerPairs.map((pair) => ({ l: pair.leftId, r: pair.rightId })))};
      for (const pair of pairs) {
        document.querySelector('.match-item[data-side="l"][data-id="' + pair.l + '"]').click();
        document.querySelector('.match-item[data-side="r"][data-id="' + pair.r + '"]').click();
      }
    })()`);
    await clickCheck(page, "#match-check");
    assert.match(await page.evaluate("document.querySelector('#match-result').innerText"), /正确/);
    await clickButton(page, "下一题");
    await page.evaluate("window.__draft.setTimedMatchSeconds(1)");
    await clickButton(page, "限时连线");
    const timed = await page.evaluate(`(() => ({
      timed: window.__draft.matchTimed,
      timer: !!document.getElementById("match-timer"),
      text: document.getElementById("match-timer") ? document.getElementById("match-timer").textContent : ""
    }))()`);
    assert.equal(timed.timed, true);
    assert.equal(timed.timer, true);
    assert.match(timed.text, /剩余时间/);
    const timedId = await currentItemId(page);
    await page.evaluate("new Promise((resolve) => setTimeout(resolve, 2400))");
    const expired = await page.evaluate(`(() => ({
      out: window.__draft.matchClock.timedOut,
      result: document.querySelector("#match-result").innerText,
      unfinished: document.querySelectorAll(".match-timeout").length
    }))()`);
    assert.equal(expired.out, true);
    assert.match(expired.result, /时间到/);
    assert.ok(expired.unfinished > 0);
    assert.equal((await mistake(page, `match:${timedId}`)).count, 1);
  });

  await t.test("intermediate text and advanced picture modes also start with honest counts", async () => {
    await page.setSize(390, 844, true);
    await openFresh(page, site.origin);
    await clickButton(page, "词典中级");
    await clickButton(page, "听音选义");
    assert.equal(await page.evaluate("document.querySelectorAll('.gloss-opt').length"), 4);
    assert.match(await page.evaluate("document.querySelector('.practice-countline').innerText"), /100/);
    await clickButton(page, "词典高级");
    await clickButton(page, "看图选词");
    assert.equal(await page.evaluate("!!document.querySelector('#pic-prompt')"), true);
    const advancedCount = await page.evaluate("document.querySelector('.practice-countline').innerText");
    assert.match(advancedCount, /6/);
    const grade = await page.evaluate("window.__draft.session.level");
    assert.equal(grade, "advanced");
  });

  await t.test("new modes do not create page-level horizontal overflow", async () => {
    await page.setSize(375, 667, true);
    await openFresh(page, site.origin);
    for (const mode of ["看词选图", "看图选词", "听音选义", "拼写", "文字闪卡", "选项连线"]) {
      await clickButton(page, mode);
      const scroll = await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth");
      assert.equal(scroll, true, mode);
    }
  });
});
