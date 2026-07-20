import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cfg, connect, ok, readOnlyRefusal, Realm } from "./client.js";

const Max = z.number().int().positive().max(200).optional().describe("Max rows (default 50)");
const cap = (max?: number) => Math.min(max ?? 50, 200);

/**
 * Register tools for Keycloak 26 Organizations and realm components (user federation /
 * key providers). Writes refuse in read-only mode; destructive tools dry-run unless confirm=true.
 */
export function registerOrgComponentTools(server: McpServer): void {
  // ---- organizations ----
  server.tool(
    "kc_list_organizations",
    "List organizations in a realm, optionally filtered by search text.",
    { realm: Realm, search: z.string().optional().describe("Search by name/domain"), max: Max },
    async ({ realm, search, max }) => {
      const kc = await connect(realm);
      const limit = cap(max);
      const orgs = await kc.organizations.find({ search, max: limit });
      return ok(orgs.slice(0, limit).map((o) => ({
        id: o.id, name: o.name, alias: o.alias, enabled: o.enabled,
        domains: o.domains?.map((d) => d.name),
      })));
    },
  );

  server.tool(
    "kc_get_organization",
    "Get one organization by id.",
    { realm: Realm, orgId: z.string().min(1).describe("Organization id") },
    async ({ realm, orgId }) => {
      const kc = await connect(realm);
      const org = await kc.organizations.findOne({ id: orgId });
      return ok(org);
    },
  );

  server.tool(
    "kc_create_organization",
    "Create an organization with a name and one or more email domains.",
    {
      realm: Realm,
      name: z.string().min(1),
      domains: z.array(z.string().min(1)).min(1).describe("Email domains, e.g. ['acme.com']"),
      alias: z.string().optional().describe("URL-friendly alias (defaults to name)"),
      description: z.string().optional(),
      redirectUrl: z.string().optional(),
      enabled: z.boolean().optional().describe("Default true"),
    },
    async ({ realm, name, domains, alias, description, redirectUrl, enabled }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const created = await kc.organizations.create({
        name, alias, description, redirectUrl,
        enabled: enabled ?? true,
        domains: domains.map((d) => ({ name: d })),
      });
      return ok({ ok: true, id: created.id, name });
    },
  );

  server.tool(
    "kc_delete_organization",
    "Delete an organization by id (destructive). Dry-run unless confirm=true.",
    { realm: Realm, orgId: z.string().min(1), confirm: z.boolean().optional().describe("Must be true to actually delete") },
    async ({ realm, orgId, confirm }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      if (!confirm) return ok({ ok: true, dryRun: true, orgId, note: "Pass confirm=true to delete." });
      const kc = await connect(realm);
      await kc.organizations.delById({ id: orgId });
      return ok({ ok: true, deleted: orgId });
    },
  );

  server.tool(
    "kc_list_org_members",
    "List members of an organization.",
    { realm: Realm, orgId: z.string().min(1), search: z.string().optional().describe("Search by user attributes"), max: Max },
    async ({ realm, orgId, search, max }) => {
      const kc = await connect(realm);
      const limit = cap(max);
      const members = await kc.organizations.listMembers({ orgId, search, max: limit });
      return ok(members.slice(0, limit).map((m) => ({
        id: m.id, username: m.username, email: m.email,
        firstName: m.firstName, lastName: m.lastName, enabled: m.enabled,
      })));
    },
  );

  server.tool(
    "kc_add_org_member",
    "Add an existing realm user to an organization.",
    { realm: Realm, orgId: z.string().min(1), userId: z.string().min(1) },
    async ({ realm, orgId, userId }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      await kc.organizations.addMember({ orgId, userId });
      return ok({ ok: true, orgId, userId });
    },
  );

  server.tool(
    "kc_remove_org_member",
    "Remove a user from an organization (destructive). Dry-run unless confirm=true.",
    { realm: Realm, orgId: z.string().min(1), userId: z.string().min(1), confirm: z.boolean().optional().describe("Must be true to actually remove") },
    async ({ realm, orgId, userId, confirm }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      if (!confirm) return ok({ ok: true, dryRun: true, orgId, userId, note: "Pass confirm=true to remove." });
      const kc = await connect(realm);
      await kc.organizations.delMember({ orgId, userId });
      return ok({ ok: true, removed: userId, orgId });
    },
  );

  // ---- components ----
  server.tool(
    "kc_list_components",
    "List realm components (user federation, key providers), filterable by provider type.",
    {
      realm: Realm,
      type: z.string().optional().describe("providerType, e.g. org.keycloak.storage.UserStorageProvider or org.keycloak.keys.KeyProvider"),
      parent: z.string().optional().describe("Parent id (defaults to the realm)"),
      name: z.string().optional(),
      max: Max,
    },
    async ({ realm, type, parent, name, max }) => {
      const kc = await connect(realm);
      const components = await kc.components.find({ type, parent, name });
      return ok(components.slice(0, cap(max)).map((c) => ({
        id: c.id, name: c.name, providerId: c.providerId, providerType: c.providerType, parentId: c.parentId,
      })));
    },
  );

  server.tool(
    "kc_get_component",
    "Get one component by id, including its config.",
    { realm: Realm, componentId: z.string().min(1) },
    async ({ realm, componentId }) => {
      const kc = await connect(realm);
      const component = await kc.components.findOne({ id: componentId });
      if (!component) return ok({ ok: false, error: `Component '${componentId}' not found.` });
      return ok(component);
    },
  );

  server.tool(
    "kc_delete_component",
    "Delete a component by id (destructive). Dry-run unless confirm=true.",
    { realm: Realm, componentId: z.string().min(1), confirm: z.boolean().optional().describe("Must be true to actually delete") },
    async ({ realm, componentId, confirm }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      if (!confirm) return ok({ ok: true, dryRun: true, componentId, note: "Pass confirm=true to delete." });
      const kc = await connect(realm);
      await kc.components.del({ id: componentId });
      return ok({ ok: true, deleted: componentId });
    },
  );
}
