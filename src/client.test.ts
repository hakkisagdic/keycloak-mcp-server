import { describe, it, expect } from "vitest";
import { resolveCredential, isCredentialUrlSafe, readOnlyFromEnv } from "./client.js";

describe("resolveCredential", () => {
  it("prefers client-credentials when a secret is set", () => {
    const g = resolveCredential({ KEYCLOAK_CLIENT_SECRET: "s", KEYCLOAK_ADMIN_USER: "u", KEYCLOAK_ADMIN_PASSWORD: "p" });
    expect(g).toEqual({ grantType: "client_credentials", clientId: "admin-cli", clientSecret: "s" });
  });
  it("uses password grant when only user/pass are set", () => {
    const g = resolveCredential({ KEYCLOAK_ADMIN_USER: "u", KEYCLOAK_ADMIN_PASSWORD: "p" });
    expect(g).toEqual({ grantType: "password", clientId: "admin-cli", username: "u", password: "p" });
  });
  it("returns null when nothing is set", () => {
    expect(resolveCredential({})).toBeNull();
  });
  it("honors a custom clientId", () => {
    expect(resolveCredential({ KEYCLOAK_CLIENT_ID: "svc", KEYCLOAK_CLIENT_SECRET: "s" })).toMatchObject({ clientId: "svc" });
  });
});

describe("isCredentialUrlSafe", () => {
  it("allows https to any host", () => {
    expect(isCredentialUrlSafe("https://kc.example.com")).toBe(true);
  });
  it("allows http to loopback", () => {
    expect(isCredentialUrlSafe("http://localhost:8081")).toBe(true);
    expect(isCredentialUrlSafe("http://127.0.0.1:8081")).toBe(true);
  });
  it("refuses http to a remote host", () => {
    expect(isCredentialUrlSafe("http://kc.example.com")).toBe(false);
  });
});

describe("readOnlyFromEnv", () => {
  it("parses truthy values", () => {
    for (const v of ["1", "true", "TRUE", "yes"]) {
      expect(readOnlyFromEnv({ KEYCLOAK_MCP_READONLY: v })).toBe(true);
    }
  });
  it("defaults to false", () => {
    expect(readOnlyFromEnv({})).toBe(false);
    expect(readOnlyFromEnv({ KEYCLOAK_MCP_READONLY: "false" })).toBe(false);
  });
});
