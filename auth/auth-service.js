import { assessPublicConfig, describeEmailPolicy, normalizeEmail, passwordIssue } from "./config.js";
import { mapAuthError } from "./errors.js";
import { userMessage, socialBlockedMessage } from "./messages.js";
import { addressWithoutAuthParams, authPageUrl, readAuthParams } from "./paths.js";
import { cloudSyncStatus } from "./privacy.js";
import { isRejectedDemoCode, normalizePhone } from "./phone.js";

const EMAIL_OTP_TYPES = new Set(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);
const BUILTIN_SOCIAL = new Set(["kakao"]);

function publicUser(user) {
  if (!user || typeof user !== "object") return null;
  return { id: user.id || null, email: user.email || null };
}

function blocked(code, extra = {}) {
  return {
    ok: false,
    status: "blocked",
    code,
    message: extra.message || userMessage(code),
    signedIn: false,
    ...extra,
    ok: false,
    signedIn: false,
  };
}

export function createAuthService({ config, client, location, loadAuthSettings }) {
  let recoveryReady = false;
  let settingsCache = null;

  async function currentSettings() {
    if (settingsCache) return settingsCache;
    if (typeof loadAuthSettings === "function") {
      settingsCache = await loadAuthSettings();
    } else     if (typeof config?.mailerAutoconfirm === "boolean") {
      settingsCache = { mailerAutoconfirm: config.mailerAutoconfirm };
    } else {
      settingsCache = { mailerAutoconfirm: false, unspecified: true };
    }
    return settingsCache;
  }

  function emailPolicyFrom(settings) {
    return describeEmailPolicy({
      customSmtpConfigured: config?.customSmtpConfigured,
      mailerAutoconfirm: settings?.mailerAutoconfirm,
    });
  }

  function gate() {
    const verdict = assessPublicConfig(config);
    if (verdict.ok) return null;
    const first = verdict.blockers[0]?.code || "missing_url";
    return blocked(first, {
      blockers: verdict.blockers.map((item) => item.code),
      message: verdict.blockers.map((item) => userMessage(item.code)).join(" "),
    });
  }

  function requireClient() {
    const stopped = gate();
    if (stopped) return stopped;
    if (!client?.auth) return blocked("auth_client_missing");
    return null;
  }

  function redirectFor(page) {
    const url = authPageUrl(location, page);
    if (!url) return blocked("bad_url", { message: "无法计算这个页面的回跳地址。没有提交。" });
    return url;
  }

  function viewFromSession(session, status) {
    const user = publicUser(session?.user);
    if (!user?.id) return blocked("auth_request_failed");
    return {
      ok: true,
      status,
      signedIn: true,
      mode: "email",
      user,
      recovery: recoveryReady,
      cloudSync: cloudSyncStatus(config),
      message: userMessage(status === "recovery_ready" ? "recovery_ready" : "signed_in"),
    };
  }

  return {
    availability() {
      const verdict = assessPublicConfig(config);
      const emailPolicy = emailPolicyFrom(settingsCache || { mailerAutoconfirm: config?.mailerAutoconfirm });
      return {
        emailPasswordLogin: verdict.ok,
        emailDelivery: verdict.emailDeliveryReady,
        emailPolicy: emailPolicy.mode,
        phoneSms: verdict.smsReady,
        kakao: verdict.kakaoReady,
        wechat: false,
        qq: false,
        guest: true,
        cloudSync: verdict.cloudSync,
        blockers: verdict.blockers.map((item) => item.code),
        flowType: "pkce",
        autoOpenLogin: false,
      };
    },

    async refreshEmailPolicy() {
      const settings = await currentSettings();
      return emailPolicyFrom(settings);
    },

    continueAsGuest() {
      recoveryReady = false;
      return {
        ok: true,
        status: "guest",
        signedIn: false,
        mode: "guest",
        user: null,
        cloudSync: cloudSyncStatus(config),
        message: userMessage("guest"),
      };
    },

    attachListener(handler) {
      const stopped = requireClient();
      if (stopped) return { unsubscribe() {} };
      const { data } = client.auth.onAuthStateChange((event, session) => {
        if (event === "PASSWORD_RECOVERY") recoveryReady = true;
        if (event === "SIGNED_OUT") recoveryReady = false;
        handler({
          event,
          recovery: recoveryReady,
          user: publicUser(session?.user),
        });
      });
      return data?.subscription || { unsubscribe() {} };
    },

    async restoreSession() {
      const stopped = requireClient();
      if (stopped) return { ...stopped, mode: "guest" };
      try {
        const { data, error } = await client.auth.getUser();
        if (error && mapAuthError(error).code === "network_error") {
          return { ...mapAuthError(error), mode: "unknown" };
        }
        const user = publicUser(data?.user);
        if (error || !user?.id) {
          return { ok: true, status: "signed_out", signedIn: false, mode: "guest", user: null, message: userMessage("signed_out") };
        }
        return {
          ok: true,
          status: recoveryReady ? "recovery_ready" : "signed_in",
          signedIn: true,
          mode: "email",
          user,
          recovery: recoveryReady,
          cloudSync: cloudSyncStatus(config),
          message: userMessage(recoveryReady ? "recovery_ready" : "signed_in"),
        };
      } catch (error) {
        return { ...mapAuthError(error), mode: "unknown" };
      }
    },

    async registerWithEmail({ email, password }) {
      const normalized = normalizeEmail(email);
      if (!normalized) return blocked("email_invalid");
      const passwordCode = passwordIssue(password);
      if (passwordCode) return blocked(passwordCode);
      const stopped = requireClient();
      if (stopped) return stopped;
      const policy = emailPolicyFrom(await currentSettings());
      const redirectTo = redirectFor("preview");
      if (typeof redirectTo !== "string") return redirectTo;
      const { data, error } = await client.auth.signUp({
        email: normalized,
        password,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) return mapAuthError(error);
      const sessionUser = publicUser(data?.session?.user || (data?.session ? data?.user : null));
      if (data?.session && sessionUser?.id) {
        recoveryReady = false;
        const signed = viewFromSession({ user: sessionUser }, "signed_in");
        if (policy.mode === "autoconfirm_without_smtp") signed.message = userMessage("signed_in_autoconfirm");
        signed.emailPolicy = policy.mode;
        return signed;
      }
      const identities = data?.user?.identities;
      return {
        ok: true,
        status: "confirmation_required",
        signedIn: false,
        mode: "email",
        user: null,
        accountMayAlreadyExist: Array.isArray(identities) && identities.length === 0,
        cloudSync: cloudSyncStatus(config),
        emailPolicy: policy.mode,
        message: userMessage(policy.mode === "builtin_admin_only" ? "builtin_admin_only" : "confirmation_required"),
      };
    },

    async signInWithEmail({ email, password }) {
      const normalized = normalizeEmail(email);
      if (!normalized) return blocked("email_invalid");
      if (typeof password !== "string" || password.length === 0) return blocked("password_required");
      const stopped = requireClient();
      if (stopped) return stopped;
      const { data, error } = await client.auth.signInWithPassword({ email: normalized, password });
      if (error) return mapAuthError(error);
      if (!data?.session) return blocked("email_not_confirmed");
      recoveryReady = false;
      return viewFromSession(data.session, "signed_in");
    },

    async signOut() {
      const stopped = requireClient();
      if (stopped) return stopped;
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) return mapAuthError(error);
      recoveryReady = false;
      return { ok: true, status: "signed_out", signedIn: false, mode: "guest", user: null, message: userMessage("signed_out") };
    },

    async requestPasswordReset({ email }) {
      const normalized = normalizeEmail(email);
      if (!normalized) return blocked("email_invalid");
      const stopped = requireClient();
      if (stopped) return stopped;
      const policy = emailPolicyFrom(await currentSettings());
      const redirectTo = redirectFor("recovery");
      if (typeof redirectTo !== "string") return redirectTo;
      const { error } = await client.auth.resetPasswordForEmail(normalized, { redirectTo });
      if (error) return mapAuthError(error);
      const messageKey = policy.mode === "builtin_admin_only"
        ? "reset_builtin_admin"
        : (policy.mode === "autoconfirm_without_smtp" ? "reset_pending_smtp" : "reset_requested");
      return {
        ok: true,
        status: "reset_requested",
        signedIn: false,
        emailPolicy: policy.mode,
        message: userMessage(messageKey),
      };
    },

    async completePasswordReset({ password }) {
      if (!recoveryReady) return blocked("recovery_session_missing");
      const passwordCode = passwordIssue(password);
      if (passwordCode) return blocked(passwordCode);
      const stopped = requireClient();
      if (stopped) return stopped;
      const { data, error } = await client.auth.updateUser({ password });
      if (error) return mapAuthError(error);
      recoveryReady = false;
      return {
        ok: true,
        status: "password_updated",
        signedIn: Boolean(publicUser(data?.user)?.id),
        mode: "email",
        user: publicUser(data?.user),
        cloudSync: cloudSyncStatus(config),
        message: userMessage("password_updated"),
      };
    },

    /**
     * Redeem a PKCE code or a token_hash in the browser.
     * The page calls this from a button so a mail scanner's GET does not consume the link.
     */
    async consumeEmailLink({ href, flow }) {
      const params = readAuthParams(href);
      const clearAddressBar = Boolean(params.code || params.tokenHash || params.error || params.errorCode || params.hasImplicitAccessToken);
      const clearedPath = addressWithoutAuthParams(href);
      if (params.hasImplicitAccessToken && !params.code && !params.tokenHash) {
        return { ...blocked("implicit_token_rejected"), clearAddressBar, clearedPath };
      }
      if (params.error || params.errorCode) {
        const mapped = mapAuthError({ code: params.errorCode || params.error });
        return { ...mapped, clearAddressBar, clearedPath };
      }
      if (!params.code && !params.tokenHash) {
        return { ok: true, status: "no_callback", signedIn: false, clearAddressBar: false, message: userMessage("no_callback") };
      }
      const stopped = requireClient();
      if (stopped) return { ...stopped, clearAddressBar, clearedPath };
      if (params.tokenHash) {
        if (!EMAIL_OTP_TYPES.has(params.type)) {
          return { ...blocked("invalid_callback"), clearAddressBar, clearedPath };
        }
        const { data, error } = await client.auth.verifyOtp({ token_hash: params.tokenHash, type: params.type });
        if (error) return { ...mapAuthError(error), clearAddressBar, clearedPath };
        if (!data?.session?.user) return { ...blocked("auth_request_failed"), clearAddressBar, clearedPath };
        recoveryReady = params.type === "recovery";
        const status = recoveryReady ? "recovery_ready" : "signed_in";
        return { ...viewFromSession(data.session, status), clearAddressBar, clearedPath };
      }
      const exchangeOptions = params.flowId ? { flowId: params.flowId } : undefined;
      const { data, error } = exchangeOptions
        ? await client.auth.exchangeCodeForSession(params.code, exchangeOptions)
        : await client.auth.exchangeCodeForSession(params.code);
      if (error) return { ...mapAuthError(error), clearAddressBar, clearedPath };
      recoveryReady = flow === "recovery" || params.type === "recovery";
      const session = data?.session || null;
      if (!session?.user) return { ...blocked("auth_request_failed"), clearAddressBar, clearedPath };
      const status = recoveryReady ? "recovery_ready" : "signed_in";
      return { ...viewFromSession(session, status), clearAddressBar, clearedPath };
    },

    async requestPhoneCode({ cc, phone }) {
      const normalized = normalizePhone(cc, phone);
      if (!normalized.ok) return blocked("phone_invalid");
      const stopped = requireClient();
      if (stopped) return stopped;
      const verdict = assessPublicConfig(config);
      if (!verdict.smsReady) return blocked("sms_provider_not_configured");
      const { error } = await client.auth.signInWithOtp({ phone: normalized.e164, options: { shouldCreateUser: true } });
      if (error) return mapAuthError(error);
      return {
        ok: true,
        status: "sms_requested",
        signedIn: false,
        message: "如果短信服务商接受这个号码，验证码会由短信商发出。这不是演示码。",
      };
    },

    async signInWithPhoneCode({ cc, phone, code }) {
      if (isRejectedDemoCode(code)) return blocked("demo_code_rejected");
      const normalized = normalizePhone(cc, phone);
      if (!normalized.ok) return blocked("phone_invalid");
      const token = String(code || "").trim();
      if (!/^\d{6,10}$/.test(token)) return blocked("invalid_callback", { message: "请填写短信服务商发来的验证码。000000 不会被接受。" });
      const stopped = requireClient();
      if (stopped) return stopped;
      const verdict = assessPublicConfig(config);
      if (!verdict.smsReady) return blocked("sms_provider_not_configured");
      const { data, error } = await client.auth.verifyOtp({ phone: normalized.e164, token, type: "sms" });
      if (error) return mapAuthError(error);
      const session = data?.session || null;
      if (!session?.user) return blocked("auth_request_failed");
      recoveryReady = false;
      return viewFromSession(session, "signed_in");
    },

    async signInWithSocial(provider) {
      if (provider === "wechat" || provider === "qq" || !BUILTIN_SOCIAL.has(provider)) {
        return blocked(provider === "kakao" ? "provider_disabled" : "oauth_provider_not_supported", {
          message: socialBlockedMessage(provider),
        });
      }
      const stopped = requireClient();
      if (stopped) return { ...stopped, message: socialBlockedMessage(provider) };
      const verdict = assessPublicConfig(config);
      if (!verdict.kakaoReady) {
        return blocked("provider_disabled", { message: socialBlockedMessage("kakao") });
      }
      const redirectTo = redirectFor("preview");
      if (typeof redirectTo !== "string") return redirectTo;
      const { data, error } = await client.auth.signInWithOAuth({
        provider: "kakao",
        options: { redirectTo, skipBrowserRedirect: false },
      });
      if (error) return mapAuthError(error);
      return {
        ok: true,
        status: "oauth_redirect",
        signedIn: false,
        provider: "kakao",
        url: data?.url || null,
        message: "正在转到 Kakao。完成前还没有登录。",
      };
    },

    markRecoveryForLocalHarness() {
      recoveryReady = true;
    },
  };
}
