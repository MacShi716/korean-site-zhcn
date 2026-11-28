import { createAuthService } from "./auth-service.js";
import { createBrowserAuthClient } from "./supabase-client.js";
import { createMemoryAuthClient } from "./local-harness.js";
import { localHarnessAllowed } from "./paths.js";
import { fetchAuthSettings } from "./config.js";
import { publicConfig } from "./public-config.js";

const root = document.querySelector("#auth-app");
const flow = document.body.dataset.authFlow === "recovery" ? "recovery" : "signup";
const harnessOn = localHarnessAllowed(window.location);

const harnessConfig = {
  supabaseUrl: "https://local-harness.supabase.co",
  publishableKey: "sb_publishable_local_harness_only",
  customSmtpConfigured: true,
  smsProviderConfigured: false,
  social: {
    wechat: { configured: false },
    qq: { configured: false },
    kakao: { configured: false },
  },
  cloudSyncConsent: false,
};

const memory = harnessOn ? createMemoryAuthClient() : null;
const activeConfig = harnessOn ? harnessConfig : publicConfig;
let service = createAuthService({
  config: activeConfig,
  client: memory ? memory.client : null,
  location: window.location,
  loadAuthSettings: harnessOn ? async () => ({ mailerAutoconfirm: false }) : () => fetchAuthSettings(activeConfig),
});

function h(tag, props, children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  }
  for (const child of children || []) node.append(child);
  return node;
}

const status = h("p", { id: "auth-status", role: "status", "aria-live": "polite", text: "正在打开账号登录。" });
const blockers = h("ul", { id: "auth-blockers" });
const callbackBox = h("div", { id: "auth-callback", className: "card", hidden: "hidden" });
const callbackText = h("p", { id: "auth-callback-text", text: "" });
const callbackButton = h("button", { id: "auth-callback-go", type: "button", text: "这是我点开的邮件链接，继续" });
callbackBox.append(
  h("h2", { text: "邮件链接还没有兑换" }),
  callbackText,
  h("div", { className: "actions" }, [callbackButton]),
);

const email = h("input", { id: "auth-email", type: "email", autocomplete: "username", required: "required" });
const password = h("input", { id: "auth-password", type: "password", autocomplete: "current-password" });
const newPassword = h("input", { id: "auth-new-password", type: "password", autocomplete: "new-password" });
const resetEmail = h("input", { id: "auth-reset-email", type: "email", autocomplete: "username" });

function paintAvailability() {
  blockers.replaceChildren();
  const info = service.availability();
  const lines = [];
  if (!info.emailPasswordLogin) {
    lines.push("邮箱登录暂时不可用：公开配置不完整，没有登录成功。");
  } else {
    lines.push("邮箱和密码可以注册、登录。");
    lines.push("当前不要求确认邮件：自定义 SMTP 尚未配置，注册时由服务器直接确认邮箱。");
    lines.push("找回密码暂时不能送到普通访客邮箱，要等自定义 SMTP 配好。");
  }
  if (harnessOn) lines.push("当前是本机模拟，不会真正发信。");
  lines.push("手机短信、微信、QQ 和 Kakao 都没有配置，所以页面不显示这些入口。");
  lines.push("云同步暂未启用，不会上传学习记录。游客可以随时返回继续练习。");
  for (const line of lines) blockers.append(h("li", { text: line }));
}

function show(result) {
  let text = result?.message || "没有完成。";
  if (harnessOn && result?.status === "confirmation_required") {
    text = "本地模拟记下了注册。没有发送邮件。确认前还没有登录。";
  }
  if (harnessOn && result?.status === "reset_requested") {
    text = "本地模拟记下了重置请求。没有发送邮件，也不会说明账号是否存在。";
  }
  const emailText = result?.user?.email ? ` ${result.user.email}` : "";
  status.textContent = `${text}${emailText}`;
  paintAvailability();
}

async function run(button, task) {
  button.disabled = true;
  try {
    show(await task());
  } catch {
    status.textContent = "这次操作没有完成。没有登录成功。";
  } finally {
    button.disabled = false;
  }
}

function paramsNeedAttention() {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  return url.searchParams.has("code")
    || url.searchParams.has("token_hash")
    || url.searchParams.has("error")
    || url.searchParams.has("error_code")
    || hash.has("access_token")
    || hash.has("error");
}

function showCallback() {
  if (!paramsNeedAttention()) {
    callbackBox.hidden = true;
    return;
  }
  callbackBox.hidden = false;
  callbackText.textContent = flow === "recovery"
    ? "这是密码重置页。点按钮后才会用 PKCE code 或 token_hash 向认证服务兑换。兑换成功后请设置新密码。地址栏里的 access_token 不会被保存。"
    : "点按钮后才会兑换邮件里的一次性 code 或 token_hash。页面打开本身不会登录。PKCE 需要和发起请求相同的浏览器。";
}

const registerButton = h("button", { id: "auth-register", type: "button", text: "注册" });
const loginButton = h("button", { id: "auth-login", type: "button", className: "secondary", text: "登录" });
const resetButton = h("button", { id: "auth-reset", type: "button", text: "发送重置邮件" });
const setPasswordButton = h("button", { id: "auth-set-password", type: "button", text: "保存新密码" });
const guest = h("button", { id: "auth-guest", type: "button", text: "先不登录，继续练习" });
const logout = h("button", { id: "auth-logout", type: "button", className: "secondary", text: "退出此浏览器" });

registerButton.addEventListener("click", () => run(registerButton, () => service.registerWithEmail({
  email: email.value,
  password: password.value,
})));
loginButton.addEventListener("click", () => run(loginButton, () => service.signInWithEmail({
  email: email.value,
  password: password.value,
})));
resetButton.addEventListener("click", () => run(resetButton, () => service.requestPasswordReset({
  email: resetEmail.value || email.value,
})));
setPasswordButton.addEventListener("click", () => run(setPasswordButton, () => service.completePasswordReset({
  password: newPassword.value,
})));
guest.addEventListener("click", () => run(guest, () => Promise.resolve(service.continueAsGuest())));
logout.addEventListener("click", () => run(logout, () => service.signOut()));
callbackButton.addEventListener("click", () => run(callbackButton, async () => {
  const result = await service.consumeEmailLink({ href: window.location.href, flow });
  if (result.clearAddressBar) {
    const next = result.clearedPath || window.location.pathname;
    window.history.replaceState({}, "", next);
    showCallback();
  }
  return result;
}));

const harnessBox = h("div", { id: "auth-harness", className: "card", hidden: harnessOn ? null : "hidden" });
if (harnessOn) {
  const confirmButton = h("button", { id: "auth-harness-confirm", type: "button", className: "secondary", text: "模拟确认邮箱（不发信）" });
  const recoveryButton = h("button", { id: "auth-harness-recovery", type: "button", className: "secondary", text: "模拟打开重置链接（不发信）" });
  confirmButton.addEventListener("click", () => {
    const ok = memory.confirmEmail(email.value.trim().toLowerCase());
    status.textContent = ok
      ? "本地模拟已把这个邮箱标成已确认。没有发送邮件。"
      : "本地模拟里还没有这个邮箱。请先点注册。没有发送邮件。";
  });
  recoveryButton.addEventListener("click", () => {
    const ok = memory.openRecovery((resetEmail.value || email.value).trim().toLowerCase());
    if (ok) service.markRecoveryForLocalHarness();
    status.textContent = ok
      ? "本地模拟已建立重置会话。没有发送邮件。现在可以保存新密码。"
      : "本地模拟里还没有这个邮箱。没有发送邮件。";
  });
  harnessBox.append(
    h("h2", { text: "仅本机模拟" }),
    h("p", { className: "muted", text: "这些按钮只在本机 127.0.0.1 且地址带 ?harness=1 时出现。它们使用内存账号，不会访问线上认证服务，也不会发邮件或短信。" }),
    h("div", { className: "actions" }, [confirmButton, recoveryButton]),
  );
}

const banner = h("div", {
  className: harnessOn ? "banner harness" : "banner",
  id: "auth-banner",
});
banner.append(
  h("h1", { text: harnessOn ? "本地模拟登录（不是真实账号）" : (flow === "recovery" ? "设置新密码" : "账号登录") }),
  h("p", { text: harnessOn
    ? "这是内存里的合成账号。没有网络请求，没有真实邮件或短信，不能当成端到端通过。"
    : "这是线上账号登录页。游客可以随时返回继续学习。这里不会读取或上传本机练习记录。" }),
);

root.append(
  banner,
  status,
  h("div", { className: "card" }, [
    h("h2", { text: "当前可用性" }),
    blockers,
  ]),
  callbackBox,
  h("form", { className: "card", onSubmit: (event) => event.preventDefault() }, [
    h("h2", { text: "邮箱和密码" }),
    h("label", { for: "auth-email", text: "邮箱" }),
    email,
    h("label", { for: "auth-password", text: "密码（至少 8 位）" }),
    password,
    h("div", { className: "actions" }, [registerButton, loginButton]),
  ]),
  h("form", { className: "card", onSubmit: (event) => event.preventDefault() }, [
    h("h2", { text: "找回密码" }),
    h("p", { className: "muted", text: "找回密码暂时不可用：自定义 SMTP 尚未配置，重置邮件不能送到普通访客邮箱。服务不会说明账号是否存在。" }),
    h("label", { for: "auth-reset-email", text: "接收重置邮件的邮箱" }),
    resetEmail,
    h("div", { className: "actions" }, [resetButton]),
    h("label", { for: "auth-new-password", text: "新密码" }),
    newPassword,
    h("div", { className: "actions" }, [setPasswordButton]),
  ]),
  h("div", { className: "actions" }, [guest, logout]),
  harnessBox,
  h("div", { className: "note" }, [
    h("p", { id: "auth-privacy", text: "学习记录只留在本机。这个登录页不会读取或上传，云同步暂未启用。" }),
    h("p", { className: "muted", text: "自定义 SMTP 配置之前，找回密码邮件不能送到普通访客邮箱。手机短信、微信、QQ 和 Kakao 没有配置，所以不显示这些入口。" }),
    h("p", {}, [h("a", { href: "../index.html", text: "返回学习首页（游客可继续练习）" })]),
  ]),
);

async function boot() {
  paintAvailability();
  showCallback();
  if (harnessOn) {
    service.attachListener(() => {});
    show(service.continueAsGuest());
    status.textContent = "本地模拟已就绪。可以注册一个合成邮箱。不会发信，也不会改动本机练习记录。";
    return;
  }
  const created = await createBrowserAuthClient(activeConfig);
  if (!created.ok) {
    const guestResult = service.continueAsGuest();
    status.textContent = guestResult.message;
    return;
  }
  service = createAuthService({
    config: activeConfig,
    client: created.client,
    location: window.location,
    loadAuthSettings: () => fetchAuthSettings(activeConfig),
  });
  await service.refreshEmailPolicy();
  paintAvailability();
  service.attachListener(async (event) => {
    if (event.event === "PASSWORD_RECOVERY") {
      const restored = await service.restoreSession();
      show(restored);
    }
  });
  show(await service.restoreSession());
}

boot();
