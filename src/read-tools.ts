import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cfg, connect, ok, Realm } from "./client.js";

/** Register all read-only Keycloak tools. */
export function registerReadTools(server: McpServer): void {
  // -------------------------------------------------------------- realms
  server.tool("kc_list_realms", "List all realms (name + enabled flag).", {}, async () => {
    const kc = await connect(cfg.authRealm);
    const realms = await kc.realms.find();
    return ok(realms.map((r) => ({ realm: r.realm, enabled: r.enabled })));
  });

  server.tool("kc_get_realm", "Get a realm's configuration summary.", { realm: Realm }, async ({ realm }) => {
    const kc = await connect(realm);
    const r = await kc.realms.findOne({ realm });
    if (!r) return ok(null);
    return ok({
      realm: r.realm,
      enabled: r.enabled,
      displayName: r.displayName,
      sslRequired: r.sslRequired,
      registrationAllowed: r.registrationAllowed,
      loginWithEmailAllowed: r.loginWithEmailAllowed,
      accessTokenLifespan: r.accessTokenLifespan,
    });
  });

  // -------------------------------------------------------------- clients
  server.tool("kc_list_clients", "List OAuth clients in a realm.", { realm: Realm }, async ({ realm }) => {
    const kc = await connect(realm);
    const clients = await kc.clients.find();
    return ok(
      clients.map((c) => ({
        id: c.id,
        clientId: c.clientId,
        enabled: c.enabled,
        publicClient: c.publicClient,
        bearerOnly: c.bearerOnly,
      })),
    );
  });

  server.tool(
    "kc_get_client",
    "Get a client by its clientId.",
    { realm: Realm, clientId: z.string().min(1).describe("Client's clientId (not the internal uuid)") },
    async ({ realm, clientId }) => {
      const kc = await connect(realm);
      const c = (await kc.clients.find({ clientId }))[0];
      if (!c) return ok(null);
      return ok({
        id: c.id,
        clientId: c.clientId,
        name: c.name,
        enabled: c.enabled,
        publicClient: c.publicClient,
        bearerOnly: c.bearerOnly,
        standardFlowEnabled: c.standardFlowEnabled,
        serviceAccountsEnabled: c.serviceAccountsEnabled,
        redirectUris: c.redirectUris,
      });
    },
  );

  server.tool("kc_list_client_scopes", "List client scopes in a realm.", { realm: Realm }, async ({ realm }) => {
    const kc = await connect(realm);
    const scopes = await kc.clientScopes.find();
    return ok(scopes.map((s) => ({ id: s.id, name: s.name, protocol: s.protocol, description: s.description })));
  });

  // -------------------------------------------------------------- users
  server.tool(
    "kc_list_users",
    "List users in a realm (paged).",
    { realm: Realm, max: z.number().int().positive().max(200).optional().describe("Max rows (default 20)") },
    async ({ realm, max }) => {
      const kc = await connect(realm);
      const users = await kc.users.find({ max: max ?? 20 });
      return ok(users.map((u) => ({ id: u.id, username: u.username, email: u.email, enabled: u.enabled })));
    },
  );

  server.tool(
    "kc_get_user",
    "Get a single user by id or (exact) username.",
    { realm: Realm, id: z.string().optional().describe("User uuid"), username: z.string().optional().describe("Exact username") },
    async ({ realm, id, username }) => {
      const kc = await connect(realm);
      let u;
      if (id) u = await kc.users.findOne({ id });
      else if (username) u = (await kc.users.find({ username, exact: true }))[0];
      else throw new Error("Provide either id or username.");
      if (!u) return ok(null);
      return ok({
        id: u.id,
        username: u.username,
        email: u.email,
        enabled: u.enabled,
        emailVerified: u.emailVerified,
        firstName: u.firstName,
        lastName: u.lastName,
        createdTimestamp: u.createdTimestamp,
      });
    },
  );

  // -------------------------------------------------------- roles / groups / idps
  server.tool("kc_list_roles", "List realm roles.", { realm: Realm }, async ({ realm }) => {
    const kc = await connect(realm);
    const roles = await kc.roles.find();
    return ok(roles.map((r) => ({ id: r.id, name: r.name, description: r.description, composite: r.composite })));
  });

  server.tool("kc_list_groups", "List groups in a realm.", { realm: Realm }, async ({ realm }) => {
    const kc = await connect(realm);
    const groups = await kc.groups.find();
    return ok(groups.map((g) => ({ id: g.id, name: g.name, path: g.path })));
  });

  server.tool(
    "kc_list_identity_providers",
    "List identity providers (SSO / social login) in a realm.",
    { realm: Realm },
    async ({ realm }) => {
      const kc = await connect(realm);
      const idps = await kc.identityProviders.find();
      return ok(idps.map((i) => ({ alias: i.alias, providerId: i.providerId, enabled: i.enabled, displayName: i.displayName })));
    },
  );
}
