/**
 * Cloud sync is not implemented. Consent cannot upload anything in this draft.
 * Learning records, chat, and health-related data stay in the existing site keys.
 */
export function cloudSyncStatus(config) {
  return {
    enabled: false,
    implementation: "not_built",
    consentSeen: config?.cloudSyncConsent === true,
    uploadsLearningRecords: false,
    uploadsChat: false,
    uploadsHealth: false,
    migratesExistingLocalRecords: false,
  };
}
