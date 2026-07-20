import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cfg, connect, ok, readOnlyRefusal, Realm } from "./client.js";

/**
 * Register group tools beyond the basics — update/inspect single groups, membership listing,
 * child groups, and realm-role mappings on groups. Same guardrails as the other write tools:
 * mutations refuse when KEYCLOAK_MCP_READONLY is set, and the role-mapping removal is a
 * dry-run unless confirm=true.
 */
export function registerGroupExtraTools(server: McpServer): void {
  server.tool(
    "kc_get_group",
    "Get a single group by id, including its direct subgroups.",
    { realm: Realm, groupId: z.string().min(1).describe("Group uuid") },
    async ({ realm, groupId }) => {
      const kc = await connect(realm);
      const g = await kc.groups.findOne({ id: groupId });
      if (!g) return ok(null);
      const subGroups = await kc.groups.listSubGroups({ parentId: groupId });
      return ok({
        id: g.id,
        name: g.name,
        path: g.path,
        parentId: g.parentId,
        attributes: g.attributes,
        realmRoles: g.realmRoles,
        subGroupCount: g.subGroupCount,
        subGroups: subGroups.map((s) => ({ id: s.id, name: s.name, path: s.path })),
      });
    },
  );

  server.tool(
    "kc_update_group",
    "Update a group's name and/or attributes.",
    {
      realm: Realm,
      groupId: z.string().min(1).describe("Group uuid"),
      name: z.string().min(1).optional().describe("New group name"),
      attributes: z.record(z.string(), z.array(z.string())).optional().describe("Attribute map (replaces existing attributes)"),
    },
    async ({ realm, groupId, name, attributes }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const existing = await kc.groups.findOne({ id: groupId });
      if (!existing) return ok({ ok: false, error: `Group '${groupId}' not found.` });
      await kc.groups.update(
        { id: groupId },
        { name: name ?? existing.name, attributes: attributes ?? existing.attributes },
      );
      return ok({ ok: true, id: groupId, name: name ?? existing.name });
    },
  );

  server.tool(
    "kc_list_group_members",
    "List members of a group (paged).",
    {
      realm: Realm,
      groupId: z.string().min(1).describe("Group uuid"),
      first: z.number().int().min(0).optional().describe("Pagination offset (default 0)"),
      max: z.number().int().positive().max(200).optional().describe("Max rows (default 50, cap 200)"),
    },
    async ({ realm, groupId, first, max }) => {
      const kc = await connect(realm);
      const limit = Math.min(max ?? 50, 200);
      const members = await kc.groups.listMembers({ id: groupId, first: first ?? 0, max: limit });
      return ok(
        members
          .slice(0, limit)
          .map((u) => ({ id: u.id, username: u.username, email: u.email, enabled: u.enabled })),
      );
    },
  );

  server.tool(
    "kc_create_child_group",
    "Create a child group under a parent group.",
    { realm: Realm, parentGroupId: z.string().min(1).describe("Parent group uuid"), name: z.string().min(1) },
    async ({ realm, parentGroupId, name }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const created = await kc.groups.createChildGroup({ id: parentGroupId }, { name });
      return ok({ ok: true, id: created.id, group: name, parentGroupId });
    },
  );

  server.tool(
    "kc_add_group_realm_role",
    "Map a realm role onto a group (members inherit it).",
    { realm: Realm, groupId: z.string().min(1).describe("Group uuid"), roleName: z.string().min(1).describe("Realm role name") },
    async ({ realm, groupId, roleName }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const role = await kc.roles.findOneByName({ name: roleName });
      if (!role?.id) return ok({ ok: false, error: `Realm role '${roleName}' not found.` });
      await kc.groups.addRealmRoleMappings({ id: groupId, roles: [{ id: role.id, name: roleName }] });
      return ok({ ok: true, groupId, role: roleName });
    },
  );

  server.tool(
    "kc_remove_group_realm_role",
    "Remove a realm-role mapping from a group (destructive). Dry-run unless confirm=true.",
    {
      realm: Realm,
      groupId: z.string().min(1).describe("Group uuid"),
      roleName: z.string().min(1).describe("Realm role name"),
      confirm: z.boolean().optional().describe("Must be true to actually remove"),
    },
    async ({ realm, groupId, roleName, confirm }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const role = await kc.roles.findOneByName({ name: roleName });
      if (!role?.id) return ok({ ok: false, error: `Realm role '${roleName}' not found.` });
      if (!confirm) return ok({ ok: true, dryRun: true, groupId, role: roleName, note: "Pass confirm=true to remove." });
      await kc.groups.delRealmRoleMappings({ id: groupId, roles: [{ id: role.id, name: roleName }] });
      return ok({ ok: true, removed: roleName, groupId });
    },
  );

  server.tool(
    "kc_list_group_role_mappings",
    "List a group's role mappings (realm + client roles).",
    { realm: Realm, groupId: z.string().min(1).describe("Group uuid") },
    async ({ realm, groupId }) => {
      const kc = await connect(realm);
      const mappings = await kc.groups.listRoleMappings({ id: groupId });
      return ok({
        realmMappings: (mappings.realmMappings ?? []).map((r) => ({ id: r.id, name: r.name, description: r.description })),
        clientMappings: mappings.clientMappings ?? {},
      });
    },
  );
}
