/**
 * GitHub Pages serves the site under /korean-site-zhcn/.
 * Vercel serves it at the host root. Redirect targets are the auth pages:
 * PKCE codes are redeemed there, and the homepage only reads the stored session.
 */

export function detectSiteBase(pathname, hostname) {
  const path = pathname || "/";
  const cut = path.search(/\/auth\/(?:preview|recovery)\.html$/);
  if (cut >= 0) return path.slice(0, cut);
  const host = String(hostname || "");
  if (host.endsWith(".github.io")) {
    const first = path.split("/").filter(Boolean)[0];
    if (first && first !== "auth") return `/${first}`;
  }
  return "";
}

export function authPageUrl(locationLike, page) {
  const origin = locationLike?.origin;
  if (!origin) return "";
  const base = detectSiteBase(locationLike.pathname, locationLike.hostname);
  const file = page === "recovery" ? "/auth/recovery.html" : "/auth/preview.html";
  return `${origin}${base}${file}`;
}

export function readAuthParams(href) {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  return {
    code: url.searchParams.get("code") || "",
    tokenHash: url.searchParams.get("token_hash") || "",
    type: url.searchParams.get("type") || "",
    error: url.searchParams.get("error") || hash.get("error") || "",
    errorCode: url.searchParams.get("error_code") || hash.get("error_code") || "",
    hasImplicitAccessToken: hash.has("access_token"),
    flowId: url.searchParams.get("sb_flow_id") || "",
  };
}

export function addressWithoutAuthParams(href) {
  const url = new URL(href);
  for (const key of ["code", "token_hash", "type", "error", "error_code", "error_description", "sb_flow_id"]) {
    url.searchParams.delete(key);
  }
  url.hash = "";
  return `${url.pathname}${url.search}`;
}

export function localHarnessAllowed(locationLike) {
  const host = String(locationLike?.hostname || "");
  // The memory harness is only for the documented 127.0.0.1 preview.
  if (host !== "127.0.0.1" || !locationLike?.href) return false;
  try {
    return new URL(locationLike.href).searchParams.get("harness") === "1";
  } catch {
    return false;
  }
}
