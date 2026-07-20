#!/usr/bin/env node
/**
 * keycloak-mcp-server — administer Keycloak through the Model Context Protocol.
 *
 * Transport: stdio by default (spawned by the MCP client). Set KEYCLOAK_MCP_HTTP_PORT to run a
 * remote, stateless Streamable HTTP server at /mcp instead. Authenticates to the Keycloak Admin
 * REST API via env (admin-cli password or a service-account client-credentials grant).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { cfg, credential, isCredentialUrlSafe } from "./client.js";
import { registerReadTools } from "./read-tools.js";
import { registerWriteTools } from "./write-tools.js";
import { registerAdminWriteTools } from "./admin-write-tools.js";
import { registerUserExtraTools } from "./users-extra-tools.js";
import { registerClientExtraTools } from "./clients-extra-tools.js";
import { registerRealmTools } from "./realm-tools.js";
import { registerRoleExtraTools } from "./roles-extra-tools.js";
import { registerGroupExtraTools } from "./groups-extra-tools.js";
import { registerClientScopeExtraTools } from "./client-scopes-extra-tools.js";
import { registerIdpTools } from "./idp-tools.js";
import { registerSessionsEventsTools } from "./sessions-events-tools.js";
import { registerAuthnTools } from "./authn-tools.js";
import { registerOrgComponentTools } from "./org-components-tools.js";

// Require explicit credentials — never silently fall back to a default admin password.
if (!credential) {
  console.error(
    "[keycloak-mcp] No admin credentials. Set KEYCLOAK_CLIENT_SECRET (service account) " +
      "or KEYCLOAK_ADMIN_USER + KEYCLOAK_ADMIN_PASSWORD.",
  );
  process.exit(1);
}

// Refuse to send admin credentials in the clear to a non-loopback host.
if (!isCredentialUrlSafe(cfg.baseUrl)) {
  console.error(
    `[keycloak-mcp] Refusing to send admin credentials over plaintext HTTP to ${cfg.baseUrl}. ` +
      "Use https:// or a loopback host.",
  );
  process.exit(1);
}

function buildServer(): McpServer {
  const server = new McpServer({ name: "keycloak-mcp-server", version: "0.6.0" });
  registerReadTools(server);
  registerWriteTools(server);
  registerAdminWriteTools(server);
  registerUserExtraTools(server);
  registerClientExtraTools(server);
  registerRealmTools(server);
  registerRoleExtraTools(server);
  registerGroupExtraTools(server);
  registerClientScopeExtraTools(server);
  registerIdpTools(server);
  registerSessionsEventsTools(server);
  registerAuthnTools(server);
  registerOrgComponentTools(server);
  return server;
}

const httpPort = process.env.KEYCLOAK_MCP_HTTP_PORT;
if (httpPort) {
  // Remote, stateless Streamable HTTP: a fresh server+transport per request.
  const httpServer = createServer(async (req, res) => {
    if ((req.url ?? "").split("?")[0] !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString();
      const body = raw ? JSON.parse(raw) : undefined;

      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      if (!res.headersSent) res.writeHead(500).end(String(err));
    }
  });
  httpServer.listen(Number(httpPort), () =>
    console.error(`[keycloak-mcp] Streamable HTTP listening on :${httpPort}/mcp`),
  );
} else {
  const transport = new StdioServerTransport();
  await buildServer().connect(transport);
}
