/**
 * Copy the static site into mobile-android/www for Capacitor.
 * The repository root is what GitHub Pages and Vercel publish, so this
 * script never writes outside mobile-android/www.
 */
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const MOBILE_ROOT = path.resolve(SCRIPT_DIR, "..");
export const REPO_ROOT = path.resolve(MOBILE_ROOT, "..");
export const WWW_ROOT = path.join(MOBILE_ROOT, "www");

export const ROOT_FILES = [
  "index.html",
  "theme.css",
  "theme.js",
  "favicon.ico",
  "favicon-32.png",
  "apple-touch-icon.png",
];

export const CONTENT_DIRS = ["auth", "data", "dict", "voices"];

const SKIP_DIR_NAMES = new Set([
  "tests",
  "test",
  "node_modules",
  ".git",
  ".github",
  "mobile-android",
]);

export function ensureViewportCover(html) {
  if (/viewport-fit\s*=\s*cover/i.test(html)) return html;
  const meta = html.match(/<meta\b[^>]*\bname\s*=\s*["']viewport["'][^>]*>/i);
  if (!meta) {
    return html.replace(/<head\b[^>]*>/i, (open) => `${open}\n  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`);
  }
  return html.replace(meta[0], (tag) => {
    if (!/content\s*=\s*["'][^"']*["']/i.test(tag)) return tag;
    return tag.replace(/content\s*=\s*(["'])([\s\S]*?)\1/i, (all, quote, content) => {
      const next = content.trim().replace(/,\s*$/, "");
      return `content=${quote}${next}, viewport-fit=cover${quote}`;
    });
  });
}

export function shouldSkip(relativePath) {
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  if (parts.some((part) => SKIP_DIR_NAMES.has(part) || part.startsWith("."))) return true;
  const file = parts[parts.length - 1] || "";
  if (file.endsWith(".test.js") || file.endsWith(".test.mjs")) return true;
  return false;
}

async function assertNonEmptyFile(filePath, label) {
  const info = await stat(filePath);
  if (!info.isFile() || info.size <= 0) {
    throw new Error(`${label} is missing or empty (${filePath})`);
  }
  return info.size;
}

async function copyTree(sourceDir, destDir, relativeBase) {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  let copied = 0;
  for (const entry of entries) {
    const relative = path.posix.join(relativeBase, entry.name);
    if (shouldSkip(relative)) continue;
    const source = path.join(sourceDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await mkdir(dest, { recursive: true });
      copied += await copyTree(source, dest, relative);
    } else if (entry.isFile()) {
      await mkdir(path.dirname(dest), { recursive: true });
      await cp(source, dest);
      copied += 1;
    }
  }
  return copied;
}

export async function syncWww({ repoRoot = REPO_ROOT, wwwRoot = WWW_ROOT } = {}) {
  await rm(wwwRoot, { recursive: true, force: true });
  await mkdir(wwwRoot, { recursive: true });

  for (const file of ROOT_FILES) {
    const source = path.join(repoRoot, file);
    await assertNonEmptyFile(source, file);
    await cp(source, path.join(wwwRoot, file));
  }

  let copied = ROOT_FILES.length;
  for (const dir of CONTENT_DIRS) {
    const source = path.join(repoRoot, dir);
    const info = await stat(source);
    if (!info.isDirectory()) throw new Error(`required directory missing: ${dir}`);
    copied += await copyTree(source, path.join(wwwRoot, dir), dir);
  }

  const shellSource = path.join(MOBILE_ROOT, "shell", "android-shell.js");
  await assertNonEmptyFile(shellSource, "android-shell.js");
  await cp(shellSource, path.join(wwwRoot, "android-shell.js"));
  copied += 1;

  const htmlFiles = ["index.html", "auth/preview.html", "auth/recovery.html"];
  for (const relative of htmlFiles) {
    const target = path.join(wwwRoot, relative);
    let html = ensureViewportCover(await readFile(target, "utf8"));
    if (!html.includes('src="/android-shell.js"')) {
      const injected = html.replace(
        "</head>",
        '  <script src="/android-shell.js" defer></script>\n</head>',
      );
      if (injected === html) throw new Error(`could not inject android shell into ${relative}`);
      html = injected;
    }
    await writeFile(target, html);
  }

  const required = [
    "index.html",
    "theme.css",
    "theme.js",
    "android-shell.js",
    "auth/preview.html",
    "data/hangil-reading-55/hangil-text-mcq.json",
    "dict/index.json",
    "voices/supertonic/manifest.json",
    "voices/supertonic/supertonic-worker.js",
  ];
  for (const relative of required) {
    await assertNonEmptyFile(path.join(wwwRoot, relative), relative);
  }

  const leaked = [];
  async function scan(dir, relativeBase) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const relative = relativeBase ? path.posix.join(relativeBase, entry.name) : entry.name;
      if (shouldSkip(relative) && relative !== "android-shell.js") leaked.push(relative);
      if (entry.isDirectory()) await scan(path.join(dir, entry.name), relative);
    }
  }
  await scan(wwwRoot, "");
  if (leaked.length) throw new Error(`synced www contains excluded paths: ${leaked.join(", ")}`);

  return { copied, wwwRoot };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const result = await syncWww();
  console.log(`synced ${result.copied} files into ${result.wwwRoot}`);
}
