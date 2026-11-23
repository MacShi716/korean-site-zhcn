/** Session storage is isolated from the learning site's localStorage keys. */
export const AUTH_STORAGE_PREFIX = "korean-site-auth";

/** Existing site keys. This module refuses them and never migrates them. */
export const LEARNING_STORAGE_PREFIXES = ["koreanSite_zhcn_draft_v01"];

export function isAllowedAuthStorageKey(key) {
  const name = String(key);
  if (LEARNING_STORAGE_PREFIXES.some((prefix) => name.startsWith(prefix))) return false;
  return name.startsWith(AUTH_STORAGE_PREFIX);
}

export function createIsolatedAuthStorage(backing) {
  return {
    getItem(key) {
      if (!isAllowedAuthStorageKey(key)) return null;
      return backing.getItem(key);
    },
    setItem(key, value) {
      if (!isAllowedAuthStorageKey(key)) {
        throw new Error("refused_storage_key");
      }
      backing.setItem(key, value);
    },
    removeItem(key) {
      if (!isAllowedAuthStorageKey(key)) return;
      backing.removeItem(key);
    },
  };
}
