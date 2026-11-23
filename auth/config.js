import { cloudSyncStatus } from "./privacy.js";

const PUBLISHABLE_PREFIX = "sb_publishable_";
const SECRET_PREFIX = "sb_secret_";

function decodeJwtPayload(token) {
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = globalThis.atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
    const payload = JSON.parse(json);
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

function isLegacyAnonKey(key) {
  const payload = decodeJwtPayload(key);
  return payload?.role === "anon";
}

function isSecretKey(key) {
  const value = String(key || "");
  if (value.startsWith(SECRET_PREFIX)) return true;
  if (value.includes("service_role")) return true;
  const payload = decodeJwtPayload(value);
  return payload?.role === "service_role";
}

export function isAllowedProjectUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.search || url.hash) return false;
  if (url.protocol === "https:") {
    return url.hostname.endsWith(".supabase.co") && url.hostname !== "supabase.co" && url.hostname.split(".").length >= 3;
  }
  if (url.protocol === "http:") {
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  }
  return false;
}

export function publishableKeyOf(config) {
  return String(config?.supabasePublishableKey || config?.publishableKey || "").trim();
}

export function describeEmailPolicy({ customSmtpConfigured, mailerAutoconfirm }) {
  const customSmtp = customSmtpConfigured === true;
  const autoconfirm = mailerAutoconfirm === true;
  if (customSmtp) return { mode: "custom_smtp", autoconfirm, publicMail: true };
  if (autoconfirm) return { mode: "autoconfirm_without_smtp", autoconfirm: true, publicMail: false };
  return { mode: "builtin_admin_only", autoconfirm: false, publicMail: false };
}

export async function fetchAuthSettings(config, fetchImpl = globalThis.fetch) {
  const key = publishableKeyOf(config);
  const endpoint = new URL("/auth/v1/settings", String(config?.supabaseUrl || "").replace(/\/$/, ""));
  const response = await fetchImpl(endpoint, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) return { mailerAutoconfirm: false, unavailable: true };
  const body = await response.json();
  return { mailerAutoconfirm: body?.mailer_autoconfirm === true, unavailable: false };
}

export function assessPublicConfig(config) {
  const blockers = [];
  const url = String(config?.supabaseUrl || "").trim();
  const key = publishableKeyOf(config);
  if (!url) blockers.push({ code: "missing_url" });
  else if (!isAllowedProjectUrl(url)) blockers.push({ code: "bad_url" });
  if (!key) blockers.push({ code: "missing_key" });
  else if (isSecretKey(key)) blockers.push({ code: "secret_key_rejected" });
  else if (!(key.startsWith(PUBLISHABLE_PREFIX) && key.length >= PUBLISHABLE_PREFIX.length + 8) && !isLegacyAnonKey(key)) {
    blockers.push({ code: "unrecognized_key" });
  } else if (key.includes("...") || key.includes("REPLACE_ME")) {
    blockers.push({ code: "unrecognized_key" });
  }
  const ok = blockers.length === 0;
  return {
    ok,
    blockers,
    emailDeliveryReady: ok && config?.customSmtpConfigured === true,
    emailPolicy: describeEmailPolicy({
      customSmtpConfigured: config?.customSmtpConfigured,
      mailerAutoconfirm: config?.mailerAutoconfirm,
    }),
    smsReady: ok && config?.smsProviderConfigured === true,
    kakaoReady: ok && config?.social?.kakao?.configured === true,
    cloudSync: cloudSyncStatus(config),
  };
}

export function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  return email;
}

export function passwordIssue(password) {
  if (typeof password !== "string" || password.length === 0) return "password_required";
  if (password.length < 8) return "password_too_short";
  const bytes = new TextEncoder().encode(password).length;
  if (bytes > 72) return "password_too_long";
  return "";
}
