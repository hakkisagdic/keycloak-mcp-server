import type { IncomingMessage } from "node:http";
import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Bearer-token gate for the remote Streamable HTTP transport. Three modes, chosen by env:
 *
 *   OIDC (recommended, KEYCLOAK_MCP_OIDC_ISSUER set):
 *     Validates a JWT access token against the issuer's JWKS (RS256), optional audience, and an
 *     optional required realm role. This turns the server into a proper OAuth2 Resource Server —
 *     e.g. protect it with the very Keycloak it administers.
 *       KEYCLOAK_MCP_OIDC_ISSUER    e.g. https://auth.example.com/realms/master
 *       KEYCLOAK_MCP_OIDC_JWKS_URI  optional override (defaults to <issuer>/protocol/openid-connect/certs)
 *       KEYCLOAK_MCP_OIDC_AUDIENCE  optional expected aud
 *       KEYCLOAK_MCP_REQUIRED_ROLE  optional realm_access.roles entry the caller must hold
 *
 *   STATIC (KEYCLOAK_MCP_BEARER_TOKEN set): a shared secret compared in constant time. Simple for
 *     a single trusted caller; no discovery, no rotation.
 *
 *   NONE (neither set): no gate. The caller (index.ts) MUST bind to loopback only in this mode.
 */

const rawIssuer = process.env.KEYCLOAK_MCP_OIDC_ISSUER;
const issuer = rawIssuer ? rawIssuer.replace(/\/$/, "") : undefined;
const audience = process.env.KEYCLOAK_MCP_OIDC_AUDIENCE || undefined;
const requiredRole = process.env.KEYCLOAK_MCP_REQUIRED_ROLE || undefined;
const staticToken = process.env.KEYCLOAK_MCP_BEARER_TOKEN || undefined;

export type AuthMode = "oidc" | "static" | "none";
export const authMode: AuthMode = issuer ? "oidc" : staticToken ? "static" : "none";

const jwks = issuer
  ? createRemoteJWKSet(
      new URL(process.env.KEYCLOAK_MCP_OIDC_JWKS_URI || `${issuer}/protocol/openid-connect/certs`),
    )
  : null;

export const resourceMetadataPath = "/.well-known/oauth-protected-resource";

/** RFC 9728 Protected Resource Metadata — points clients at the authorization server. */
export function resourceMetadata(resourceUrl: string) {
  return {
    resource: resourceUrl,
    authorization_servers: issuer ? [issuer] : [],
    bearer_methods_supported: ["header"],
  };
}

/** `WWW-Authenticate` challenge header value for a 401. */
export function wwwAuthenticate(resourceMetadataUrl: string): string {
  return `Bearer resource_metadata="${resourceMetadataUrl}"`;
}

function bearer(req: IncomingMessage): string | null {
  const h = req.headers["authorization"];
  if (!h || Array.isArray(h)) return null;
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type AuthResult = { ok: true } | { ok: false; status: number; error: string };

export async function authorize(req: IncomingMessage): Promise<AuthResult> {
  if (authMode === "none") return { ok: true };

  const token = bearer(req);
  if (!token) return { ok: false, status: 401, error: "missing bearer token" };

  if (authMode === "static") {
    return constantTimeEqual(token, staticToken!)
      ? { ok: true }
      : { ok: false, status: 401, error: "invalid token" };
  }

  try {
    const { payload } = await jwtVerify(token, jwks!, {
      issuer,
      audience,
    });
    if (requiredRole) {
      const realmAccess = payload["realm_access"] as { roles?: unknown } | undefined;
      const roles = Array.isArray(realmAccess?.roles) ? (realmAccess!.roles as string[]) : [];
      if (!roles.includes(requiredRole)) {
        return { ok: false, status: 403, error: `missing required realm role '${requiredRole}'` };
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, status: 401, error: `token validation failed: ${(e as Error).message}` };
  }
}
