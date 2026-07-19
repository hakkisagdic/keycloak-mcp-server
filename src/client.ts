import KcAdminClient from "@keycloak/keycloak-admin-client";
import { z } from "zod";

export type Grant =
  | { grantType: "client_credentials"; clientId: string; clientSecret: string }
  | { grantType: "password"; clientId: string; username: string; password: string };

type Env = Record<string, string | undefined>;

/** Resolve the admin grant from env — client-credentials wins, else password, else null. */
export function resolveCredential(env: Env): Grant | null {
  const clientId = env.KEYCLOAK_CLIENT_ID ?? "admin-cli";
  if (env.KEYCLOAK_CLIENT_SECRET) {
    return { grantType: "client_credentials", clientId, clientSecret: env.KEYCLOAK_CLIENT_SECRET };
  }
  if (env.KEYCLOAK_ADMIN_USER && env.KEYCLOAK_ADMIN_PASSWORD) {
    return { grantType: "password", clientId, username: env.KEYCLOAK_ADMIN_USER, password: env.KEYCLOAK_ADMIN_PASSWORD };
  }
  return null;
}

/** True if credentials may be sent to this URL (https, or a loopback host over http). */
export function isCredentialUrlSafe(baseUrl: string): boolean {
  const url = new URL(baseUrl);
  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  return url.protocol === "https:" || isLoopback;
}

/** Parse the read-only flag from env. */
export function readOnlyFromEnv(env: Env): boolean {
  return ["1", "true", "yes"].includes((env.KEYCLOAK_MCP_READONLY ?? "").toLowerCase());
}

export const cfg = {
  baseUrl: process.env.KEYCLOAK_URL ?? "http://localhost:8081",
  // Realm the credentials authenticate against (master can administer every realm).
  authRealm: process.env.KEYCLOAK_REALM ?? "master",
  readOnly: readOnlyFromEnv(process.env),
};

export const credential: Grant | null = resolveCredential(process.env);

/**
 * Build a freshly-authenticated client for a single request. A per-call client keeps the realm
 * target and token call-local, so concurrent tool invocations never race on shared mutable state.
 * Auth happens against `authRealm`; operations target `realm`.
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
