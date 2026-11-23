/**
 * Not loaded by index.html.
 *
 * Later, the smallest hook is to replace the bodies of loginWithDemoCode,
 * socialLogin, logoutAuth, and enterAsGuest. Do not copy the guest snapshot
 * into the account, and do not upload koreanSite_zhcn_draft_v01.
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
