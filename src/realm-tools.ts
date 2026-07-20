import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cfg, connect, ok, readOnlyRefusal, Realm } from "./client.js";

/**
 * Register realm-administration tools — realm CRUD, events config, cache clearing, realm keys,
 * and server info. Same guardrails as the other write modules: every mutating tool refuses when
 * KEYCLOAK_MCP_READONLY is set, and each destructive action is a dry-run unless confirm=true.
 */
export function registerRealmTools(server: McpServer): void {
  // -------------------------------------------------------------- realm CRUD
  server.tool(
    "kc_create_realm",
    "Create a new realm.",
    {
      realm: Realm,
      enabled: z.boolean().optional().describe("Default true"),
      displayName: z.string().optional(),
    },
    async ({ realm, enabled, displayName }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(cfg.authRealm);
      const created = await kc.realms.create({ realm, enabled: enabled ?? true, displayName });
      return ok({ ok: true, realm: created.realmName });
    },
  );

  server.tool(
    "kc_update_realm",
    "Update realm settings (partial RealmRepresentation passthrough).",
    {
      realm: Realm,
      settings: z.record(z.unknown()).describe("RealmRepresentation fields to apply, e.g. {\"registrationAllowed\": true}"),
    },
    async ({ realm, settings }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      await kc.realms.update({ realm }, settings as Parameters<typeof kc.realms.update>[1]);
      return ok({ ok: true, realm, applied: Object.keys(settings) });
    },
  );

  server.tool(
    "kc_delete_realm",
    "Delete a realm and everything in it (destructive). Dry-run unless confirm=true.",
    { realm: Realm, confirm: z.boolean().optional().describe("Must be true to actually delete") },
    async ({ realm, confirm }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(cfg.authRealm);
      const found = await kc.realms.findOne({ realm });
      if (!found) return ok({ ok: false, error: `Realm '${realm}' not found.` });
      if (!confirm) return ok({ ok: true, dryRun: true, realm, note: "Pass confirm=true to delete." });
      await kc.realms.del({ realm });
      return ok({ ok: true, deleted: realm });
    },
  );

  // -------------------------------------------------------------- events config
  server.tool(
    "kc_get_realm_events_config",
    "Get a realm's login/admin event logging configuration.",
    { realm: Realm },
    async ({ realm }) => {
      const kc = await connect(realm);
      return ok(await kc.realms.getConfigEvents({ realm }));
    },
  );

  server.tool(
    "kc_update_realm_events_config",
    "Update a realm's event logging config (only provided fields change).",
    {
      realm: Realm,
      eventsEnabled: z.boolean().optional().describe("Store login events"),
      eventsExpiration: z.number().int().nonnegative().optional().describe("Login event retention (seconds)"),
      eventsListeners: z.array(z.string()).optional().describe("Event listener ids, e.g. ['jboss-logging']"),
      enabledEventTypes: z.array(z.string()).optional().describe("Event types to store (empty = all)"),
      adminEventsEnabled: z.boolean().optional().describe("Store admin events"),
      adminEventsDetailsEnabled: z.boolean().optional().describe("Include representation in admin events"),
    },
    async ({ realm, eventsEnabled, eventsExpiration, eventsListeners, enabledEventTypes, adminEventsEnabled, adminEventsDetailsEnabled }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const current = await kc.realms.getConfigEvents({ realm });
      const merged = {
        ...current,
        ...(eventsEnabled !== undefined && { eventsEnabled }),
        ...(eventsExpiration !== undefined && { eventsExpiration }),
        ...(eventsListeners !== undefined && { eventsListeners }),
        ...(enabledEventTypes !== undefined && { enabledEventTypes }),
        ...(adminEventsEnabled !== undefined && { adminEventsEnabled }),
        ...(adminEventsDetailsEnabled !== undefined && { adminEventsDetailsEnabled }),
      };
      await kc.realms.updateConfigEvents({ realm }, merged);
      return ok({ ok: true, realm, config: merged });
    },
  );

  // -------------------------------------------------------------- caches
  server.tool(
    "kc_clear_realm_cache",
    "Clear the server-side realm cache (destructive-ish). Dry-run unless confirm=true.",
    { realm: Realm, confirm: z.boolean().optional().describe("Must be true to actually clear") },
    async ({ realm, confirm }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      if (!confirm) return ok({ ok: true, dryRun: true, realm, note: "Pass confirm=true to clear the realm cache." });
      const kc = await connect(realm);
      await kc.cache.clearRealmCache({ realm });
      return ok({ ok: true, cleared: "realm-cache", realm });
    },
  );

  server.tool(
    "kc_clear_user_cache",
    "Clear the server-side user cache (destructive-ish). Dry-run unless confirm=true.",
    { realm: Realm, confirm: z.boolean().optional().describe("Must be true to actually clear") },
    async ({ realm, confirm }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      if (!confirm) return ok({ ok: true, dryRun: true, realm, note: "Pass confirm=true to clear the user cache." });
      const kc = await connect(realm);
      await kc.cache.clearUserCache({ realm });
      return ok({ ok: true, cleared: "user-cache", realm });
    },
  );

  // -------------------------------------------------------------- keys / server info
  server.tool(
    "kc_get_realm_keys",
    "List a realm's active key metadata (no key material blobs).",
    { realm: Realm, max: z.number().int().positive().max(200).optional().describe("Max keys (default 50)") },
    async ({ realm, max }) => {
      const kc = await connect(realm);
      const meta = await kc.realms.getKeys({ realm });
      const keys = meta.keys ?? [];
      return ok({
        active: meta.active,
        total: keys.length,
        keys: keys.slice(0, max ?? 50).map((k) => ({
          kid: k.kid,
          type: k.type,
          algorithm: k.algorithm,
          status: k.status,
          providerId: k.providerId,
          providerPriority: k.providerPriority,
          validTo: k.validTo,
        })),
      });
    },
  );

  server.tool("kc_get_server_info", "Get Keycloak server info (version, features, themes).", {}, async () => {
    const kc = await connect(cfg.authRealm);
    const info = await kc.serverInfo.find();
    return ok({
      systemInfo: info.systemInfo,
      memoryInfo: info.memoryInfo,
      profileInfo: info.profileInfo,
      features: (info.features ?? []).map((f) => ({ name: f.name, type: f.type, enabled: f.enabled })),
      themes: Object.keys(info.themes ?? {}),
    });
  });
}
