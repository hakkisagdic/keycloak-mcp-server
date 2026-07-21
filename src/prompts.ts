import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { z } from "zod";
import { cfg, connect } from "./client.js";

/**
 * Reusable admin workflows exposed as MCP prompts. Their realm / clientId arguments autocomplete
 * from the live Keycloak (completion/complete), so a human never has to type an exact name.
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

async function clientIds(realm: string, prefix = ""): Promise<string[]> {
  try {
    const kc = await connect(realm || cfg.authRealm);
    return (await kc.clients.find({ realm: realm || cfg.authRealm }))
      .map((c) => c.clientId)
      .filter((n): n is string => !!n && n.toLowerCase().startsWith(prefix.toLowerCase()))
      .slice(0, 50);
  } catch {
    return [];
  }
}

const userMessage = (text: string) => ({
  messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
});

const realmArg = () => completable(z.string().describe("Realm name"), (v) => realmNames(v));
const clientArg = () =>
  completable(z.string().describe("clientId"), (v, ctx) => clientIds(ctx?.arguments?.realm ?? "", v));

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "audit_realm_security",
    {
      title: "Audit realm security",
      description: "Guide a security review of one realm using the read tools.",
      argsSchema: { realm: realmArg() },
    },
    ({ realm }) =>
      userMessage(
        `You are a Keycloak security auditor. Audit the realm "${realm}". Read keycloak://realm/${realm} ` +
          `and keycloak://realm/${realm}/clients, then use the tools: kc_get_realm (sslRequired, brute-force, ` +
          `password policy), kc_list_clients (public clients with standard flow, wildcard redirect URIs, ` +
          `directAccessGrants), kc_list_required_actions, kc_get_realm_events_config (is event logging on?), ` +
          `and kc_list_admin_events for recent privileged changes. Report findings ranked by severity with a ` +
          `concrete remediation for each. Do not make any changes.`,
      ),
  );

  server.registerPrompt(
    "diagnose_login_failures",
    {
      title: "Diagnose login failures",
      description: "Investigate failed logins / lockouts for a realm (optionally one user).",
      argsSchema: { realm: realmArg(), username: z.string().optional().describe("Optional username to focus on") },
    },
    ({ realm, username }) =>
      userMessage(
        `Investigate login failures in realm "${realm}"${username ? ` for user "${username}"` : ""}. ` +
          `Use kc_list_login_events (type=LOGIN_ERROR) over the recent window, kc_get_brute_force_status ` +
          `${username ? "for that user" : "for the most-affected users"}, and check kc_get_realm brute-force ` +
          `settings. Summarize the failure pattern (bad password vs disabled account vs lockout vs client ` +
          `misconfig) and recommend next steps. Read-only.`,
      ),
  );

  server.registerPrompt(
    "onboard_client",
    {
      title: "Onboard an OIDC client",
      description: "Walk through creating and wiring a new OIDC client.",
      argsSchema: { realm: realmArg(), clientId: z.string().describe("New clientId") },
    },
    ({ realm, clientId }) =>
      userMessage(
        `Create and wire the OIDC client "${clientId}" in realm "${realm}". Steps: kc_create_client (decide ` +
          `public vs confidential and the flows it needs), attach the right default/optional scopes with ` +
          `kc_add_default_client_scope, add any protocol mappers via kc_create_client_protocol_mapper, and if ` +
          `confidential fetch the secret with kc_get_client_secret. Confirm each write before running it, and ` +
          `summarize the final client configuration.`,
      ),
  );

  server.registerPrompt(
    "rotate_client_secret",
    {
      title: "Rotate a client secret",
      description: "Safely rotate a confidential client's secret.",
      argsSchema: { realm: realmArg(), clientId: clientArg() },
    },
    ({ realm, clientId }) =>
      userMessage(
        `Rotate the secret for client "${clientId}" in realm "${realm}". First kc_get_client_secret to record ` +
          `the current value, warn that rotation immediately invalidates the old secret for every consumer, then ` +
          `run kc_regenerate_client_secret with confirm=true only after I approve, and report the new secret so ` +
          `it can be redeployed.`,
      ),
  );
}
