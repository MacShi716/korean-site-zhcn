import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createAuthService } from "../auth-service.js";
import { assessPublicConfig, fetchAuthSettings } from "../config.js";
import { createLegacyAuthHooks } from "../future-adapter.js";
import { createMemoryAuthClient } from "../local-harness.js";
import { authPageUrl, localHarnessAllowed } from "../paths.js";
import { publicConfig } from "../public-config.js";
import { createBrowserAuthClient } from "../supabase-client.js";
import { createIsolatedAuthStorage } from "../storage-guard.js";

const here = dirname(fileURLToPath(import.meta.url));
const authDir = dirname(here);

function jwt(payload) {
  const head = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${head}.${body}.sig`;
}

function readyConfig(overrides = {}) {
  return {
    supabaseUrl: "https://exampleproject.supabase.co",
    publishableKey: "sb_publishable_test_only",
    customSmtpConfigured: false,
    smsProviderConfigured: false,
    social: {
      wechat: { configured: false },
      qq: { configured: false },
      kakao: { configured: false },
    },
    cloudSyncConsent: false,
    ...overrides,
  };
}

function mockAuth(impl = {}) {
  const calls = [];
  const names = [
    "signUp", "signInWithPassword", "signOut", "getUser", "getSession",
    "resetPasswordForEmail", "updateUser", "verifyOtp", "exchangeCodeForSession",
    "signInWithOtp", "signInWithOAuth", "onAuthStateChange",
  ];
  const auth = {};
  for (const name of names) {
    auth[name] = async (...args) => {
      calls.push([name, ...args]);
      if (impl[name]) return impl[name](...args);
      if (name === "onAuthStateChange") return { data: { subscription: { unsubscribe() {} } } };
      if (name === "signOut" || name === "resetPasswordForEmail") return { data: {}, error: null };
      if (name === "getUser") return { data: { user: null }, error: { code: "session_not_found" } };
      return { data: {}, error: { code: "auth_request_failed" } };
    };
  }
  return { client: { auth }, calls };
}

const vercel = {
  origin: "https://korean-site-zhcn.vercel.app",
  hostname: "korean-site-zhcn.vercel.app",
  pathname: "/",
};
const pages = {
  origin: "https://macshi716.github.io",
  hostname: "macshi716.github.io",
  pathname: "/korean-site-zhcn/index.html",
};

test("committed public config is the existing project and stays private-key free", () => {
  const verdict = assessPublicConfig(publicConfig);
  assert.equal(publicConfig.supabaseUrl, "https://fehowefhgzjmdlpaoqig.supabase.co");
  assert.equal(publicConfig.supabasePublishableKey.startsWith("sb_publishable_"), true);
  assert.equal(publicConfig.customSmtpConfigured, false);
  assert.equal(publicConfig.smsProviderConfigured, false);
  assert.equal(publicConfig.social.wechat.configured, false);
  assert.equal(publicConfig.social.qq.configured, false);
  assert.equal(publicConfig.social.kakao.configured, false);
  assert.equal(publicConfig.cloudSyncConsent, false);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.emailDeliveryReady, false);
  assert.equal(verdict.smsReady, false);
  assert.equal(verdict.kakaoReady, false);
  assert.equal(verdict.cloudSync.enabled, false);
  assert.equal(verdict.cloudSync.uploadsLearningRecords, false);
  assert.equal(JSON.stringify(publicConfig).includes("service_role"), false);
  assert.equal(JSON.stringify(publicConfig).includes("sb_secret_"), false);
});

test("secret and service_role keys are rejected; publishable and legacy anon are accepted", () => {
  assert.equal(assessPublicConfig(readyConfig()).ok, true);
  assert.equal(assessPublicConfig(readyConfig({ publishableKey: jwt({ role: "anon" }) })).ok, true);
  const secret = assessPublicConfig(readyConfig({ publishableKey: "sb_secret_not_for_browser" }));
  assert.equal(secret.ok, false);
  assert.equal(secret.blockers[0].code, "secret_key_rejected");
  const serviceRole = assessPublicConfig(readyConfig({ publishableKey: jwt({ role: "service_role" }) }));
  assert.equal(serviceRole.ok, false);
  assert.ok(serviceRole.blockers.some((item) => item.code === "secret_key_rejected"));
  assert.equal(assessPublicConfig(readyConfig({ supabaseUrl: "https://evil.example/auth" })).ok, false);
  assert.equal(assessPublicConfig(readyConfig({ supabaseUrl: "http://127.0.0.1:54321" })).ok, true);
});

test("redirect URLs keep the Pages prefix and the Vercel root", () => {
  assert.equal(authPageUrl(vercel, "preview"), "https://korean-site-zhcn.vercel.app/auth/preview.html");
  assert.equal(authPageUrl(vercel, "recovery"), "https://korean-site-zhcn.vercel.app/auth/recovery.html");
  assert.equal(authPageUrl(pages, "preview"), "https://macshi716.github.io/korean-site-zhcn/auth/preview.html");
  assert.equal(
    authPageUrl({ ...pages, pathname: "/korean-site-zhcn/auth/recovery.html" }, "preview"),
    "https://macshi716.github.io/korean-site-zhcn/auth/preview.html",
  );
});

test("local harness cannot be enabled on the public hosts", () => {
  assert.equal(localHarnessAllowed({ hostname: "127.0.0.1", href: "http://127.0.0.1:8765/auth/preview.html?harness=1" }), true);
  assert.equal(localHarnessAllowed({ hostname: "localhost", href: "http://localhost:8765/auth/preview.html" }), false);
  assert.equal(localHarnessAllowed({ hostname: "localhost", href: "http://localhost:8765/auth/preview.html?harness=1" }), false);
  assert.equal(localHarnessAllowed({ hostname: "korean-site-zhcn.vercel.app", href: "https://korean-site-zhcn.vercel.app/auth/preview.html?harness=1" }), false);
  assert.equal(localHarnessAllowed({ hostname: "macshi716.github.io", href: "https://macshi716.github.io/korean-site-zhcn/auth/preview.html?harness=1" }), false);
});

test("missing config blocks register, login, reset, and phone without calling Auth", async () => {
  const mock = mockAuth();
  const service = createAuthService({
    config: { supabaseUrl: "", supabasePublishableKey: "", customSmtpConfigured: false, smsProviderConfigured: false, social: {}, cloudSyncConsent: false },
    client: mock.client,
    location: vercel,
  });
  const register = await service.registerWithEmail({ email: "learner@example.com", password: "correct-horse" });
  const login = await service.signInWithEmail({ email: "learner@example.com", password: "correct-horse" });
  const reset = await service.requestPasswordReset({ email: "learner@example.com" });
  const sms = await service.requestPhoneCode({ cc: "+86", phone: "13800138000" });
  assert.equal(register.signedIn, false);
  assert.equal(login.signedIn, false);
  assert.equal(reset.ok, false);
  assert.equal(sms.ok, false);
  assert.equal(mock.calls.length, 0);
  const guest = service.continueAsGuest();
  assert.equal(guest.mode, "guest");
  assert.equal(guest.cloudSync.uploadsLearningRecords, false);
});

test("builtin mail allows an admin-only request and says public mail is not ready", async () => {
  const mock = mockAuth({
    signUp: async () => ({ data: { user: { id: "u", email: "admin@example.com", identities: [{}] }, session: null }, error: null }),
  });
  const service = createAuthService({
    config: readyConfig(),
    client: mock.client,
    location: vercel,
    loadAuthSettings: async () => ({ mailerAutoconfirm: false }),
  });
  const register = await service.registerWithEmail({ email: "admin@example.com", password: "correct-horse" });
  const reset = await service.requestPasswordReset({ email: "admin@example.com" });
  assert.equal(register.signedIn, false);
  assert.equal(register.emailPolicy, "builtin_admin_only");
  assert.match(register.message, /内置发信仅限管理员测试邮箱，公网注册\/找回密码需先配置自有域名与自定义 SMTP/);
  assert.match(reset.message, /内置发信仅限管理员测试邮箱/);
  assert.equal(mock.calls.some((call) => call[0] === "signUp"), true);
  assert.equal(mock.calls.some((call) => call[0] === "resetPasswordForEmail"), true);
  assert.equal(JSON.stringify(mock.calls).includes("koreanSite_zhcn_draft_v01"), false);
});

test("turning off confirm-email allows a direct password session and still labels SMTP", async () => {
  const session = { user: { id: "user-1", email: "learner@example.com" } };
  const mock = mockAuth({
    signUp: async () => ({ data: { user: session.user, session }, error: null }),
  });
  const service = createAuthService({
    config: readyConfig({ mailerAutoconfirm: true }),
    client: mock.client,
    location: vercel,
  });
  const register = await service.registerWithEmail({ email: "learner@example.com", password: "correct-horse" });
  const reset = await service.requestPasswordReset({ email: "learner@example.com" });
  assert.equal(register.signedIn, true);
  assert.equal(register.emailPolicy, "autoconfirm_without_smtp");
  assert.match(register.message, /自定义 SMTP/);
  assert.match(reset.message, /找回密码和邮箱验证仍要先配置自有域名与自定义 SMTP/);
  assert.equal(service.availability().autoOpenLogin, false);
});

test("a signup session without custom SMTP uses the honest autoconfirm message", async () => {
  const session = { user: { id: "user-1", email: "learner@example.com" } };
  const mock = mockAuth({
    signUp: async () => ({ data: { user: session.user, session }, error: null }),
  });
  const service = createAuthService({
    config: readyConfig(),
    client: mock.client,
    location: vercel,
    loadAuthSettings: async () => ({ mailerAutoconfirm: false }),
  });
  const register = await service.registerWithEmail({ email: "Learner@Example.com", password: "correct-horse" });
  assert.equal(register.signedIn, true);
  assert.equal(register.status, "signed_in");
  assert.equal(register.emailPolicy, "builtin_admin_only");
  assert.match(register.message, /直接确认了邮箱/);
  assert.match(register.message, /自定义 SMTP/);
  assert.equal(register.message.includes("如果这个邮箱可以接收确认信"), false);
  assert.equal(register.message.includes("确认完成前，这里还没有登录"), false);
  const signUpCall = mock.calls.find((call) => call[0] === "signUp")[1];
  assert.equal(signUpCall.email, "learner@example.com");
});

test("signup with no session retries the same password login once and signs in", async () => {
  const session = { user: { id: "user-1", email: "learner@example.com" } };
  let signInArgs = null;
  const mock = mockAuth({
    signUp: async () => ({
      data: { user: { id: "user-1", email: "learner@example.com", identities: [{}] }, session: null },
      error: null,
    }),
    signInWithPassword: async (args) => {
      signInArgs = args;
      return { data: { session, user: session.user }, error: null };
    },
  });
  const service = createAuthService({
    config: readyConfig(),
    client: mock.client,
    location: vercel,
    loadAuthSettings: async () => ({ mailerAutoconfirm: false }),
  });
  const register = await service.registerWithEmail({ email: "learner@example.com", password: "correct-horse" });
  assert.equal(register.signedIn, true);
  assert.equal(register.status, "signed_in");
  assert.match(register.message, /直接确认了邮箱/);
  assert.deepEqual(signInArgs, { email: "learner@example.com", password: "correct-horse" });
  assert.equal(mock.calls.filter((call) => call[0] === "signInWithPassword").length, 1);
});

test("a failed fallback login keeps the non-enumerating confirmation copy", async () => {
  const mock = mockAuth({
    signUp: async () => ({
      data: { user: { id: "user-1", email: "learner@example.com", identities: [] }, session: null },
      error: null,
    }),
    signInWithPassword: async () => ({
      data: { session: null, user: null },
      error: { code: "invalid_credentials", message: "hunter2 raw server text" },
    }),
  });
  const service = createAuthService({
    config: readyConfig(),
    client: mock.client,
    location: vercel,
    loadAuthSettings: async () => ({ mailerAutoconfirm: false }),
  });
  const register = await service.registerWithEmail({ email: "learner@example.com", password: "wrong-password" });
  assert.equal(register.signedIn, false);
  assert.equal(register.status, "confirmation_required");
  assert.equal(register.code, undefined);
  assert.equal(JSON.stringify(register).includes("hunter2"), false);
  assert.equal(mock.calls.filter((call) => call[0] === "signInWithPassword").length, 1);
});

test("auth settings reader uses only the public settings endpoint", async () => {
  let seen;
  const settings = await fetchAuthSettings(readyConfig(), async (url, options) => {
    seen = { url: String(url), apikey: options.headers.apikey };
    return { ok: true, json: async () => ({ mailer_autoconfirm: false, external: { email: true } }) };
  });
  assert.equal(settings.mailerAutoconfirm, false);
  assert.equal(seen.url, "https://exampleproject.supabase.co/auth/v1/settings");
  assert.equal(seen.apikey, "sb_publishable_test_only");
});

test("signup and reset use the host-specific page and do not attach learning data", async () => {
  const mock = mockAuth({
    signUp: async () => ({ data: { user: { id: "u", email: "learner@example.com", identities: [{}] }, session: null }, error: null }),
  });
  const config = readyConfig({ customSmtpConfigured: true, cloudSyncConsent: true });
  const service = createAuthService({ config, client: mock.client, location: pages });
  const register = await service.registerWithEmail({ email: "Learner@Example.com", password: "correct-horse" });
  const reset = await service.requestPasswordReset({ email: "learner@example.com" });
  assert.equal(register.signedIn, false);
  assert.equal(register.status, "confirmation_required");
  assert.equal(reset.status, "reset_requested");
  assert.match(reset.message, /不会说明账号是否存在/);
  const signUpCall = mock.calls.find((call) => call[0] === "signUp")[1];
  assert.equal(signUpCall.email, "learner@example.com");
  assert.deepEqual(Object.keys(signUpCall.options), ["emailRedirectTo"]);
  assert.equal(signUpCall.options.emailRedirectTo, "https://macshi716.github.io/korean-site-zhcn/auth/preview.html");
  assert.equal(signUpCall.options.data, undefined);
  const resetCall = mock.calls.find((call) => call[0] === "resetPasswordForEmail");
  assert.equal(resetCall[2].redirectTo, "https://macshi716.github.io/korean-site-zhcn/auth/recovery.html");
  assert.equal(JSON.stringify(mock.calls).includes("koreanSite_zhcn_draft_v01"), false);
  assert.equal(service.availability().cloudSync.enabled, false);
  assert.equal(service.availability().cloudSync.uploadsChat, false);
});

test("login, restore, and local sign-out do not echo server text or tokens", async () => {
  const session = { user: { id: "user-1", email: "learner@example.com", access_token: "should-not-copy" } };
  let attempt = 0;
  let offline = false;
  const mock = mockAuth({
    signInWithPassword: async () => {
      attempt += 1;
      if (attempt === 1) {
        return { data: { session: null, user: null }, error: { code: "invalid_credentials", message: "hunter2 eyJsecret" } };
      }
      return { data: { session, user: session.user }, error: null };
    },
    getUser: async () => {
      if (offline) throw new TypeError("Failed to fetch");
      return { data: { user: session.user }, error: null };
    },
  });
  const service = createAuthService({ config: readyConfig(), client: mock.client, location: vercel });
  const bad = await service.signInWithEmail({ email: "learner@example.com", password: "wrong-password" });
  assert.equal(bad.signedIn, false);
  assert.equal(JSON.stringify(bad).includes("hunter2"), false);
  assert.equal(JSON.stringify(bad).includes("eyJ"), false);
  const good = await service.signInWithEmail({ email: "learner@example.com", password: "correct-horse" });
  assert.equal(good.signedIn, true);
  assert.equal(good.user.email, "learner@example.com");
  assert.equal(Object.hasOwn(good.user, "access_token"), false);
  const restored = await service.restoreSession();
  assert.equal(restored.signedIn, true);
  const signedOut = await service.signOut();
  assert.equal(signedOut.signedIn, false);
  assert.deepEqual(mock.calls.find((call) => call[0] === "signOut")[1], { scope: "local" });
  offline = true;
  const down = await service.restoreSession();
  assert.equal(down.signedIn, false);
  assert.equal(down.code, "network_error");
});

test("000000 never signs in, and SMS is not requested without a provider", async () => {
  const mock = mockAuth();
  const service = createAuthService({ config: readyConfig(), client: mock.client, location: vercel });
  const demo = await service.signInWithPhoneCode({ cc: "+86", phone: "13800138000", code: "000000" });
  const request = await service.requestPhoneCode({ cc: "+82", phone: "010-1234-5678" });
  assert.equal(demo.ok, false);
  assert.equal(demo.code, "demo_code_rejected");
  assert.equal(demo.signedIn, false);
  assert.equal(request.code, "sms_provider_not_configured");
  assert.equal(mock.calls.length, 0);
  const enabled = createAuthService({
    config: readyConfig({ smsProviderConfigured: true }),
    client: mock.client,
    location: vercel,
  });
  const stillDemo = await enabled.signInWithPhoneCode({ cc: "+86", phone: "13800138000", code: "000000" });
  assert.equal(stillDemo.code, "demo_code_rejected");
  const asked = await enabled.requestPhoneCode({ cc: "+82", phone: "010-1234-5678" });
  assert.equal(asked.signedIn, false);
  assert.deepEqual(mock.calls.find((call) => call[0] === "signInWithOtp")[1], {
    phone: "+821012345678",
    options: { shouldCreateUser: true },
  });
  assert.equal(mock.calls.some((call) => call[0] === "verifyOtp"), false);
});

test("WeChat, QQ, and unconfigured Kakao do not start OAuth", async () => {
  const mock = mockAuth();
  const service = createAuthService({
    config: readyConfig({
      social: {
        wechat: { configured: true },
        qq: { configured: true },
        kakao: { configured: false },
      },
    }),
    client: mock.client,
    location: vercel,
  });
  const wechat = await service.signInWithSocial("wechat");
  const qq = await service.signInWithSocial("qq");
  const kakao = await service.signInWithSocial("kakao");
  assert.equal(wechat.signedIn, false);
  assert.match(wechat.message, /微信/);
  assert.match(qq.message, /QQ/);
  assert.match(kakao.message, /Kakao/);
  assert.equal(mock.calls.some((call) => call[0] === "signInWithOAuth"), false);
});

test("configured Kakao redirects and does not mark the browser signed in", async () => {
  const mock = mockAuth({
    signInWithOAuth: async () => ({ data: { url: "https://exampleproject.supabase.co/auth/v1/authorize" }, error: null }),
  });
  const service = createAuthService({
    config: readyConfig({ social: { wechat: { configured: false }, qq: { configured: false }, kakao: { configured: true } } }),
    client: mock.client,
    location: vercel,
  });
  const result = await service.signInWithSocial("kakao");
  assert.equal(result.signedIn, false);
  assert.equal(result.status, "oauth_redirect");
  assert.equal(mock.calls[0][1].provider, "kakao");
  assert.equal(mock.calls[0][1].options.redirectTo, "https://korean-site-zhcn.vercel.app/auth/preview.html");
});

test("PKCE code and token_hash are redeemed only by consumeEmailLink; raw access tokens are not stored", async () => {
  const session = { user: { id: "user-1", email: "learner@example.com" } };
  const mock = mockAuth({
    exchangeCodeForSession: async () => ({ data: { session }, error: null }),
    verifyOtp: async () => ({ data: { session }, error: null }),
  });
  const service = createAuthService({ config: readyConfig(), client: mock.client, location: vercel });
  const recovery = await service.consumeEmailLink({
    href: "https://korean-site-zhcn.vercel.app/auth/recovery.html?code=one-time&sb_flow_id=flow-1",
    flow: "recovery",
  });
  assert.equal(recovery.status, "recovery_ready");
  assert.equal(recovery.clearAddressBar, true);
  assert.equal(recovery.clearedPath, "/auth/recovery.html");
  assert.deepEqual(mock.calls[0], ["exchangeCodeForSession", "one-time", { flowId: "flow-1" }]);
  const confirmed = await service.consumeEmailLink({
    href: "https://korean-site-zhcn.vercel.app/auth/preview.html?token_hash=hash-1&type=email",
    flow: "signup",
  });
  assert.equal(confirmed.signedIn, true);
  assert.equal(confirmed.recovery, false);
  assert.deepEqual(mock.calls[1][1], { token_hash: "hash-1", type: "email" });
  const leaked = await service.consumeEmailLink({
    href: "https://korean-site-zhcn.vercel.app/auth/preview.html#access_token=eyJleak&refresh_token=refresh",
    flow: "signup",
  });
  assert.equal(leaked.code, "implicit_token_rejected");
  assert.equal(leaked.signedIn, false);
  const failed = await service.consumeEmailLink({
    href: "https://korean-site-zhcn.vercel.app/auth/preview.html?error_code=otp_expired&error_description=hunter2",
    flow: "signup",
  });
  assert.equal(failed.signedIn, false);
  assert.equal(failed.code, "otp_expired");
  assert.equal(JSON.stringify(failed).includes("hunter2"), false);
  assert.equal(mock.calls.filter((call) => call[0] === "exchangeCodeForSession").length, 1);
});

test("password update requires a recovery session and rejects short passwords before the network", async () => {
  const mock = mockAuth({
    updateUser: async () => ({ data: { user: { id: "user-1", email: "learner@example.com" } }, error: null }),
  });
  const service = createAuthService({ config: readyConfig(), client: mock.client, location: vercel });
  const early = await service.completePasswordReset({ password: "correct-horse" });
  assert.equal(early.code, "recovery_session_missing");
  service.markRecoveryForLocalHarness();
  const weak = await service.completePasswordReset({ password: "short" });
  assert.equal(weak.code, "password_too_short");
  const updated = await service.completePasswordReset({ password: "correct-horse" });
  assert.equal(updated.status, "password_updated");
  assert.equal(mock.calls.filter((call) => call[0] === "updateUser").length, 1);
});

test("memory harness never sends mail and 000000 still fails", async () => {
  const memory = createMemoryAuthClient();
  const service = createAuthService({
    config: readyConfig({
      supabaseUrl: "https://local-harness.supabase.co",
      publishableKey: "sb_publishable_local_harness_only",
      customSmtpConfigured: true,
    }),
    client: memory.client,
    location: vercel,
  });
  const hooks = createLegacyAuthHooks(service);
  const registered = await hooks.registerWithEmail("learner@example.com", "correct-horse");
  assert.equal(registered.signedIn, false);
  assert.equal(registered.status, "confirmation_required");
  assert.equal(memory.outbox[0].transport, "memory");
  const premature = await hooks.signInWithEmail("learner@example.com", "correct-horse");
  assert.equal(premature.code, "email_not_confirmed");
  assert.equal(memory.confirmEmail("learner@example.com"), true);
  const signedIn = await hooks.signInWithEmail("learner@example.com", "correct-horse");
  assert.equal(signedIn.signedIn, true);
  const signedOut = await hooks.logoutAuth();
  assert.equal(signedOut.signedIn, false);
  const missing = await hooks.requestPasswordReset("missing@example.com");
  const present = await hooks.requestPasswordReset("learner@example.com");
  assert.equal(missing.ok, true);
  assert.equal(present.ok, true);
  assert.equal(memory.outbox.filter((item) => item.kind === "recovery").length, 1);
  assert.equal(memory.openRecovery("learner@example.com"), true);
  service.markRecoveryForLocalHarness();
  const updated = await service.completePasswordReset({ password: "another-horse" });
  assert.equal(updated.status, "password_updated");
  const phone = await hooks.loginWithPhone("+86", "13800138000", "000000");
  assert.equal(phone.signedIn, false);
  assert.equal(phone.code, "demo_code_rejected");
  assert.equal(memory.calls.some((call) => call[0] === "signInWithOtp" || call[0] === "verifyOtp"), false);
  const guest = hooks.enterAsGuest();
  assert.equal(guest.mode, "guest");
});

test("auth storage refuses the learning site keys", () => {
  const backing = {
    values: new Map(),
    getItem(key) { return this.values.get(key) ?? null; },
    setItem(key, value) { this.values.set(key, value); },
    removeItem(key) { this.values.delete(key); },
  };
  const storage = createIsolatedAuthStorage(backing);
  storage.setItem("korean-site-auth-session-code-verifier", "verifier");
  assert.equal(storage.getItem("korean-site-auth-session-code-verifier"), "verifier");
  assert.throws(() => storage.setItem("koreanSite_zhcn_draft_v01", "{}"), /refused_storage_key/);
  assert.equal(backing.values.has("koreanSite_zhcn_draft_v01"), false);
});

test("browser client factory uses PKCE and refuses a secret before loading the SDK", async () => {
  let loads = 0;
  const rejected = await createBrowserAuthClient(readyConfig({ publishableKey: "sb_secret_not_for_browser" }), {
    loadCreateClient: async () => { loads += 1; return { createClient() { throw new Error("should not construct"); } }; },
  });
  assert.equal(rejected.ok, false);
  assert.equal(loads, 0);
  let seen;
  const backing = {
    values: new Map(),
    getItem(key) { return this.values.get(key) ?? null; },
    setItem(key, value) { this.values.set(key, value); },
    removeItem(key) { this.values.delete(key); },
  };
  const created = await createBrowserAuthClient(readyConfig(), {
    storage: backing,
    loadCreateClient: async () => ({
      createClient(url, key, options) {
        seen = { url, key, options };
        return { auth: {} };
      },
    }),
  });
  assert.equal(created.ok, true);
  assert.equal(created.flowType, "pkce");
  assert.equal(seen.key, "sb_publishable_test_only");
  assert.equal(seen.options.auth.flowType, "pkce");
  assert.equal(seen.options.auth.detectSessionInUrl, false);
  assert.equal(seen.options.auth.storageKey, "korean-site-auth-session");
  assert.throws(() => seen.options.auth.storage.setItem("koreanSite_zhcn_draft_v01_accounts", "{}"));
});

test("source files ship no usable secret and keep the demo out of the home page", () => {
  const files = readdirSync(authDir).filter((name) => name.endsWith(".js") && name !== "public-config.example.js");
  const production = files.filter((name) => name !== "local-harness.js");
  for (const name of production) {
    const text = readFileSync(join(authDir, name), "utf8");
    const mayNameLearningKey = new Set(["storage-guard.js", "future-adapter.js"]);
    if (!mayNameLearningKey.has(name)) {
      assert.equal(text.includes("koreanSite_zhcn_draft_v01"), false, name);
    }
    assert.equal(/sb_secret_[a-z0-9]{8,}/i.test(text), false, name);
    const mayNameTheSecretRole = new Set(["config.js", "messages.js"]);
    assert.equal(text.includes("service_role"), mayNameTheSecretRole.has(name), name);
  }
  const preview = readFileSync(join(authDir, "preview.js"), "utf8");
  const previewHtml = readFileSync(join(authDir, "preview.html"), "utf8");
  assert.equal(preview.includes("index.html"), true);
  assert.equal(preview.includes("000000"), false);
  assert.equal(preview.includes("未接入"), false);
  assert.equal(preview.includes("演示登录"), false);
  assert.equal(preview.includes("Vercel"), false);
  assert.equal(preview.includes("GitHub Pages"), false);
  assert.match(preview, /邮箱和密码可以注册、登录/);
  assert.match(preview, /不会读取或上传/);
  assert.match(preview, /游客/);
  assert.match(preview, /自定义 SMTP/);
  assert.equal(preview.includes("auth-wechat"), false);
  assert.equal(preview.includes("auth-qq"), false);
  assert.equal(preview.includes("auth-kakao"), false);
  assert.equal(preview.includes("auth-sms-request"), false);
  assert.equal(preview.includes("auth-phone"), false);
  assert.equal(preview.includes("未接通"), false);
  assert.equal(previewHtml.includes("未接入"), false);
  assert.equal(previewHtml.includes("000000"), false);
  const home = readFileSync(join(dirname(authDir), "index.html"), "utf8");
  assert.match(home, /function bootEntry\(\) \{\n  authOpen = false;/);
  assert.equal(home.includes("supabase.co"), false);
  assert.equal(home.includes("sb_publishable_"), false);
  assert.equal(home.includes("sb_secret_"), false);
  assert.equal(home.includes("000000"), false);
  assert.equal(home.includes("DEMO_SMS_CODE"), false);
  assert.equal(home.includes("korean-site-auth-session"), true);
});
