import { assessPublicConfig, publishableKeyOf } from "./config.js";
import { createIsolatedAuthStorage } from "./storage-guard.js";

export const SUPABASE_JS_VERSION = "2.119.2";
export const SUPABASE_JS_URL = `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${SUPABASE_JS_VERSION}/+esm`;
export const AUTH_STORAGE_KEY = "korean-site-auth-session";

export async function loadSupabaseCreateClient() {
  return import(SUPABASE_JS_URL);
}

/**
 * Browser client. PKCE is exchanged in this page with exchangeCodeForSession.
 * detectSessionInUrl stays off so a mail scanner does not consume the one-time code on load.
 */
export async function createBrowserAuthClient(config, deps = {}) {
  const verdict = assessPublicConfig(config);
  if (!verdict.ok) return { ok: false, client: null, blockers: verdict.blockers.map((item) => item.code) };
  const load = deps.loadCreateClient || loadSupabaseCreateClient;
  const mod = await load();
  const storage = createIsolatedAuthStorage(deps.storage || globalThis.localStorage);
  const client = mod.createClient(config.supabaseUrl, publishableKeyOf(config), {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce",
      storageKey: AUTH_STORAGE_KEY,
      storage,
    },
  });
  return { ok: true, client, flowType: "pkce" };
}
