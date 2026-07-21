import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { cfg, connect } from "./client.js";

/**
 * Read-only Keycloak state exposed as MCP resources. A single `readResourceText(uri)` is the source
 * of truth for both the registered read callbacks and the subscription poller (subscriptions.ts), so
 * a subscribed client is notified from the exact same view it reads.
 */

async function realmNames(prefix = ""): Promise<string[]> {
  try {
    const kc = await connect(cfg.authRealm);
    return (await kc.realms.find())
      .map((r) => r.realm)
      .filter((n): n is string => !!n && n.toLowerCase().startsWith(prefix.toLowerCase()));
  } catch {
    return [];
  }
}

/** The canonical read for any keycloak:// URI. Returns JSON text, or null if the URI is unknown. */
export async function readResourceText(uri: string): Promise<string | null> {
  const j = (data: unknown) => JSON.stringify(data, null, 2);

  if (uri === "keycloak://realms") {
    const kc = await connect(cfg.authRealm);
    const realms = await kc.realms.find();
    return j(realms.map((r) => ({ realm: r.realm, enabled: r.enabled, id: r.id })));
  }
  if (uri === "keycloak://server-info") {
    const kc = await connect(cfg.authRealm);
    const info = await kc.serverInfo.find();
    return j({ systemInfo: info.systemInfo, features: info.features });
  }

  const m = uri.match(/^keycloak:\/\/realm\/([^/]+)(\/clients|\/roles)?$/);
  if (m) {
    const realm = decodeURIComponent(m[1]);
    const sub = m[2];
    const kc = await connect(realm);
    if (sub === "/clients") {
      const clients = await kc.clients.find({ realm });
      return j(
        clients.map((c) => ({
          clientId: c.clientId,
          enabled: c.enabled,
          publicClient: c.publicClient,
          standardFlowEnabled: c.standardFlowEnabled,
          serviceAccountsEnabled: c.serviceAccountsEnabled,
        })),
      );
    }
    if (sub === "/roles") {
      const roles = await kc.roles.find({ realm });
      return j(roles.map((role) => ({ name: role.name, description: role.description, composite: role.composite })));
    }
    const [cfgRealm, clients, groups, roles, users] = await Promise.all([
      kc.realms.findOne({ realm }),
      kc.clients.find({ realm }),
      kc.groups.find({ realm }),
      kc.roles.find({ realm }),
      kc.users.count({ realm }),
    ]);
    return j({
      realm,
      enabled: cfgRealm?.enabled,
      loginWithEmailAllowed: cfgRealm?.loginWithEmailAllowed,
      registrationAllowed: cfgRealm?.registrationAllowed,
      sslRequired: cfgRealm?.sslRequired,
      counts: { clients: clients.length, groups: groups.length, realmRoles: roles.length, users },
    });
  }
  return null;
}

const contents = async (uri: URL) => ({
  contents: [{ uri: uri.href, mimeType: "application/json", text: (await readResourceText(uri.href)) ?? "null" }],
});

const realmTemplate = (suffix: string) =>
  new ResourceTemplate(`keycloak://realm/{realm}${suffix}`, {
    list: undefined,
    complete: { realm: (value: string) => realmNames(value) },
  });

export function registerResources(server: McpServer): void {
  server.registerResource("realms", "keycloak://realms",
    { title: "Realms", description: "All realms with their enabled flag.", mimeType: "application/json" }, contents);
  server.registerResource("server-info", "keycloak://server-info",
    { title: "Server info", description: "Keycloak version, features and themes.", mimeType: "application/json" }, contents);
  server.registerResource("realm-summary", realmTemplate(""),
    { title: "Realm summary", description: "One realm's key settings + object counts.", mimeType: "application/json" }, contents);
  server.registerResource("realm-clients", realmTemplate("/clients"),
    { title: "Realm clients", description: "Clients in a realm.", mimeType: "application/json" }, contents);
  server.registerResource("realm-roles", realmTemplate("/roles"),
    { title: "Realm roles", description: "Realm-level roles.", mimeType: "application/json" }, contents);
}
