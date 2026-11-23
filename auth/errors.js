import { COPY, userMessage } from "./messages.js";


const SAFE_CODE = /^[a-z0-9_]+$/;

export function isOfflineError(error) {
  if (!error) return false;
  const name = String(error.name || "");
  if (name === "AuthRetryableFetchError" || name === "TypeError") return true;
  return /failed to fetch|networkerror|load failed|network request failed/i.test(String(error.message || ""));
}

export function mapAuthError(error) {
  if (isOfflineError(error)) {
    return { ok: false, status: "error", code: "network_error", message: userMessage("network_error"), signedIn: false };
  }
  const rawCode = typeof error?.code === "string" ? error.code : "";
  const code = SAFE_CODE.test(rawCode) ? rawCode : "";
  const message = COPY[code] || (code
    ? `认证服务没有完成这次请求（${code}）。没有登录成功。`
    : userMessage("auth_request_failed"));
  return { ok: false, status: "error", code: code || "auth_request_failed", message, signedIn: false };
}
