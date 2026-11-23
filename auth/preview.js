import { createAuthService } from "./auth-service.js";
import { createBrowserAuthClient } from "./supabase-client.js";
import { createMemoryAuthClient } from "./local-harness.js";
import { COUNTRY_CODES } from "./phone.js";
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

const status = h("p", { id: "auth-status", role: "status", "aria-live": "polite", text: "正在准备登录草稿。" });
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
const cc = h("select", { id: "auth-cc", "aria-label": "国家或地区区号" });
for (const country of COUNTRY_CODES) {
  cc.append(h("option", { value: country.cc, text: `${country.cc} ${country.label}` }));
}
cc.value = "+86";
const phone = h("input", { id: "auth-phone", type: "tel", inputmode: "tel", autocomplete: "tel-national", placeholder: "13800138000" });
const smsCode = h("input", { id: "auth-sms-code", type: "text", inputmode: "numeric", autocomplete: "one-time-code", placeholder: "短信里的验证码" });

function paintAvailability() {
  blockers.replaceChildren();
  const info = service.availability();
  const lines = [];
  if (!info.emailPasswordLogin) lines.push("邮箱密码登录：停住，还没有可公开的项目配置。");
  else lines.push("邮箱密码登录：配置格式可用。尚未对真实项目做端到端验证。");
  if (harnessOn) lines.push("发信：本地模拟只记在内存里，不会真正发信。");
  else if (info.emailPolicy === "autoconfirm_without_smtp") lines.push("邮箱确认已关闭：可以用邮箱和密码直接注册登录。找回密码和邮箱验证仍待自定义 SMTP。");
  else if (info.emailPolicy === "custom_smtp") lines.push("发信：已配置自定义 SMTP。注册和重置会调用发信接口。");
  else lines.push("内置发信仅限管理员测试邮箱，公网注册/找回密码需先配置自有域名与自定义 SMTP。");
  lines.push(info.phoneSms
    ? "手机短信：配置标记为已接通。发送会走短信商。"
    : "手机短信：停住。没有短信服务商，000000 不会成功。");
  lines.push("微信：未接通。Supabase 没有内置微信。");
  lines.push("QQ：未接通。Supabase 没有内置 QQ。");
  lines.push(info.kakao ? "Kakao：配置标记为已接通，点击会跳转。" : "Kakao：未接通。还没有 Kakao 应用凭据。");
  lines.push("游客：可用。云同步：关闭，不会上传学习记录。");
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
const smsRequest = h("button", { id: "auth-sms-request", type: "button", className: "secondary", text: "获取验证码（当前不可用）" });
const smsLogin = h("button", { id: "auth-sms-login", type: "button", className: "secondary", text: "用验证码登录" });
const wechat = h("button", { id: "auth-wechat", type: "button", className: "secondary", text: "微信（未接通）" });
const qq = h("button", { id: "auth-qq", type: "button", className: "secondary", text: "QQ（未接通）" });
const kakao = h("button", { id: "auth-kakao", type: "button", className: "secondary", text: "Kakao（未接通）" });
const guest = h("button", { id: "auth-guest", type: "button", text: "先不登录，继续学习" });
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
smsRequest.addEventListener("click", () => run(smsRequest, () => service.requestPhoneCode({
  cc: cc.value,
  phone: phone.value,
})));
smsLogin.addEventListener("click", () => run(smsLogin, () => service.signInWithPhoneCode({
  cc: cc.value,
  phone: phone.value,
  code: smsCode.value,
})));
wechat.addEventListener("click", () => run(wechat, () => service.signInWithSocial("wechat")));
qq.addEventListener("click", () => run(qq, () => service.signInWithSocial("qq")));
kakao.addEventListener("click", () => run(kakao, () => service.signInWithSocial("kakao")));
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
    h("p", { className: "muted", text: "这些按钮只存在于 localhost 或 127.0.0.1 且地址带 ?harness=1 时。它们使用内存账号，不会访问 Supabase，也不会发邮件或短信。" }),
    h("div", { className: "actions" }, [confirmButton, recoveryButton]),
  );
}

const banner = h("div", {
  className: harnessOn ? "banner harness" : "banner",
  id: "auth-banner",
});
banner.append(
  h("h1", { text: harnessOn ? "本地模拟登录（不是真实账号）" : "登录草稿（未接入首页，未发布）" }),
  h("p", { text: harnessOn
    ? "这是内存里的合成账号。没有网络请求，没有真实邮件或短信，不能当成端到端通过。"
    : "首页的 000000 演示登录没有被替换。这里是单独的 Supabase Auth 草稿。缺少项目、发信或短信配置时，对应按钮会停住并说明原因。" }),
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
    h("p", { className: "muted", text: "重置回跳到 auth/recovery.html。PKCE 的 code 要在发起请求的同一个浏览器里兑换。没有自定义 SMTP 时不会发信。" }),
    h("label", { for: "auth-reset-email", text: "接收重置邮件的邮箱" }),
    resetEmail,
    h("div", { className: "actions" }, [resetButton]),
    h("label", { for: "auth-new-password", text: "新密码" }),
    newPassword,
    h("div", { className: "actions" }, [setPasswordButton]),
  ]),
  h("div", { className: "card" }, [
    h("h2", { text: "手机号" }),
    h("p", { className: "muted", text: "区号会保留。没有短信服务商时不能发送，也不能用 000000 登录。" }),
    h("div", { className: "row" }, [cc, phone]),
    h("label", { for: "auth-sms-code", text: "短信验证码" }),
    smsCode,
    h("div", { className: "actions" }, [smsRequest, smsLogin]),
  ]),
  h("div", { className: "card" }, [
    h("h2", { text: "其他登录方式" }),
    h("div", { className: "actions" }, [wechat, qq, kakao]),
  ]),
  h("div", { className: "actions" }, [guest, logout]),
  harnessBox,
  h("div", { className: "note" }, [
    h("p", { id: "auth-privacy", text: "学习记录、对话和健康相关数据只留在本机原有钥匙里。这个草稿不读取、不迁移、不上传。云同步没有实现，勾选同意也不会打开它。" }),
    h("p", { className: "muted", text: "回跳地址按当前域名计算：GitHub Pages 会带上 /korean-site-zhcn/，Vercel 使用站点根下的 /auth/。将来接到首页时，只替换登录、社交、退出和游客这几个函数，不要改练习和词库。" }),
    h("p", {}, [h("a", { href: "../index.html", text: "返回学习首页（游客仍可用，首页登录仍是原来的演示）" })]),
  ]),
);

async function boot() {
  paintAvailability();
  showCallback();
  if (harnessOn) {
    service.attachListener(() => {});
    show(service.continueAsGuest());
    status.textContent = "本地模拟已就绪。可以注册一个合成邮箱。不会发信。";
    return;
  }
  const created = await createBrowserAuthClient(activeConfig);
  if (!created.ok) {
    const guestResult = service.continueAsGuest();
    status.textContent = `${guestResult.message} 真实账号还停在缺失的配置上。`;
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
