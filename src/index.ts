#!/usr/bin/env node
/**
 * keycloak-mcp-server — administer Keycloak through the Model Context Protocol.
 *
 * Transport: stdio (spawned by the MCP client). Authenticates to the Keycloak Admin
 * REST API with either an admin username/password (admin-cli) or a service-account
 * client-credentials grant, all via environment variables. See .env.example.
 *
 * Tools: read (realms/clients/users/roles/groups/IDPs/client-scopes) + write
 * (create/enable/role-map/delete users). Writes refuse when KEYCLOAK_MCP_READONLY is set.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { cfg, credential } from "./client.js";
import { registerReadTools } from "./read-tools.js";
import { registerWriteTools } from "./write-tools.js";

// Require explicit credentials — never silently fall back to a default admin password.
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

const server = new McpServer({ name: "keycloak-mcp-server", version: "0.3.0" });
registerReadTools(server);
registerWriteTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
