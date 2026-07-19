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
  // Realm the credentials authenticate against (master can administer every realm).
  authRealm: process.env.KEYCLOAK_REALM ?? "master",
  clientId: process.env.KEYCLOAK_CLIENT_ID ?? "admin-cli",
  clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
  username: process.env.KEYCLOAK_ADMIN_USER,
  password: process.env.KEYCLOAK_ADMIN_PASSWORD,
};

// Require explicit credentials — never silently fall back to a default admin password.
type Grant =
  | { grantType: "client_credentials"; clientId: string; clientSecret: string }
  | { grantType: "password"; clientId: string; username: string; password: string };

const credential: Grant | null = cfg.clientSecret
  ? { grantType: "client_credentials", clientId: cfg.clientId, clientSecret: cfg.clientSecret }
  : cfg.username && cfg.password
    ? { grantType: "password", clientId: cfg.clientId, username: cfg.username, password: cfg.password }
    : null;

if (!credential) {
  console.error(
    "[keycloak-mcp] No admin credentials. Set KEYCLOAK_CLIENT_SECRET (service account) " +
      "or KEYCLOAK_ADMIN_USER + KEYCLOAK_ADMIN_PASSWORD.",
  );
  process.exit(1);
}

// Refuse to send admin credentials in the clear to a non-loopback host.
const url = new URL(cfg.baseUrl);
const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
if (url.protocol !== "https:" && !isLoopback) {
  console.error(
    `[keycloak-mcp] Refusing to send admin credentials over plaintext HTTP to ${url.host}. ` +
      "Use https:// or a loopback host.",
  );
  process.exit(1);
}

/**
 * Build a freshly-authenticated client for a single request. A per-call client keeps the
 * realm target and token call-local, so concurrent tool invocations never race on shared
 * mutable state. Auth happens against `authRealm`; operations target `realm`.
 */
async function connect(realm: string): Promise<KcAdminClient> {
  const kc = new KcAdminClient({ baseUrl: cfg.baseUrl, realmName: cfg.authRealm });
  await kc.auth(credential!);
  kc.setConfig({ realmName: realm });
  return kc;
}

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const server = new McpServer({ name: "keycloak-mcp-server", version: "0.1.0" });

server.tool("kc_list_realms", "List all realms (name + enabled flag).", {}, async () => {
  const kc = await connect(cfg.authRealm);
  const realms = await kc.realms.find();
  return ok(realms.map((r) => ({ realm: r.realm, enabled: r.enabled })));
});

server.tool(
  "kc_list_clients",
  "List OAuth clients in a realm.",
  { realm: z.string().min(1).describe("Realm name") },
  async ({ realm }) => {
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
  },
);

server.tool(
  "kc_list_users",
  "List users in a realm (paged).",
  {
    realm: z.string().min(1).describe("Realm name"),
    max: z.number().int().positive().max(200).optional().describe("Max rows (default 20)"),
  },
  async ({ realm, max }) => {
    const kc = await connect(realm);
    const users = await kc.users.find({ max: max ?? 20 });
    return ok(
      users.map((u) => ({ id: u.id, username: u.username, email: u.email, enabled: u.enabled })),
    );
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
