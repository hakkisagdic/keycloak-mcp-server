import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cfg, connect, ok, readOnlyRefusal, Realm } from "./client.js";

/**
 * Register role tools beyond the basics — realm-role updates and composites, client roles,
 * and role membership lookups. Same guardrails as the other write tools: every mutating tool
 * refuses when KEYCLOAK_MCP_READONLY is set, and each destructive op is a dry-run unless
 * confirm=true.
 */
export function registerRoleExtraTools(server: McpServer): void {
  // ---- realm roles ----
  server.tool(
    "kc_update_realm_role",
    "Update a realm role's description.",
    { realm: Realm, name: z.string().min(1).describe("Role name"), description: z.string().describe("New description") },
    async ({ realm, name, description }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const role = await kc.roles.findOneByName({ name });
      if (!role?.id) return ok({ ok: false, error: `Realm role '${name}' not found.` });
      await kc.roles.updateByName({ name }, { name, description });
      return ok({ ok: true, role: name, description });
    },
  );

  server.tool(
    "kc_get_role_composites",
    "List the composite (child) roles of a realm role.",
    {
      realm: Realm,
      name: z.string().min(1).describe("Realm role name"),
      search: z.string().optional().describe("Filter composites by name"),
      max: z.number().int().positive().max(200).optional().describe("Max rows (default 50)"),
    },
    async ({ realm, name, search, max }) => {
      const kc = await connect(realm);
      const role = await kc.roles.findOneByName({ name });
      if (!role?.id) return ok({ ok: false, error: `Realm role '${name}' not found.` });
      const limit = Math.min(max ?? 50, 200);
      const composites = await kc.roles.getCompositeRoles({ id: role.id, search, first: 0, max: limit });
      return ok(
        composites
          .slice(0, limit)
          .map((r) => ({ id: r.id, name: r.name, description: r.description, clientRole: r.clientRole, containerId: r.containerId })),
      );
    },
  );

  server.tool(
    "kc_add_role_composites",
    "Add realm roles (by name) as composites of a realm role.",
    {
      realm: Realm,
      name: z.string().min(1).describe("Parent realm role name"),
      composites: z.array(z.string().min(1)).min(1).describe("Realm role names to add as composites"),
    },
    async ({ realm, name, composites }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const role = await kc.roles.findOneByName({ name });
      if (!role?.id) return ok({ ok: false, error: `Realm role '${name}' not found.` });
      const resolved = await Promise.all(composites.map((c) => kc.roles.findOneByName({ name: c })));
      const missing = composites.filter((_, i) => !resolved[i]?.id);
      if (missing.length) return ok({ ok: false, error: `Realm roles not found: ${missing.join(", ")}` });
      await kc.roles.createComposite({ roleId: role.id }, resolved.map((r) => ({ id: r!.id, name: r!.name })));
      return ok({ ok: true, role: name, added: composites });
    },
  );

  server.tool(
    "kc_remove_role_composites",
    "Remove composite roles (by name) from a realm role (destructive). Dry-run unless confirm=true.",
    {
      realm: Realm,
      name: z.string().min(1).describe("Parent realm role name"),
      composites: z.array(z.string().min(1)).min(1).describe("Realm role names to remove from the composites"),
      confirm: z.boolean().optional().describe("Must be true to actually remove"),
    },
    async ({ realm, name, composites, confirm }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const role = await kc.roles.findOneByName({ name });
      if (!role?.id) return ok({ ok: false, error: `Realm role '${name}' not found.` });
      const resolved = await Promise.all(composites.map((c) => kc.roles.findOneByName({ name: c })));
      const missing = composites.filter((_, i) => !resolved[i]?.id);
      if (missing.length) return ok({ ok: false, error: `Realm roles not found: ${missing.join(", ")}` });
      if (!confirm) return ok({ ok: true, dryRun: true, role: name, wouldRemove: composites, note: "Pass confirm=true to remove." });
      await kc.roles.delCompositeRoles({ id: role.id }, resolved.map((r) => ({ id: r!.id, name: r!.name })));
      return ok({ ok: true, role: name, removed: composites });
    },
  );

  server.tool(
    "kc_list_role_users",
    "List users holding a realm role.",
    {
      realm: Realm,
      name: z.string().min(1).describe("Realm role name"),
      max: z.number().int().positive().max(200).optional().describe("Max rows (default 50)"),
    },
    async ({ realm, name, max }) => {
      const kc = await connect(realm);
      const limit = Math.min(max ?? 50, 200);
      const users = await kc.roles.findUsersWithRole({ name, first: 0, max: limit });
      return ok(users.slice(0, limit).map((u) => ({ id: u.id, username: u.username, email: u.email, enabled: u.enabled })));
    },
  );

  // ---- client roles ----
  server.tool(
    "kc_create_client_role",
    "Create a role on a client (resolved by clientId).",
    { realm: Realm, clientId: z.string().min(1), name: z.string().min(1).describe("Role name"), description: z.string().optional() },
    async ({ realm, clientId, name, description }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const client = (await kc.clients.find({ clientId }))[0];
      if (!client?.id) return ok({ ok: false, error: `Client '${clientId}' not found.` });
      await kc.clients.createRole({ id: client.id, name, description });
      return ok({ ok: true, clientId, role: name });
    },
  );

  server.tool(
    "kc_update_client_role",
    "Update a client role's description (client resolved by clientId).",
    { realm: Realm, clientId: z.string().min(1), roleName: z.string().min(1), description: z.string().describe("New description") },
    async ({ realm, clientId, roleName, description }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const client = (await kc.clients.find({ clientId }))[0];
      if (!client?.id) return ok({ ok: false, error: `Client '${clientId}' not found.` });
      const role = await kc.clients.findRole({ id: client.id, roleName });
      if (!role?.id) return ok({ ok: false, error: `Role '${roleName}' not found on client '${clientId}'.` });
      await kc.clients.updateRole({ id: client.id, roleName }, { name: roleName, description });
      return ok({ ok: true, clientId, role: roleName, description });
    },
  );

  server.tool(
    "kc_delete_client_role",
    "Delete a client role (destructive; client resolved by clientId). Dry-run unless confirm=true.",
    { realm: Realm, clientId: z.string().min(1), roleName: z.string().min(1), confirm: z.boolean().optional().describe("Must be true to actually delete") },
    async ({ realm, clientId, roleName, confirm }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const client = (await kc.clients.find({ clientId }))[0];
      if (!client?.id) return ok({ ok: false, error: `Client '${clientId}' not found.` });
      const role = await kc.clients.findRole({ id: client.id, roleName });
      if (!role?.id) return ok({ ok: false, error: `Role '${roleName}' not found on client '${clientId}'.` });
      if (!confirm) return ok({ ok: true, dryRun: true, clientId, role: roleName, note: "Pass confirm=true to delete." });
      await kc.clients.delRole({ id: client.id, roleName });
      return ok({ ok: true, clientId, deleted: roleName });
    },
  );
}
