import { describe, it, expect } from "vitest";
import { annotationsFor } from "./annotations.js";

describe("annotationsFor", () => {
  it("marks reads read-only", () => {
    for (const n of ["kc_list_realms", "kc_get_client", "kc_count_users"]) {
      expect(annotationsFor(n)).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
  });

  it("marks deletes/clears/logout/regenerate destructive (and not read-only)", () => {
    for (const n of ["kc_delete_realm", "kc_clear_admin_events", "kc_logout_user", "kc_regenerate_client_secret"]) {
      const a = annotationsFor(n);
      expect(a.readOnlyHint).toBe(false);
      expect(a.destructiveHint).toBe(true);
    }
  });

  it("marks updates/assigns idempotent but not destructive", () => {
    const a = annotationsFor("kc_update_user");
    expect(a.destructiveHint).toBe(false);
    expect(a.idempotentHint).toBe(true);
  });

  it("marks creates neither read-only nor destructive", () => {
    const a = annotationsFor("kc_create_client");
    expect(a.readOnlyHint).toBe(false);
    expect(a.destructiveHint).toBe(false);
  });
});
