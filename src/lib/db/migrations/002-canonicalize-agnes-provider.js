// Migration 002: Canonicalize "agnes-ai" provider identifier to official "agnes"
// Updates existing provider connections, usage history, and request details.
export default {
  version: 2,
  name: "canonicalize-agnes-provider",
  up(db) {
    db.exec(`
      UPDATE providerConnections SET provider = 'agnes' WHERE provider = 'agnes-ai';
      UPDATE usageHistory SET provider = 'agnes' WHERE provider = 'agnes-ai';
      UPDATE requestDetails SET provider = 'agnes' WHERE provider = 'agnes-ai';
    `);
  },
};
