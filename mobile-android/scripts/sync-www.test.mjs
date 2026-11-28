import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { ensureViewportCover, shouldSkip, syncWww, ROOT_FILES, CONTENT_DIRS } from "./sync-www.mjs";

test("skip rules drop tests, VCS, and the android project itself", () => {
  assert.equal(shouldSkip("tests/first-screen.test.mjs"), true);
  assert.equal(shouldSkip("auth/tests/auth-service.test.js"), true);
  assert.equal(shouldSkip(".github/workflows/build-android-apk.yml"), true);
  assert.equal(shouldSkip("mobile-android/package.json"), true);
  assert.equal(shouldSkip(".git/config"), true);
  assert.equal(shouldSkip("auth/preview.html"), false);
  assert.equal(shouldSkip("data/hangil-reading-55/hangil-text-mcq.json"), false);
  assert.equal(shouldSkip("voices/supertonic/models/tts.json"), false);
});

test("sync copies the runtime site and leaves tests behind", async () => {
  const repo = mkdtempSync(path.join(tmpdir(), "korean-site-"));
  const www = mkdtempSync(path.join(tmpdir(), "korean-www-"));
  for (const file of ROOT_FILES) {
    writeFileSync(path.join(repo, file), file === "index.html" ? "<html><head></head><body></body></html>" : "x");
  }
  writeFileSync(path.join(repo, "index.html"), "<html><head><title>x</title></head><body></body></html>");
  mkdirSync(path.join(repo, "tests"), { recursive: true });
  writeFileSync(path.join(repo, "tests", "first-screen.test.mjs"), "nope");
  mkdirSync(path.join(repo, ".github", "workflows"), { recursive: true });
  writeFileSync(path.join(repo, ".github", "workflows", "build-android-apk.yml"), "nope");
  mkdirSync(path.join(repo, "mobile-android"), { recursive: true });
  writeFileSync(path.join(repo, "mobile-android", "package.json"), "{}");
  for (const dir of CONTENT_DIRS) {
    mkdirSync(path.join(repo, dir, "nested"), { recursive: true });
    writeFileSync(path.join(repo, dir, "nested", "pack.json"), '{"ok":true}');
  }
  mkdirSync(path.join(repo, "auth", "tests"), { recursive: true });
  writeFileSync(path.join(repo, "auth", "tests", "auth-service.test.js"), "nope");
  writeFileSync(path.join(repo, "auth", "preview.html"), "<html><head></head><body>preview</body></html>");
  writeFileSync(path.join(repo, "auth", "recovery.html"), "<html><head></head><body>recovery</body></html>");
  mkdirSync(path.join(repo, "data", "hangil-reading-55"), { recursive: true });
  writeFileSync(path.join(repo, "data", "hangil-reading-55", "hangil-text-mcq.json"), "{\"items\":[]}");
  mkdirSync(path.join(repo, "data", "practice-modes-20261128"), { recursive: true });
  writeFileSync(path.join(repo, "data", "practice-modes-20261128", "image-manifest.json"), "{\"images\":[]}");
  writeFileSync(path.join(repo, "data", "practice-modes-20261128", "practice-modes-pack.json"), "{}");
  mkdirSync(path.join(repo, "assets", "practice-images", "openmoji"), { recursive: true });
  writeFileSync(path.join(repo, "assets", "practice-images", "openmoji", "ATTRIBUTION.md"), "OpenMoji");
  writeFileSync(path.join(repo, "assets", "practice-images", "openmoji", "1F392.svg"), "<svg></svg>");
  mkdirSync(path.join(repo, "dict"), { recursive: true });
  writeFileSync(path.join(repo, "dict", "index.json"), "{}");
  mkdirSync(path.join(repo, "voices", "supertonic"), { recursive: true });
  writeFileSync(path.join(repo, "voices", "supertonic", "manifest.json"), "{}");
  writeFileSync(path.join(repo, "voices", "supertonic", "supertonic-worker.js"), "postMessage(0)");

  const result = await syncWww({ repoRoot: repo, wwwRoot: www });
  assert.ok(result.copied > ROOT_FILES.length);
  assert.match(readFileSync(path.join(www, "index.html"), "utf8"), /android-shell\.js/);
  assert.match(readFileSync(path.join(www, "index.html"), "utf8"), /viewport-fit=cover/);
  const preview = readFileSync(path.join(www, "auth", "preview.html"), "utf8");
  assert.match(preview, /android-shell\.js/);
  assert.match(preview, /viewport-fit=cover/);
  assert.equal(
    ensureViewportCover('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'),
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  );
  assert.equal(existsSync(path.join(www, "tests")), false);
  assert.equal(existsSync(path.join(www, "auth", "tests")), false);
  assert.equal(existsSync(path.join(www, ".github")), false);
  assert.equal(existsSync(path.join(www, "mobile-android")), false);
  assert.equal(readFileSync(path.join(www, "theme.css"), "utf8"), "x");
  assert.equal(readFileSync(path.join(www, "golden-ratio.css"), "utf8"), "x");
  assert.ok(readFileSync(path.join(www, "data/hangil-reading-55/hangil-text-mcq.json"), "utf8").length > 0);
  assert.ok(readFileSync(path.join(www, "data/practice-modes-20261128/image-manifest.json"), "utf8").length > 0);
  assert.equal(readFileSync(path.join(www, "assets/practice-images/openmoji/1F392.svg"), "utf8"), "<svg></svg>");
});
