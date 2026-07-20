import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cfg, connect, ok, readOnlyRefusal, Realm } from "./client.js";

/**
 * Register identity-provider administration tools — get/create/update/delete brokered IdPs and
 * their attribute mappers. Same guardrails as the other write tools: mutations refuse when
 * KEYCLOAK_MCP_READONLY is set, and each destructive delete is a dry-run unless confirm=true.
 * The read-side kc_list_identity_providers lives in read-tools and is not duplicated here.
 */
export function registerIdpTools(server: McpServer): void {
  server.tool(
    "kc_get_idp",
    "Get a single identity provider by alias (clientSecret masked).",
    { realm: Realm, alias: z.string().min(1).describe("IdP alias") },
    async ({ realm, alias }) => {
      const kc = await connect(realm);
      const idp = await kc.identityProviders.findOne({ alias });
      if (!idp) return ok(null);
      return ok({
        alias: idp.alias,
        providerId: idp.providerId,
        displayName: idp.displayName,
        enabled: idp.enabled,
        trustEmail: idp.trustEmail,
        storeToken: idp.storeToken,
        linkOnly: idp.linkOnly,
        hideOnLogin: idp.hideOnLogin,
        firstBrokerLoginFlowAlias: idp.firstBrokerLoginFlowAlias,
        postBrokerLoginFlowAlias: idp.postBrokerLoginFlowAlias,
        config: idp.config?.clientSecret ? { ...idp.config, clientSecret: "***" } : idp.config,
      });
    },
  );

  server.tool(
    "kc_create_idp",
    "Create an identity provider (e.g. oidc, saml, google, github).",
    {
      realm: Realm,
      alias: z.string().min(1).describe("Unique IdP alias"),
      providerId: z.string().min(1).describe("Provider type, e.g. 'oidc', 'saml', 'google', 'github'"),
      displayName: z.string().optional(),
      enabled: z.boolean().optional().describe("Default true"),
      trustEmail: z.boolean().optional().describe("Trust email from the IdP (default false)"),
      storeToken: z.boolean().optional().describe("Store the IdP token (default false)"),
      firstBrokerLoginFlowAlias: z.string().optional(),
      config: z.record(z.string(), z.string()).optional().describe("Provider config passthrough, e.g. clientId, clientSecret, authorizationUrl, tokenUrl, issuer"),
    },
    async ({ realm, alias, providerId, displayName, enabled, trustEmail, storeToken, firstBrokerLoginFlowAlias, config }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const created = await kc.identityProviders.create({
        alias,
        providerId,
        displayName,
        enabled: enabled ?? true,
        trustEmail: trustEmail ?? false,
        storeToken: storeToken ?? false,
        firstBrokerLoginFlowAlias,
        config,
      });
      return ok({ ok: true, id: created.id, alias, providerId });
    },
  );

  server.tool(
    "kc_update_idp",
    "Update an identity provider; config keys are merged into the existing config.",
    {
      realm: Realm,
      alias: z.string().min(1).describe("IdP alias"),
      displayName: z.string().optional(),
      enabled: z.boolean().optional(),
      trustEmail: z.boolean().optional(),
      storeToken: z.boolean().optional(),
      firstBrokerLoginFlowAlias: z.string().optional(),
      config: z.record(z.string(), z.string()).optional().describe("Config keys to merge, e.g. clientId, clientSecret, tokenUrl"),
    },
    async ({ realm, alias, displayName, enabled, trustEmail, storeToken, firstBrokerLoginFlowAlias, config }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const existing = await kc.identityProviders.findOne({ alias });
      if (!existing) return ok({ ok: false, error: `Identity provider '${alias}' not found.` });
      await kc.identityProviders.update(
        { alias },
        {
          ...existing,
          displayName: displayName ?? existing.displayName,
          enabled: enabled ?? existing.enabled,
          trustEmail: trustEmail ?? existing.trustEmail,
          storeToken: storeToken ?? existing.storeToken,
          firstBrokerLoginFlowAlias: firstBrokerLoginFlowAlias ?? existing.firstBrokerLoginFlowAlias,
          config: config ? { ...existing.config, ...config } : existing.config,
        },
      );
      return ok({ ok: true, alias });
    },
  );

  server.tool(
    "kc_delete_idp",
    "Delete an identity provider by alias (destructive). Dry-run unless confirm=true.",
    { realm: Realm, alias: z.string().min(1).describe("IdP alias"), confirm: z.boolean().optional().describe("Must be true to actually delete") },
    async ({ realm, alias, confirm }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const existing = await kc.identityProviders.findOne({ alias });
      if (!existing) return ok({ ok: false, error: `Identity provider '${alias}' not found.` });
      if (!confirm) return ok({ ok: true, dryRun: true, alias, providerId: existing.providerId, note: "Pass confirm=true to delete." });
      await kc.identityProviders.del({ alias });
      return ok({ ok: true, deleted: alias });
    },
  );

  server.tool(
    "kc_list_idp_mappers",
    "List mappers of an identity provider.",
    {
      realm: Realm,
      alias: z.string().min(1).describe("IdP alias"),
      max: z.number().int().positive().max(200).optional().describe("Max rows (default 50, cap 200)"),
    },
    async ({ realm, alias, max }) => {
      const kc = await connect(realm);
      const limit = Math.min(max ?? 50, 200);
      const mappers = await kc.identityProviders.findMappers({ alias });
      return ok(
        mappers
          .slice(0, limit)
          .map((m) => ({ id: m.id, name: m.name, identityProviderMapper: m.identityProviderMapper, config: m.config })),
      );
    },
  );

  server.tool(
    "kc_create_idp_mapper",
    "Create a mapper on an identity provider.",
    {
      realm: Realm,
      alias: z.string().min(1).describe("IdP alias"),
      name: z.string().min(1).describe("Mapper name"),
      mapperType: z.string().min(1).describe("Mapper type id, e.g. 'oidc-user-attribute-idp-mapper', 'hardcoded-attribute-idp-mapper'"),
      config: z.record(z.string(), z.string()).optional().describe("Mapper config, e.g. claim, user.attribute, syncMode"),
    },
    async ({ realm, alias, name, mapperType, config }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const created = await kc.identityProviders.createMapper({
        alias,
        identityProviderMapper: { name, identityProviderAlias: alias, identityProviderMapper: mapperType, config },
      });
      return ok({ ok: true, id: created.id, alias, name });
    },
  );

  server.tool(
    "kc_delete_idp_mapper",
    "Delete an identity-provider mapper by id (destructive). Dry-run unless confirm=true.",
    {
      realm: Realm,
      alias: z.string().min(1).describe("IdP alias"),
      mapperId: z.string().min(1).describe("Mapper id"),
      confirm: z.boolean().optional().describe("Must be true to actually delete"),
    },
    async ({ realm, alias, mapperId, confirm }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const existing = await kc.identityProviders.findOneMapper({ alias, id: mapperId });
      if (!existing) return ok({ ok: false, error: `Mapper '${mapperId}' not found on IdP '${alias}'.` });
      if (!confirm) return ok({ ok: true, dryRun: true, alias, mapperId, name: existing.name, note: "Pass confirm=true to delete." });
      await kc.identityProviders.delMapper({ alias, id: mapperId });
      return ok({ ok: true, deleted: mapperId, alias });
    },
  );
}
