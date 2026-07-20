import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type KcAdminClient from "@keycloak/keycloak-admin-client";
import { z } from "zod";
import { cfg, connect, ok, readOnlyRefusal, Realm } from "./client.js";

const ScopeType = z.enum(["default", "optional"]);

async function resolveScope(kc: KcAdminClient, scopeId?: string, name?: string) {
  if (scopeId) return kc.clientScopes.findOne({ id: scopeId });
  if (name) return kc.clientScopes.findOneByName({ name });
  throw new Error("Provide either scopeId or name.");
}

/**
 * Register extra client-scope tools: get/update a scope, protocol-mapper CRUD on a scope, and the
 * realm-level default/optional client-scope lists. Same guardrails as the other write tools:
 * refuse in read-only mode, dry-run destructive removals unless confirm=true.
 */
export function registerClientScopeExtraTools(server: McpServer): void {
  server.tool(
    "kc_get_client_scope",
    "Get a client scope by id or name (includes protocol mappers).",
    { realm: Realm, scopeId: z.string().optional().describe("Scope uuid"), name: z.string().optional().describe("Exact scope name") },
    async ({ realm, scopeId, name }) => {
      const kc = await connect(realm);
      const s = await resolveScope(kc, scopeId, name);
      if (!s) return ok(null);
      return ok({
        id: s.id,
        name: s.name,
        protocol: s.protocol,
        description: s.description,
        attributes: s.attributes,
        protocolMappers: (s.protocolMappers ?? []).map((m) => ({ id: m.id, name: m.name, protocolMapper: m.protocolMapper })),
      });
    },
  );

  server.tool(
    "kc_update_client_scope",
    "Update a client scope's name/description/protocol/attributes (locate by scopeId or name).",
    {
      realm: Realm,
      scopeId: z.string().optional().describe("Scope uuid"),
      name: z.string().optional().describe("Exact current scope name (lookup when scopeId omitted)"),
      newName: z.string().optional(),
      description: z.string().optional(),
      protocol: z.string().optional(),
      includeInTokenScope: z.boolean().optional().describe("Advertise the scope name in the token 'scope' claim"),
      attributes: z.record(z.string()).optional().describe("Attribute overrides (merged into existing)"),
    },
    async ({ realm, scopeId, name, newName, description, protocol, includeInTokenScope, attributes }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const existing = await resolveScope(kc, scopeId, name);
      if (!existing?.id) return ok({ ok: false, error: "Client scope not found." });
      const mergedAttributes = { ...existing.attributes, ...attributes };
      if (includeInTokenScope !== undefined) mergedAttributes["include.in.token.scope"] = String(includeInTokenScope);
      await kc.clientScopes.update(
        { id: existing.id },
        {
          ...existing,
          name: newName ?? existing.name,
          description: description ?? existing.description,
          protocol: protocol ?? existing.protocol,
          attributes: mergedAttributes,
        },
      );
      return ok({ ok: true, id: existing.id, name: newName ?? existing.name });
    },
  );

  server.tool(
    "kc_list_scope_protocol_mappers",
    "List protocol mappers on a client scope.",
    { realm: Realm, scopeId: z.string().min(1).describe("Scope uuid"), max: z.number().int().positive().max(200).optional().describe("Max rows (default 50)") },
    async ({ realm, scopeId, max }) => {
      const kc = await connect(realm);
      const mappers = await kc.clientScopes.listProtocolMappers({ id: scopeId });
      return ok(
        mappers
          .slice(0, max ?? 50)
          .map((m) => ({ id: m.id, name: m.name, protocol: m.protocol, protocolMapper: m.protocolMapper, config: m.config })),
      );
    },
  );

  server.tool(
    "kc_create_scope_protocol_mapper",
    "Add a protocol mapper to a client scope.",
    {
      realm: Realm,
      scopeId: z.string().min(1).describe("Scope uuid"),
      name: z.string().min(1),
      protocolMapper: z.string().min(1).describe("Mapper type, e.g. oidc-usermodel-attribute-mapper"),
      protocol: z.string().optional().describe("Default openid-connect"),
      config: z.record(z.string()).optional().describe("Mapper config, e.g. claim.name, user.attribute, access.token.claim"),
    },
    async ({ realm, scopeId, name, protocolMapper, protocol, config }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      await kc.clientScopes.addProtocolMapper(
        { id: scopeId },
        { name, protocolMapper, protocol: protocol ?? "openid-connect", config: config ?? {} },
      );
      return ok({ ok: true, scopeId, mapper: name });
    },
  );

  server.tool(
    "kc_delete_scope_protocol_mapper",
    "Delete a protocol mapper from a client scope (destructive). Dry-run unless confirm=true.",
    {
      realm: Realm,
      scopeId: z.string().min(1).describe("Scope uuid"),
      mapperId: z.string().min(1).describe("Mapper uuid"),
      confirm: z.boolean().optional().describe("Must be true to actually delete"),
    },
    async ({ realm, scopeId, mapperId, confirm }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const mapper = await kc.clientScopes.findProtocolMapper({ id: scopeId, mapperId });
      if (!mapper) return ok({ ok: false, error: `Mapper '${mapperId}' not found on scope '${scopeId}'.` });
      if (!confirm) return ok({ ok: true, dryRun: true, scopeId, mapperId, mapper: mapper.name, note: "Pass confirm=true to delete." });
      await kc.clientScopes.delProtocolMapper({ id: scopeId, mapperId });
      return ok({ ok: true, deleted: mapperId, mapper: mapper.name });
    },
  );

  server.tool(
    "kc_list_realm_default_client_scopes",
    "List the realm's default and/or optional client scopes (assigned to new clients).",
    { realm: Realm, type: ScopeType.optional().describe("Filter to one list; omit for both"), max: z.number().int().positive().max(200).optional().describe("Max rows per list (default 50)") },
    async ({ realm, type, max }) => {
      const kc = await connect(realm);
      const limit = max ?? 50;
      const shape = (s: { id?: string; name?: string; protocol?: string }) => ({ id: s.id, name: s.name, protocol: s.protocol });
      const result: Record<string, unknown> = {};
      if (type !== "optional") result.default = (await kc.clientScopes.listDefaultClientScopes()).slice(0, limit).map(shape);
      if (type !== "default") result.optional = (await kc.clientScopes.listDefaultOptionalClientScopes()).slice(0, limit).map(shape);
      return ok(result);
    },
  );

  server.tool(
    "kc_add_realm_default_client_scope",
    "Add a client scope to the realm's default or optional list (locate by scopeId or name).",
    {
      realm: Realm,
      scopeId: z.string().optional().describe("Scope uuid"),
      name: z.string().optional().describe("Exact scope name (lookup when scopeId omitted)"),
      type: ScopeType.optional().describe("Which list; default 'default'"),
    },
    async ({ realm, scopeId, name, type }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const scope = await resolveScope(kc, scopeId, name);
      if (!scope?.id) return ok({ ok: false, error: "Client scope not found." });
      if (type === "optional") await kc.clientScopes.addDefaultOptionalClientScope({ id: scope.id });
      else await kc.clientScopes.addDefaultClientScope({ id: scope.id });
      return ok({ ok: true, id: scope.id, name: scope.name, list: type ?? "default" });
    },
  );

  server.tool(
    "kc_remove_realm_default_client_scope",
    "Remove a client scope from the realm's default or optional list (destructive). Dry-run unless confirm=true.",
    {
      realm: Realm,
      scopeId: z.string().optional().describe("Scope uuid"),
      name: z.string().optional().describe("Exact scope name (lookup when scopeId omitted)"),
      type: ScopeType.optional().describe("Which list; default 'default'"),
      confirm: z.boolean().optional().describe("Must be true to actually remove"),
    },
    async ({ realm, scopeId, name, type, confirm }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const scope = await resolveScope(kc, scopeId, name);
      if (!scope?.id) return ok({ ok: false, error: "Client scope not found." });
      const list = type ?? "default";
      if (!confirm) return ok({ ok: true, dryRun: true, id: scope.id, name: scope.name, list, note: "Pass confirm=true to remove." });
      if (list === "optional") await kc.clientScopes.delDefaultOptionalClientScope({ id: scope.id });
      else await kc.clientScopes.delDefaultClientScope({ id: scope.id });
      return ok({ ok: true, removed: scope.id, name: scope.name, list });
    },
  );
}
