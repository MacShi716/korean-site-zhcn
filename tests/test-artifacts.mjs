/**
 * Screenshot targets for the browser suites.
 *
 * CI has /opt/cursor/artifacts. This workspace sometimes does not, so fall
 * back to the OS temp directory instead of failing a passing test. Assertions
 * are unchanged; only the artifact location is made portable.
 */
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function ensureArtifactDir(sub = "") {
  const bases = [
    process.env.KOREAN_SITE_ARTIFACTS,
    "/opt/cursor/artifacts",
    join(tmpdir(), "korean-site-artifacts"),
  ].filter(Boolean);
  let lastError = null;
  for (const base of bases) {
    const dir = sub ? join(base, sub) : base;
    try {
      mkdirSync(dir, { recursive: true });
      const probe = join(dir, ".write-test");
      writeFileSync(probe, "ok");
      unlinkSync(probe);
      return dir;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
