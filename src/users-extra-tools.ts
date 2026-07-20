import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cfg, connect, ok, readOnlyRefusal, Realm } from "./client.js";

const UserId = z.string().min(1).describe("User uuid");
const Max = z.number().int().positive().max(200).optional().describe("Max rows (default 50)");

/**
 * Register user-management tools beyond the basics — profile updates, counting, sessions,
 * credential resets, action emails, group membership, and client-role mappings. All writes
 * refuse when KEYCLOAK_MCP_READONLY is set; the session logout is a dry-run unless confirm=true.
 */
export function registerUserExtraTools(server: McpServer): void {
  // -------------------------------------------------------------- profile
  server.tool(
    "kc_update_user",
    "Update a user's profile fields; attributes are merged into existing ones.",
    {
      realm: Realm,
      userId: UserId,
      username: z.string().min(1).optional(),
      email: z.string().email().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      attributes: z.record(z.array(z.string())).optional().describe("Merged over the user's current attributes"),
    },
    async ({ realm, userId, username, email, firstName, lastName, attributes }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const current = await kc.users.findOne({ id: userId });
      if (!current) return ok({ ok: false, error: `User '${userId}' not found.` });
      await kc.users.update(
        { id: userId },
        {
          ...(username !== undefined ? { username } : {}),
          ...(email !== undefined ? { email } : {}),
          ...(firstName !== undefined ? { firstName } : {}),
          ...(lastName !== undefined ? { lastName } : {}),
          ...(attributes !== undefined ? { attributes: { ...(current.attributes ?? {}), ...attributes } } : {}),
        },
      );
      return ok({ ok: true, userId });
    },
  );

  server.tool(
    "kc_count_users",
    "Count users in a realm, optionally filtered.",
    {
      realm: Realm,
      search: z.string().optional().describe("Free-text search over username/email/name"),
      username: z.string().optional(),
      email: z.string().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
    },
    async ({ realm, search, username, email, firstName, lastName }) => {
      const kc = await connect(realm);
      const count = await kc.users.count({ search, username, email, firstName, lastName });
      return ok({ realm, count });
    },
  );

  // -------------------------------------------------------------- sessions
  server.tool(
    "kc_get_user_sessions",
    "List a user's active sessions.",
    { realm: Realm, userId: UserId, max: Max },
    async ({ realm, userId, max }) => {
      const kc = await connect(realm);
      const sessions = await kc.users.listSessions({ id: userId });
      const limit = max ?? 50;
      return ok(
        sessions.slice(0, limit).map((s) => ({
          id: s.id,
          ipAddress: s.ipAddress,
          start: s.start,
          lastAccess: s.lastAccess,
          clients: s.clients,
        })),
      );
    },
  );

  server.tool(
    "kc_logout_user",
    "Log a user out of ALL sessions (destructive). Dry-run unless confirm=true.",
    { realm: Realm, userId: UserId, confirm: z.boolean().optional().describe("Must be true to actually log out") },
    async ({ realm, userId, confirm }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      if (!confirm) return ok({ ok: true, dryRun: true, userId, note: "Pass confirm=true to end all sessions." });
      const kc = await connect(realm);
      await kc.users.logout({ id: userId });
      return ok({ ok: true, loggedOut: userId });
    },
  );

  // -------------------------------------------------------------- credentials / emails
  server.tool(
    "kc_reset_user_password",
    "Set a user's password (temporary=true forces change on next login).",
    {
      realm: Realm,
      userId: UserId,
      password: z.string().min(1),
      temporary: z.boolean().optional().describe("Force password change on next login (default true)"),
    },
    async ({ realm, userId, password, temporary }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      await kc.users.resetPassword({
        id: userId,
        credential: { type: "password", value: password, temporary: temporary ?? true },
      });
      return ok({ ok: true, userId, temporary: temporary ?? true });
    },
  );

  server.tool(
    "kc_send_verify_email",
    "Send the email-verification email to a user.",
    {
      realm: Realm,
      userId: UserId,
      clientId: z.string().optional().describe("Client the link redirects back to"),
      redirectUri: z.string().optional(),
    },
    async ({ realm, userId, clientId, redirectUri }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      await kc.users.sendVerifyEmail({ id: userId, clientId, redirectUri });
      return ok({ ok: true, userId, sent: "verify-email" });
    },
  );

  server.tool(
    "kc_execute_actions_email",
    "Email a user a link to perform required actions (e.g. UPDATE_PASSWORD, CONFIGURE_TOTP).",
    {
      realm: Realm,
      userId: UserId,
      actions: z.array(z.string().min(1)).min(1).describe("Required-action aliases, e.g. ['UPDATE_PASSWORD']"),
      lifespan: z.number().int().positive().optional().describe("Link lifetime in seconds"),
      clientId: z.string().optional(),
      redirectUri: z.string().optional(),
    },
    async ({ realm, userId, actions, lifespan, clientId, redirectUri }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      await kc.users.executeActionsEmail({ id: userId, actions, lifespan, clientId, redirectUri });
      return ok({ ok: true, userId, actions });
    },
  );

  // -------------------------------------------------------------- groups
  server.tool(
    "kc_remove_user_from_group",
    "Remove a user from a group.",
    { realm: Realm, userId: UserId, groupId: z.string().min(1) },
    async ({ realm, userId, groupId }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      await kc.users.delFromGroup({ id: userId, groupId });
      return ok({ ok: true, userId, removedFromGroup: groupId });
    },
  );

  server.tool(
    "kc_list_user_groups",
    "List the groups a user belongs to.",
    { realm: Realm, userId: UserId, search: z.string().optional(), max: Max },
    async ({ realm, userId, search, max }) => {
      const kc = await connect(realm);
      const limit = max ?? 50;
      const groups = await kc.users.listGroups({ id: userId, search, max: limit });
      return ok(groups.slice(0, limit).map((g) => ({ id: g.id, name: g.name, path: g.path })));
    },
  );

  // -------------------------------------------------------------- role mappings
  server.tool(
    "kc_list_user_role_mappings",
    "List a user's realm-role and client-role mappings.",
    { realm: Realm, userId: UserId },
    async ({ realm, userId }) => {
      const kc = await connect(realm);
      const mappings = await kc.users.listRoleMappings({ id: userId });
      return ok({
        realmRoles: (mappings.realmMappings ?? []).map((r) => ({ id: r.id, name: r.name, description: r.description })),
        clientRoles: Object.fromEntries(
          Object.entries(mappings.clientMappings ?? {}).map(([client, m]) => [
            client,
            (m.mappings ?? []).map((r: { id?: string; name?: string }) => ({ id: r.id, name: r.name })),
          ]),
        ),
      });
    },
  );

  server.tool(
    "kc_assign_client_role",
    "Assign a client role to a user (client resolved by clientId, role by name).",
    { realm: Realm, userId: UserId, clientId: z.string().min(1), roleName: z.string().min(1) },
    async ({ realm, userId, clientId, roleName }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const client = (await kc.clients.find({ clientId }))[0];
      if (!client?.id) return ok({ ok: false, error: `Client '${clientId}' not found.` });
      const role = await kc.clients.findRole({ id: client.id, roleName });
      if (!role?.id || !role.name) return ok({ ok: false, error: `Role '${roleName}' not found on client '${clientId}'.` });
      await kc.users.addClientRoleMappings({ id: userId, clientUniqueId: client.id, roles: [{ id: role.id, name: role.name }] });
      return ok({ ok: true, userId, clientId, role: roleName });
    },
  );

  server.tool(
    "kc_remove_client_role",
    "Remove a client role from a user (client resolved by clientId, role by name).",
    { realm: Realm, userId: UserId, clientId: z.string().min(1), roleName: z.string().min(1) },
    async ({ realm, userId, clientId, roleName }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const client = (await kc.clients.find({ clientId }))[0];
      if (!client?.id) return ok({ ok: false, error: `Client '${clientId}' not found.` });
      const role = await kc.clients.findRole({ id: client.id, roleName });
      if (!role?.id || !role.name) return ok({ ok: false, error: `Role '${roleName}' not found on client '${clientId}'.` });
      await kc.users.delClientRoleMappings({ id: userId, clientUniqueId: client.id, roles: [{ id: role.id, name: role.name }] });
      return ok({ ok: true, userId, clientId, removedRole: roleName });
    },
  );
}
