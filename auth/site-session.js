/**
 * Read the one real browser session used by the site header and the tutor.
 *
 * Supabase Auth writes this JSON object under korean-site-auth-session. The
 * homepage is a classic script, so this tiny ESM module is loaded separately
 * and never touches the learning-record keys.
 */
export const SITE_AUTH_STORAGE_KEY = "korean-site-auth-session";

function safeStorage(storage) {
  if (storage && typeof storage.getItem === "function") return storage;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function readSiteSession(storage) {
  const backing = safeStorage(storage);
  if (!backing) return null;
  let parsed;
  try {
    parsed = JSON.parse(backing.getItem(SITE_AUTH_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const accessToken = typeof parsed.access_token === "string" ? parsed.access_token.trim() : "";
  const user = parsed.user && typeof parsed.user === "object" ? parsed.user : null;
  const userId = user && typeof user.id === "string" ? user.id.trim() : "";
  if (!accessToken || !userId) return null;
  const expiresAt = Number(parsed.expires_at) || 0;
  // An already-expired token is not a usable session; the auth page can refresh it.
  if (expiresAt && expiresAt * 1000 < Date.now() - 60000) return null;
  const email = user && typeof user.email === "string" ? user.email.trim() : "";
  return { accessToken, userId, email, expiresAt };
}

export function maskSiteEmail(email) {
  const value = String(email || "").trim();
  const at = value.indexOf("@");
  if (at <= 0 || at === value.length - 1) return "";
  const name = value.slice(0, at);
  const domain = value.slice(at + 1);
  const visible = name.length <= 2 ? name.slice(0, 1) : name.slice(0, 2);
  return `${visible}***@${domain}`;
}

/**
 * Call onChange now and whenever the session changes in this tab or another
 * one. It never blocks first paint and never reads learning records.
 */
export function watchSiteSession(onChange, options = {}) {
  if (typeof onChange !== "function") return { refresh() {}, stop() {} };
  const target = options.window || globalThis;
  const storage = safeStorage(options.storage);
  const notify = () => onChange(readSiteSession(storage));
  const onStorage = (event) => {
    if (!event || !event.key || event.key === SITE_AUTH_STORAGE_KEY) notify();
  };
  if (target.document && target.document.readyState === "loading") {
    target.document.addEventListener("DOMContentLoaded", notify, { once: true });
  } else {
    notify();
  }
  if (typeof target.addEventListener === "function") {
    target.addEventListener("pageshow", notify);
    target.addEventListener("storage", onStorage);
  }
  return {
    refresh: notify,
    stop() {
      if (typeof target.removeEventListener !== "function") return;
      target.removeEventListener("pageshow", notify);
      target.removeEventListener("storage", onStorage);
    },
  };
}
