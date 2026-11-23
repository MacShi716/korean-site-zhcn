/**
 * Copy the field names into public-config.js. Do not commit a secret key.
 * customSmtpConfigured / smsProviderConfigured / social.*.configured stay false
 * until that provider is really set up. Setting one to true allows the browser
 * to call the matching Auth API, which can send mail or start an OAuth redirect.
 */
export const publicConfig = {
  supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
  supabasePublishableKey: "sb_publishable_REPLACE_ME",
  customSmtpConfigured: false,
  smsProviderConfigured: false,
  social: {
    wechat: { configured: false },
    qq: { configured: false },
    kakao: { configured: false },
  },
  cloudSyncConsent: false,
};
