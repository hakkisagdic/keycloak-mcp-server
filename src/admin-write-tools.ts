import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cfg, connect, ok, readOnlyRefusal, Realm } from "./client.js";

/**
 * Register mutating tools for realm-level resources OTHER than users — clients, realm roles,
 * groups, and client scopes. Same guardrails as the user write tools: every tool refuses when
 * KEYCLOAK_MCP_READONLY is set, and each destructive delete is a dry-run unless confirm=true.
 */
export function registerAdminWriteTools(server: McpServer): void {
  // ---- clients ----
  server.tool(
    "kc_create_client",
    "Create an OIDC client in a realm.",
    {
      realm: Realm,
      clientId: z.string().min(1),
      name: z.string().optional(),
      description: z.string().optional(),
      enabled: z.boolean().optional().describe("Default true"),
      publicClient: z.boolean().optional().describe("Public (no secret) vs confidential; default confidential"),
      standardFlowEnabled: z.boolean().optional().describe("Authorization Code flow (default true)"),
      directAccessGrantsEnabled: z.boolean().optional().describe("Resource-owner password grant (default false)"),
      serviceAccountsEnabled: z.boolean().optional().describe("Client-credentials service account (default false)"),
      redirectUris: z.array(z.string()).optional(),
      rootUrl: z.string().optional(),
    },
    async ({ realm, clientId, name, description, enabled, publicClient, standardFlowEnabled, directAccessGrantsEnabled, serviceAccountsEnabled, redirectUris, rootUrl }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const created = await kc.clients.create({
        clientId, name, description,
        enabled: enabled ?? true,
        publicClient: publicClient ?? false,
        standardFlowEnabled: standardFlowEnabled ?? true,
        directAccessGrantsEnabled: directAccessGrantsEnabled ?? false,
        serviceAccountsEnabled: serviceAccountsEnabled ?? false,
        redirectUris, rootUrl,
      });
      return ok({ ok: true, id: created.id, clientId });
    },
  );

  server.tool(
    "kc_delete_client",
    "Delete a client by clientId (destructive). Dry-run unless confirm=true.",
    { realm: Realm, clientId: z.string().min(1), confirm: z.boolean().optional().describe("Must be true to actually delete") },
    async ({ realm, clientId, confirm }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const found = await kc.clients.find({ clientId });
      const client = found[0];
      if (!client?.id) return ok({ ok: false, error: `Client '${clientId}' not found.` });
      if (!confirm) return ok({ ok: true, dryRun: true, clientId, id: client.id, note: "Pass confirm=true to delete." });
      await kc.clients.del({ id: client.id });
      return ok({ ok: true, deleted: clientId, id: client.id });
    },
  );

  // ---- realm roles ----
  server.tool(
    "kc_create_realm_role",
    "Create a realm role.",
    { realm: Realm, name: z.string().min(1), description: z.string().optional() },
    async ({ realm, name, description }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      await kc.roles.create({ name, description });
      return ok({ ok: true, role: name });
    },
  );

  server.tool(
    "kc_delete_realm_role",
    "Delete a realm role by name (destructive). Dry-run unless confirm=true.",
    { realm: Realm, name: z.string().min(1), confirm: z.boolean().optional().describe("Must be true to actually delete") },
    async ({ realm, name, confirm }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const role = await kc.roles.findOneByName({ name });
      if (!role?.id) return ok({ ok: false, error: `Realm role '${name}' not found.` });
      if (!confirm) return ok({ ok: true, dryRun: true, role: name, note: "Pass confirm=true to delete." });
      await kc.roles.delByName({ name });
      return ok({ ok: true, deleted: name });
    },
  );

  // ---- groups ----
  server.tool(
    "kc_create_group",
    "Create a group in a realm.",
    { realm: Realm, name: z.string().min(1) },
    async ({ realm, name }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const created = await kc.groups.create({ name });
      return ok({ ok: true, id: created.id, group: name });
    },
  );

  server.tool(
    "kc_delete_group",
    "Delete a group by id (destructive). Dry-run unless confirm=true.",
    { realm: Realm, groupId: z.string().min(1), confirm: z.boolean().optional().describe("Must be true to actually delete") },
    async ({ realm, groupId, confirm }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      if (!confirm) return ok({ ok: true, dryRun: true, groupId, note: "Pass confirm=true to delete." });
      const kc = await connect(realm);
      await kc.groups.del({ id: groupId });
      return ok({ ok: true, deleted: groupId });
    },
  );

  server.tool(
    "kc_add_user_to_group",
    "Add a user to a group.",
    { realm: Realm, userId: z.string().min(1), groupId: z.string().min(1) },
    async ({ realm, userId, groupId }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      await kc.users.addToGroup({ id: userId, groupId });
      return ok({ ok: true, userId, groupId });
    },
  );

  // ---- client scopes ----
  server.tool(
    "kc_create_client_scope",
    "Create a client scope.",
    {
      realm: Realm,
      name: z.string().min(1),
      protocol: z.string().optional().describe("Default openid-connect"),
      description: z.string().optional(),
      includeInTokenScope: z.boolean().optional().describe("Advertise the scope name in the token 'scope' claim (default true)"),
    },
    async ({ realm, name, protocol, description, includeInTokenScope }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      await kc.clientScopes.create({
        name,
        protocol: protocol ?? "openid-connect",
        description,
        attributes: { "include.in.token.scope": String(includeInTokenScope ?? true) },
      });
      return ok({ ok: true, scope: name });
    },
  );

  server.tool(
    "kc_delete_client_scope",
    "Delete a client scope by id (destructive). Dry-run unless confirm=true.",
    { realm: Realm, scopeId: z.string().min(1), confirm: z.boolean().optional().describe("Must be true to actually delete") },
    async ({ realm, scopeId, confirm }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      if (!confirm) return ok({ ok: true, dryRun: true, scopeId, note: "Pass confirm=true to delete." });
      const kc = await connect(realm);
      await kc.clientScopes.del({ id: scopeId });
      return ok({ ok: true, deleted: scopeId });
    },
  );
}
