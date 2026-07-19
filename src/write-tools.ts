import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cfg, connect, ok, readOnlyRefusal, Realm } from "./client.js";

/**
 * Register mutating Keycloak tools. All refuse when KEYCLOAK_MCP_READONLY is set;
 * the destructive delete additionally requires confirm=true (dry-run otherwise).
 */
export function registerWriteTools(server: McpServer): void {
  server.tool(
    "kc_create_user",
    "Create a user in a realm (optionally set an initial password).",
    {
      realm: Realm,
      username: z.string().min(1),
      email: z.string().email().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      enabled: z.boolean().optional().describe("Default true"),
      password: z.string().optional().describe("Optional initial password"),
      temporaryPassword: z.boolean().optional().describe("Force password change on first login (default true)"),
    },
    async ({ realm, username, email, firstName, lastName, enabled, password, temporaryPassword }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const created = await kc.users.create({ username, email, firstName, lastName, enabled: enabled ?? true });
      if (password) {
        await kc.users.resetPassword({
          id: created.id,
          credential: { type: "password", value: password, temporary: temporaryPassword ?? true },
        });
      }
      return ok({ ok: true, id: created.id, username });
    },
  );

  server.tool(
    "kc_set_user_enabled",
    "Enable or disable a user.",
    { realm: Realm, userId: z.string().min(1), enabled: z.boolean() },
    async ({ realm, userId, enabled }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      await kc.users.update({ id: userId }, { enabled });
      return ok({ ok: true, userId, enabled });
    },
  );

  server.tool(
    "kc_assign_realm_role",
    "Assign a realm role to a user.",
    { realm: Realm, userId: z.string().min(1), roleName: z.string().min(1) },
    async ({ realm, userId, roleName }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const role = await kc.roles.findOneByName({ name: roleName });
      if (!role?.id || !role.name) return ok({ ok: false, error: `Realm role '${roleName}' not found.` });
      await kc.users.addRealmRoleMappings({ id: userId, roles: [{ id: role.id, name: role.name }] });
      return ok({ ok: true, userId, role: roleName });
    },
  );

  server.tool(
    "kc_remove_realm_role",
    "Remove a realm role from a user.",
    { realm: Realm, userId: z.string().min(1), roleName: z.string().min(1) },
    async ({ realm, userId, roleName }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const role = await kc.roles.findOneByName({ name: roleName });
      if (!role?.id || !role.name) return ok({ ok: false, error: `Realm role '${roleName}' not found.` });
      await kc.users.delRealmRoleMappings({ id: userId, roles: [{ id: role.id, name: role.name }] });
      return ok({ ok: true, userId, role: roleName });
    },
  );

  server.tool(
    "kc_delete_user",
    "Delete a user (destructive). Dry-run unless confirm=true.",
    { realm: Realm, userId: z.string().min(1), confirm: z.boolean().optional().describe("Must be true to actually delete") },
    async ({ realm, userId, confirm }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      if (!confirm) return ok({ ok: true, dryRun: true, userId, note: "Pass confirm=true to delete." });
      const kc = await connect(realm);
      await kc.users.del({ id: userId });
      return ok({ ok: true, deleted: userId });
    },
  );
}
