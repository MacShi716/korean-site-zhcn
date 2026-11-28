/**
 * Check a built debug APK: signature schemes, identity, and bundled site files.
 *
 * Usage: node scripts/verify-apk.mjs path/to/app.apk
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const apk = process.argv[2];
if (!apk) {
  console.error("usage: node scripts/verify-apk.mjs <apk>");
  process.exit(2);
}

function sdkHomes() {
  return [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(process.env.HOME || "", "android-sdk"),
    "/usr/local/lib/android/sdk",
    "/usr/lib/android-sdk",
    "/opt/android-sdk",
  ].filter(Boolean);
}

function findTool(name) {
  const matches = [];
  for (const home of sdkHomes()) {
    const tools = path.join(home, "build-tools");
    let versions = [];
    try {
      versions = readdirSync(tools);
    } catch {
      continue;
    }
    for (const version of versions) {
      const candidate = path.join(tools, version, name);
      try {
        if (statSync(candidate).isFile()) matches.push({ version, candidate });
      } catch {
        /* keep looking */
      }
    }
  }
  if (!matches.length) throw new Error(`could not find ${name} under Android build-tools`);
  matches.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
  return matches[matches.length - 1].candidate;
}

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

const failures = [];
function check(name, ok, detail) {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`;
  console.log(line);
  if (!ok) failures.push(line);
}

const apkStat = statSync(apk);
check("apk exists", apkStat.isFile() && apkStat.size > 0, `${apkStat.size} bytes`);

const apksigner = findTool("apksigner");
const signerOut = run(apksigner, ["verify", "--verbose", "--print-certs", apk]);
console.log(signerOut.trim());
check("signature verifies", /^Verifies$/m.test(signerOut));
check("v2 signature present", /Verified using v2 scheme \(APK Signature Scheme v2\):\s*true/.test(signerOut));
// apksigner skips the v1 check when minSdk is 24 or newer and reports v1 as false
// even if the JAR signature is present. Ask it to verify as API 23, where v1 is required.
const v1Out = run(apksigner, ["verify", "--verbose", "--min-sdk-version", "23", apk]);
console.log(v1Out.trim().split("\n").slice(0, 4).join("\n"));
check("v1 signature present", /Verified using v1 scheme \(JAR signing\):\s*true/.test(v1Out));
check("v1+v2 both verify on API 23", /^Verifies$/m.test(v1Out) && /Verified using v2 scheme \(APK Signature Scheme v2\):\s*true/.test(v1Out));

const aapt2 = findTool("aapt2");
const badging = run(aapt2, ["dump", "badging", apk]);
const packageLine = badging.split("\n").find((line) => line.startsWith("package:")) || "";
console.log(packageLine);
check("applicationId", /name='com\.macshi716\.koreansite'/.test(packageLine), packageLine);
check("versionCode 1", /versionCode='1'/.test(packageLine), packageLine);
check("versionName 1.0.0", /versionName='1\.0\.0'/.test(packageLine), packageLine);

const labels = [...badging.matchAll(/application-label(?:-[\w-]+)?:'([^']*)'/g)].map((match) => match[1]);
console.log("labels:", labels.join(" | "));
check("app name 韩语学习", labels.some((label) => label === "韩语学习" || label.includes("韩语学习")));

const listing = run("unzip", ["-l", apk]);
const entries = new Map();
for (const line of listing.split("\n")) {
  const match = line.match(/^\s*(\d+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(.+)$/);
  if (match) entries.set(match[2], Number(match[1]));
}

const required = [
  "assets/public/index.html",
  "assets/public/theme.css",
  "assets/public/golden-ratio.css",
  "assets/public/theme.js",
  "assets/public/android-shell.js",
  "assets/public/auth/preview.html",
  "assets/public/data/hangil-reading-55/hangil-text-mcq.json",
  "assets/public/data/practice-modes-20261128/image-manifest.json",
  "assets/public/data/practice-modes-20261128/practice-modes-pack.json",
  "assets/public/assets/practice-images/openmoji/ATTRIBUTION.md",
  "assets/public/assets/practice-images/openmoji/1F392.svg",
  "assets/public/dict/index.json",
  "assets/public/voices/supertonic/manifest.json",
  "assets/public/voices/supertonic/supertonic-worker.js",
  "assets/public/favicon.ico",
  "assets/public/apple-touch-icon.png",
];
for (const entry of required) {
  const size = entries.get(entry);
  check(`bundled ${entry}`, typeof size === "number" && size > 0, size == null ? "missing" : `${size} bytes`);
}

const dictEntries = [...entries.keys()].filter((name) => name.startsWith("assets/public/dict/") && !name.endsWith("/"));
const voiceEntries = [...entries.keys()].filter((name) => name.startsWith("assets/public/voices/") && !name.endsWith("/"));
check("dict/ bundled", dictEntries.length >= 5, `${dictEntries.length} files`);
check("voices/ bundled", voiceEntries.length >= 5, `${voiceEntries.length} files`);

const forbidden = [...entries.keys()].filter((name) =>
  name.startsWith("assets/public/tests/")
  || name.startsWith("assets/public/mobile-android/")
  || name.startsWith("assets/public/.git/")
  || name.startsWith("assets/public/.github/")
  || name.includes("/auth/tests/"),
);
check("tests and tooling excluded", forbidden.length === 0, forbidden.slice(0, 5).join(", "));

const launcher = [...entries.keys()].filter((name) => /ic_launcher.*\.png$/.test(name));
check("launcher pngs packaged", launcher.length >= 5, `${launcher.length} pngs`);
const defaultVector = [...entries.keys()].some((name) => name.includes("ic_launcher_foreground.xml"));
check("default vector foreground removed", !defaultVector);

const hash = createHash("sha256").update(readFileSync(apk)).digest("hex");
console.log(`sha256 ${hash}`);
console.log(`size ${apkStat.size}`);

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nAPK checks passed");
