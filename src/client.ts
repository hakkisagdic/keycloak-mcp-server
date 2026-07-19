import KcAdminClient from "@keycloak/keycloak-admin-client";
import { z } from "zod";

export const cfg = {
  baseUrl: process.env.KEYCLOAK_URL ?? "http://localhost:8081",
  // Realm the credentials authenticate against (master can administer every realm).
  authRealm: process.env.KEYCLOAK_REALM ?? "master",
  clientId: process.env.KEYCLOAK_CLIENT_ID ?? "admin-cli",
  clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
  username: process.env.KEYCLOAK_ADMIN_USER,
  password: process.env.KEYCLOAK_ADMIN_PASSWORD,
  // When true, all write tools refuse. Set KEYCLOAK_MCP_READONLY=true|1.
  readOnly: ["1", "true", "yes"].includes((process.env.KEYCLOAK_MCP_READONLY ?? "").toLowerCase()),
};

// Require explicit credentials — never silently fall back to a default admin password.
export type Grant =
  | { grantType: "client_credentials"; clientId: string; clientSecret: string }
  | { grantType: "password"; clientId: string; username: string; password: string };

export const credential: Grant | null = cfg.clientSecret
  ? { grantType: "client_credentials", clientId: cfg.clientId, clientSecret: cfg.clientSecret }
  : cfg.username && cfg.password
    ? { grantType: "password", clientId: cfg.clientId, username: cfg.username, password: cfg.password }
    : null;

/**
 * Build a freshly-authenticated client for a single request. A per-call client keeps the
 * realm target and token call-local, so concurrent tool invocations never race on shared
 * mutable state. Auth happens against `authRealm`; operations target `realm`.
 */
export async function connect(realm: string): Promise<KcAdminClient> {
  const kc = new KcAdminClient({ baseUrl: cfg.baseUrl, realmName: cfg.authRealm });
  await kc.auth(credential!);
  kc.setConfig({ realmName: realm });
  return kc;
}

export const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

/** Standard refusal payload when the server is in read-only mode. */
export const readOnlyRefusal = () =>
  ok({ ok: false, error: "read-only mode (KEYCLOAK_MCP_READONLY) — write refused" });

export const Realm = z.string().min(1).describe("Realm name");
