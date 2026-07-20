import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cfg, connect, ok, readOnlyRefusal, Realm } from "./client.js";

type Kc = Awaited<ReturnType<typeof connect>>;

const ClientId = z.string().min(1).describe("Client clientId (not UUID)");
const Max = z.number().int().positive().optional().describe("Max results (default 50, cap 200)");

const cap = (max?: number) => Math.min(max ?? 50, 200);

async function findClientByClientId(kc: Kc, clientId: string) {
  const found = await kc.clients.find({ clientId });
  return found.find((c) => c.clientId === clientId);
}

async function findScopeByName(kc: Kc, name: string) {
  return kc.clientScopes.findOneByName({ name });
}

/**
 * Register client-management tools beyond create/delete — update, secrets, service accounts,
 * default/optional scope assignment (by scope NAME), protocol mappers, and client roles.
 * Same guardrails as the other write tools: read-only refusal on every mutation, and
 * confirm=true dry-run gating on destructive operations.
 */
export function registerClientExtraTools(server: McpServer): void {
  server.tool(
    "kc_update_client",
    "Update a client (merge: only provided fields change).",
    {
      realm: Realm,
      clientId: ClientId,
      enabled: z.boolean().optional(),
      name: z.string().optional(),
      description: z.string().optional(),
      redirectUris: z.array(z.string()).optional().describe("Replaces the full list when provided"),
      webOrigins: z.array(z.string()).optional().describe("Replaces the full list when provided"),
      standardFlowEnabled: z.boolean().optional(),
      implicitFlowEnabled: z.boolean().optional(),
      directAccessGrantsEnabled: z.boolean().optional(),
      serviceAccountsEnabled: z.boolean().optional(),
      publicClient: z.boolean().optional(),
    },
    async ({ realm, clientId, enabled, name, description, redirectUris, webOrigins, standardFlowEnabled, implicitFlowEnabled, directAccessGrantsEnabled, serviceAccountsEnabled, publicClient }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const client = await findClientByClientId(kc, clientId);
      if (!client?.id) return ok({ ok: false, error: `Client '${clientId}' not found.` });
      await kc.clients.update({ id: client.id }, {
        ...client,
        enabled: enabled ?? client.enabled,
        name: name ?? client.name,
        description: description ?? client.description,
        redirectUris: redirectUris ?? client.redirectUris,
        webOrigins: webOrigins ?? client.webOrigins,
        standardFlowEnabled: standardFlowEnabled ?? client.standardFlowEnabled,
        implicitFlowEnabled: implicitFlowEnabled ?? client.implicitFlowEnabled,
        directAccessGrantsEnabled: directAccessGrantsEnabled ?? client.directAccessGrantsEnabled,
        serviceAccountsEnabled: serviceAccountsEnabled ?? client.serviceAccountsEnabled,
        publicClient: publicClient ?? client.publicClient,
      });
      return ok({ ok: true, clientId, id: client.id });
    },
  );

  server.tool(
    "kc_get_client_secret",
    "Get the current secret of a confidential client.",
    { realm: Realm, clientId: ClientId },
    async ({ realm, clientId }) => {
      const kc = await connect(realm);
      const client = await findClientByClientId(kc, clientId);
      if (!client?.id) return ok({ ok: false, error: `Client '${clientId}' not found.` });
      const cred = await kc.clients.getClientSecret({ id: client.id });
      return ok({ ok: true, clientId, type: cred.type, secret: cred.value });
    },
  );

  server.tool(
    "kc_regenerate_client_secret",
    "Rotate a client's secret (destructive: old secret stops working). Dry-run unless confirm=true.",
    { realm: Realm, clientId: ClientId, confirm: z.boolean().optional().describe("Must be true to actually rotate") },
    async ({ realm, clientId, confirm }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const client = await findClientByClientId(kc, clientId);
      if (!client?.id) return ok({ ok: false, error: `Client '${clientId}' not found.` });
      if (!confirm) return ok({ ok: true, dryRun: true, clientId, note: "Pass confirm=true to rotate the secret; the old secret will be invalidated." });
      const cred = await kc.clients.generateNewClientSecret({ id: client.id });
      return ok({ ok: true, clientId, secret: cred.value });
    },
  );

  server.tool(
    "kc_get_service_account_user",
    "Get the service-account user of a client (serviceAccountsEnabled).",
    { realm: Realm, clientId: ClientId },
    async ({ realm, clientId }) => {
      const kc = await connect(realm);
      const client = await findClientByClientId(kc, clientId);
      if (!client?.id) return ok({ ok: false, error: `Client '${clientId}' not found.` });
      const user = await kc.clients.getServiceAccountUser({ id: client.id });
      return ok({ ok: true, clientId, user: { id: user.id, username: user.username, enabled: user.enabled } });
    },
  );

  server.tool(
    "kc_add_default_client_scope",
    "Attach a client scope (by name) as a DEFAULT scope of a client.",
    { realm: Realm, clientId: ClientId, scopeName: z.string().min(1).describe("Client scope name") },
    async ({ realm, clientId, scopeName }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const client = await findClientByClientId(kc, clientId);
      if (!client?.id) return ok({ ok: false, error: `Client '${clientId}' not found.` });
      const scope = await findScopeByName(kc, scopeName);
      if (!scope?.id) return ok({ ok: false, error: `Client scope '${scopeName}' not found.` });
      await kc.clients.addDefaultClientScope({ id: client.id, clientScopeId: scope.id });
      return ok({ ok: true, clientId, scope: scopeName, kind: "default" });
    },
  );

  server.tool(
    "kc_remove_default_client_scope",
    "Detach a DEFAULT client scope (by name) from a client.",
    { realm: Realm, clientId: ClientId, scopeName: z.string().min(1).describe("Client scope name") },
    async ({ realm, clientId, scopeName }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const client = await findClientByClientId(kc, clientId);
      if (!client?.id) return ok({ ok: false, error: `Client '${clientId}' not found.` });
      const scope = await findScopeByName(kc, scopeName);
      if (!scope?.id) return ok({ ok: false, error: `Client scope '${scopeName}' not found.` });
      await kc.clients.delDefaultClientScope({ id: client.id, clientScopeId: scope.id });
      return ok({ ok: true, clientId, removed: scopeName, kind: "default" });
    },
  );

  server.tool(
    "kc_add_optional_client_scope",
    "Attach a client scope (by name) as an OPTIONAL scope of a client.",
    { realm: Realm, clientId: ClientId, scopeName: z.string().min(1).describe("Client scope name") },
    async ({ realm, clientId, scopeName }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const client = await findClientByClientId(kc, clientId);
      if (!client?.id) return ok({ ok: false, error: `Client '${clientId}' not found.` });
      const scope = await findScopeByName(kc, scopeName);
      if (!scope?.id) return ok({ ok: false, error: `Client scope '${scopeName}' not found.` });
      await kc.clients.addOptionalClientScope({ id: client.id, clientScopeId: scope.id });
      return ok({ ok: true, clientId, scope: scopeName, kind: "optional" });
    },
  );

  server.tool(
    "kc_remove_optional_client_scope",
    "Detach an OPTIONAL client scope (by name) from a client.",
    { realm: Realm, clientId: ClientId, scopeName: z.string().min(1).describe("Client scope name") },
    async ({ realm, clientId, scopeName }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const client = await findClientByClientId(kc, clientId);
      if (!client?.id) return ok({ ok: false, error: `Client '${clientId}' not found.` });
      const scope = await findScopeByName(kc, scopeName);
      if (!scope?.id) return ok({ ok: false, error: `Client scope '${scopeName}' not found.` });
      await kc.clients.delOptionalClientScope({ id: client.id, clientScopeId: scope.id });
      return ok({ ok: true, clientId, removed: scopeName, kind: "optional" });
    },
  );

  server.tool(
    "kc_list_client_protocol_mappers",
    "List protocol mappers of a client.",
    { realm: Realm, clientId: ClientId, max: Max },
    async ({ realm, clientId, max }) => {
      const kc = await connect(realm);
      const client = await findClientByClientId(kc, clientId);
      if (!client?.id) return ok({ ok: false, error: `Client '${clientId}' not found.` });
      const mappers = await kc.clients.listProtocolMappers({ id: client.id });
      return ok(mappers.slice(0, cap(max)).map((m) => ({ id: m.id, name: m.name, protocol: m.protocol, protocolMapper: m.protocolMapper, config: m.config })));
    },
  );

  server.tool(
    "kc_create_client_protocol_mapper",
    "Create a protocol mapper on a client (config passed through as-is).",
    {
      realm: Realm,
      clientId: ClientId,
      name: z.string().min(1),
      protocolMapper: z.string().min(1).describe("Mapper type, e.g. oidc-usermodel-attribute-mapper"),
      protocol: z.string().optional().describe("Default openid-connect"),
      config: z.record(z.string()).optional().describe("Mapper config, e.g. {\"claim.name\":\"x\",\"access.token.claim\":\"true\"}"),
    },
    async ({ realm, clientId, name, protocolMapper, protocol, config }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const client = await findClientByClientId(kc, clientId);
      if (!client?.id) return ok({ ok: false, error: `Client '${clientId}' not found.` });
      await kc.clients.addProtocolMapper({ id: client.id }, { name, protocolMapper, protocol: protocol ?? "openid-connect", config });
      return ok({ ok: true, clientId, mapper: name });
    },
  );

  server.tool(
    "kc_delete_client_protocol_mapper",
    "Delete a protocol mapper (by name) from a client (destructive). Dry-run unless confirm=true.",
    { realm: Realm, clientId: ClientId, mapperName: z.string().min(1), confirm: z.boolean().optional().describe("Must be true to actually delete") },
    async ({ realm, clientId, mapperName, confirm }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const client = await findClientByClientId(kc, clientId);
      if (!client?.id) return ok({ ok: false, error: `Client '${clientId}' not found.` });
      const mapper = await kc.clients.findProtocolMapperByName({ id: client.id, name: mapperName });
      if (!mapper?.id) return ok({ ok: false, error: `Protocol mapper '${mapperName}' not found on client '${clientId}'.` });
      if (!confirm) return ok({ ok: true, dryRun: true, clientId, mapper: mapperName, mapperId: mapper.id, note: "Pass confirm=true to delete." });
      await kc.clients.delProtocolMapper({ id: client.id, mapperId: mapper.id });
      return ok({ ok: true, clientId, deleted: mapperName });
    },
  );

  server.tool(
    "kc_list_client_roles",
    "List roles defined on a client.",
    { realm: Realm, clientId: ClientId, max: Max },
    async ({ realm, clientId, max }) => {
      const kc = await connect(realm);
      const client = await findClientByClientId(kc, clientId);
      if (!client?.id) return ok({ ok: false, error: `Client '${clientId}' not found.` });
      const roles = await kc.clients.listRoles({ id: client.id });
      return ok(roles.slice(0, cap(max)).map((r) => ({ id: r.id, name: r.name, description: r.description, composite: r.composite })));
    },
  );
}
