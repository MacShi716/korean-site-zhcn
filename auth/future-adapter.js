/**
 * Retained helper for tests and reference; index.html does not load this file.
 *
 * The homepage now reads the real korean-site-auth-session directly. Do not
 * copy the guest learning snapshot into an account and do not upload
 * koreanSite_zhcn_draft_v01.
 */
export function createLegacyAuthHooks(service) {
  return {
    registerWithEmail(email, password) {
      return service.registerWithEmail({ email, password });
    },
    signInWithEmail(email, password) {
      return service.signInWithEmail({ email, password });
    },
    requestPasswordReset(email) {
      return service.requestPasswordReset({ email });
    },
    socialLogin(provider) {
      return service.signInWithSocial(provider);
    },
    logoutAuth() {
      return service.signOut();
    },
    enterAsGuest() {
      return service.continueAsGuest();
    },
    requestPhoneCode(cc, phone) {
      return service.requestPhoneCode({ cc, phone });
    },
    loginWithPhone(cc, phone, code) {
      return service.signInWithPhoneCode({ cc, phone, code });
    },
  };
}
