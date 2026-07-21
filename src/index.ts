#!/usr/bin/env node
/**
 * keycloak-mcp-server — administer Keycloak through the Model Context Protocol.
 *
 * Full MCP spec: tools (111), resources, prompts, argument completion, and logging.
 *
 * Transport: stdio by default (spawned by the MCP client). Set KEYCLOAK_MCP_HTTP_PORT to run a
 * remote, stateless Streamable HTTP server at /mcp — gated by a bearer/OAuth2 token (see
 * http-auth.ts). Authenticates to the Keycloak Admin REST API via env (admin-cli password or a
 * service-account client-credentials grant).
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
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";
import { registerSpecTools } from "./spec-tools.js";
import { installResourceSubscriptions } from "./subscriptions.js";
import { annotationsFor } from "./annotations.js";
import { authMode, authorize, resourceMetadata, resourceMetadataPath, wwwAuthenticate } from "./http-auth.js";

const VERSION = "0.8.0";

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
  const server = new McpServer(
    { name: "keycloak-mcp-server", version: VERSION },
    { capabilities: { logging: {}, resources: { subscribe: true, listChanged: true } } },
  );

  // Central shim over the tool registrar, applied once to all tools: (1) inject spec tool
  // annotations (readOnly/destructive/idempotent hints) derived from the tool name, and (2) log
  // every invocation to the client at the level it set via logging/setLevel. Best-effort — the
  // logging never breaks a call.
  const originalTool = server.tool.bind(server) as (...args: unknown[]) => unknown;
  (server as unknown as { tool: (...args: unknown[]) => unknown }).tool = (...args: unknown[]) => {
    const last = args.length - 1;
    if (typeof args[last] === "function") {
      const handler = args[last] as (...h: unknown[]) => unknown;
      const toolName = typeof args[0] === "string" ? (args[0] as string) : "?";
      const wrapped = async (...h: unknown[]) => {
        void server
          .sendLoggingMessage({ level: "info", logger: "keycloak-mcp", data: `tool ${toolName} invoked` })
          .catch(() => {});
        try {
          return await handler(...h);
        } catch (e) {
          void server
            .sendLoggingMessage({ level: "error", logger: "keycloak-mcp", data: `tool ${toolName} failed: ${(e as Error).message}` })
            .catch(() => {});
          throw e;
        }
      };
      // Insert the annotations object immediately before the (wrapped) handler.
      const head = args.slice(0, last);
      return originalTool(...head, annotationsFor(toolName), wrapped);
    }
    return originalTool(...args);
  };

  // Tool groups — register everything by default, or a scoped subset via
  // KEYCLOAK_MCP_TOOL_GROUPS (comma-separated allowlist, e.g. "reads,users,clients"). Scoping the
  // server keeps every registered tool natively typed and individually permission-gated while
  // shrinking the surface the client loads.
  const groups: Record<string, (s: McpServer) => void> = {
    reads: registerReadTools,
    users: (s) => { registerWriteTools(s); registerUserExtraTools(s); },
    clients: registerClientExtraTools,
    "core-writes": registerAdminWriteTools,
    realms: registerRealmTools,
    roles: registerRoleExtraTools,
    groups: registerGroupExtraTools,
    scopes: registerClientScopeExtraTools,
    idps: registerIdpTools,
    sessions: registerSessionsEventsTools,
    authn: registerAuthnTools,
    orgs: registerOrgComponentTools,
    ai: registerSpecTools,
  };

  const requested = (process.env.KEYCLOAK_MCP_TOOL_GROUPS ?? "")
    .split(",").map((g) => g.trim()).filter(Boolean);
  for (const g of requested) {
    if (!(g in groups)) {
      console.error(`[keycloak-mcp] Unknown tool group '${g}' — known: ${Object.keys(groups).join(", ")}`);
    }
  }
  const enabled = requested.length ? requested.filter((g) => g in groups) : Object.keys(groups);
  for (const g of enabled) groups[g](server);
  if (requested.length) console.error(`[keycloak-mcp] Tool groups enabled: ${enabled.join(", ")}`);

  // Resources, prompts and subscriptions are the (small) spec surface — always on.
  registerResources(server);
  registerPrompts(server);
  installResourceSubscriptions(server);
  return server;
}

const httpPort = process.env.KEYCLOAK_MCP_HTTP_PORT;
if (httpPort) {
  const serverUrl = process.env.KEYCLOAK_MCP_PUBLIC_URL ?? `http://localhost:${httpPort}`;

  const httpServer = createServer(async (req, res) => {
    const path = (req.url ?? "").split("?")[0];

    // RFC 9728 Protected Resource Metadata — clients discover the authorization server here.
    if (path === resourceMetadataPath) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(resourceMetadata(`${serverUrl}/mcp`)));
      return;
    }
    if (path !== "/mcp") {
      res.writeHead(404).end();
      return;
    }

    const auth = await authorize(req);
    if (!auth.ok) {
      res.writeHead(auth.status, {
        "Content-Type": "application/json",
        "WWW-Authenticate": wwwAuthenticate(`${serverUrl}${resourceMetadataPath}`),
      });
      res.end(JSON.stringify({ error: auth.error }));
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

  // With no auth gate, refuse to listen on anything but loopback — an unauthenticated Keycloak
  // admin endpoint on a public interface would be a critical exposure.
  const host = authMode === "none" ? "127.0.0.1" : (process.env.KEYCLOAK_MCP_HTTP_HOST ?? "0.0.0.0");
  if (authMode === "none") {
    console.error(
      "[keycloak-mcp] HTTP mode with NO auth — binding to 127.0.0.1 only. Set KEYCLOAK_MCP_OIDC_ISSUER " +
        "(OAuth2) or KEYCLOAK_MCP_BEARER_TOKEN (shared secret) to expose it beyond localhost.",
    );
  }
  httpServer.listen(Number(httpPort), host, () =>
    console.error(`[keycloak-mcp] Streamable HTTP on ${host}:${httpPort}/mcp (auth: ${authMode})`),
  );
} else {
  const transport = new StdioServerTransport();
  await buildServer().connect(transport);
}
