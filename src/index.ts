#!/usr/bin/env node
/**
 * keycloak-mcp-server — administer Keycloak through the Model Context Protocol.
 *
 * Transport: stdio (spawned by the MCP client). Authenticates to the Keycloak Admin
 * REST API with either an admin username/password (admin-cli) or a service-account
 * client-credentials grant, all via environment variables. See .env.example.
 *
 * This is the initial tool slice (realms/clients/users read). The full surface —
 * roles, groups, identity providers, sessions, protocol mappers, client scopes,
 * events, organizations, plus create/update/delete — is tracked in the README roadmap.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import KcAdminClient from "@keycloak/keycloak-admin-client";
import { z } from "zod";

const cfg = {
  baseUrl: process.env.KEYCLOAK_URL ?? "http://localhost:8081",
  realmName: process.env.KEYCLOAK_REALM ?? "master",
  clientId: process.env.KEYCLOAK_CLIENT_ID ?? "admin-cli",
  clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
  username: process.env.KEYCLOAK_ADMIN_USER ?? "admin",
  password: process.env.KEYCLOAK_ADMIN_PASSWORD ?? "admin",
};

const kc = new KcAdminClient({ baseUrl: cfg.baseUrl, realmName: cfg.realmName });

/** (Re)authenticate before every call — tokens are short-lived; the client caches internally. */
async function ensureAuth(): Promise<void> {
  await kc.auth(
    cfg.clientSecret
      ? { grantType: "client_credentials", clientId: cfg.clientId, clientSecret: cfg.clientSecret }
      : { grantType: "password", clientId: cfg.clientId, username: cfg.username, password: cfg.password },
  );
}

/** Run a callback with the client temporarily pointed at `realm`, then restore the default. */
async function withRealm<T>(realm: string, fn: () => Promise<T>): Promise<T> {
  kc.setConfig({ realmName: realm });
  try {
    return await fn();
  } finally {
    kc.setConfig({ realmName: cfg.realmName });
  }
}

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const server = new McpServer({ name: "keycloak-mcp-server", version: "0.1.0" });

server.tool("kc_list_realms", "List all realms (name + enabled flag).", {}, async () => {
  await ensureAuth();
  const realms = await kc.realms.find();
  return ok(realms.map((r) => ({ realm: r.realm, enabled: r.enabled })));
});

server.tool(
  "kc_list_clients",
  "List OAuth clients in a realm.",
  { realm: z.string().describe("Realm name") },
  async ({ realm }) => {
    await ensureAuth();
    const clients = await withRealm(realm, () => kc.clients.find());
    return ok(
      clients.map((c) => ({
        id: c.id,
        clientId: c.clientId,
        enabled: c.enabled,
        publicClient: c.publicClient,
        bearerOnly: c.bearerOnly,
      })),
    );
  },
);

server.tool(
  "kc_list_users",
  "List users in a realm (paged).",
  {
    realm: z.string().describe("Realm name"),
    max: z.number().int().positive().max(200).optional().describe("Max rows (default 20)"),
  },
  async ({ realm, max }) => {
    await ensureAuth();
    const users = await withRealm(realm, () => kc.users.find({ max: max ?? 20 }));
    return ok(
      users.map((u) => ({ id: u.id, username: u.username, email: u.email, enabled: u.enabled })),
    );
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
