/**
 * In-memory Auth double for localhost?harness=1 and unit tests.
 * It never calls a network and never sends mail or SMS.
 */
export function createMemoryAuthClient() {
  const users = new Map();
  const listeners = new Set();
  const calls = [];
  const outbox = [];
  let current = null;
  let seq = 1;

  function emit(event, session) {
    for (const listener of listeners) listener(event, session);
  }

  function sessionFor(row, recovery = false) {
    return {
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: row.id, email: row.email, identities: [{ provider: "email" }] },
      recovery,
    };
  }

  const auth = {
    async signUp({ email, password, options }) {
      calls.push(["signUp", { email, hasPassword: typeof password === "string", options }]);
      const existing = users.get(email);
      if (existing?.confirmed) {
        return { data: { user: { id: existing.id, email, identities: [] }, session: null }, error: null };
      }
      const row = existing || { id: `mem-${seq++}`, email, password, confirmed: false };
      row.password = password;
      users.set(email, row);
      outbox.push({ kind: "signup", email, redirectTo: options?.emailRedirectTo || null, transport: "memory" });
      return { data: { user: { id: row.id, email, identities: [{ provider: "email" }] }, session: null }, error: null };
    },
    async signInWithPassword({ email, password }) {
      calls.push(["signInWithPassword", { email }]);
      const row = users.get(email);
      if (!row || row.password !== password) {
        return { data: { user: null, session: null }, error: { code: "invalid_credentials" } };
      }
      if (!row.confirmed) {
        return { data: { user: null, session: null }, error: { code: "email_not_confirmed" } };
      }
      current = sessionFor(row, false);
      emit("SIGNED_IN", current);
      return { data: { user: current.user, session: current }, error: null };
    },
    async signOut(options) {
      calls.push(["signOut", options || null]);
      current = null;
      emit("SIGNED_OUT", null);
      return { error: null };
    },
    async getUser() {
      calls.push(["getUser"]);
      if (!current?.user) return { data: { user: null }, error: { code: "session_not_found" } };
      return { data: { user: current.user }, error: null };
    },
    async getSession() {
      calls.push(["getSession"]);
      return { data: { session: current }, error: null };
    },
    async resetPasswordForEmail(email, options) {
      calls.push(["resetPasswordForEmail", { email, options }]);
      if (users.has(email)) {
        outbox.push({ kind: "recovery", email, redirectTo: options?.redirectTo || null, transport: "memory" });
      }
      return { data: {}, error: null };
    },
    async updateUser({ password }) {
      calls.push(["updateUser", { hasPassword: typeof password === "string" }]);
      if (!current?.recovery) return { data: { user: null }, error: { code: "session_not_found" } };
      const row = users.get(current.user.email);
      row.password = password;
      current = sessionFor(row, false);
      emit("USER_UPDATED", current);
      return { data: { user: current.user }, error: null };
    },
    async verifyOtp(args) {
      calls.push(["verifyOtp", { type: args?.type, phone: args?.phone || null, hasTokenHash: Boolean(args?.token_hash) }]);
      if (args?.type === "sms" || args?.token === "000000") {
        return { data: { user: null, session: null }, error: { code: "otp_expired" } };
      }
      return { data: { user: null, session: null }, error: { code: "otp_expired" } };
    },
    async exchangeCodeForSession(code, options) {
      calls.push(["exchangeCodeForSession", { hasCode: Boolean(code), flowId: options?.flowId || null }]);
      return { data: { session: null }, error: { code: "flow_state_not_found" } };
    },
    async signInWithOtp(args) {
      calls.push(["signInWithOtp", args]);
      return { data: null, error: { code: "sms_send_failed" } };
    },
    async signInWithOAuth(args) {
      calls.push(["signInWithOAuth", args]);
      return { data: { url: null }, error: { code: "provider_disabled" } };
    },
    onAuthStateChange(callback) {
      calls.push(["onAuthStateChange"]);
      listeners.add(callback);
      return { data: { subscription: { unsubscribe() { listeners.delete(callback); } } } };
    },
  };

  return {
    client: { auth },
    calls,
    outbox,
    confirmEmail(email) {
      const row = users.get(email);
      if (!row) return false;
      row.confirmed = true;
      return true;
    },
    openRecovery(email) {
      const row = users.get(email);
      if (!row) return false;
      row.confirmed = true;
      current = sessionFor(row, true);
      emit("PASSWORD_RECOVERY", current);
      return true;
    },
  };
}
