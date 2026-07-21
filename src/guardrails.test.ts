import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Structural safety invariants across ALL tool modules — a permanent guard so a future tool can't
 * silently ship without its guardrail. Parses the source rather than executing (no live Keycloak).
 */

const here = dirname(fileURLToPath(import.meta.url));
// The 111 CRUD tool modules share one guardrail shape. spec-tools.ts is excluded: its two
// demonstrators intentionally use the client-feature patterns instead (kc_ai_review is read-only
// sampling; kc_delete_realm_interactive confirms via elicitation, not a confirm flag) — both are
// verified live, not structurally.
const toolFiles = readdirSync(here).filter(
  (f) => f.endsWith("-tools.ts") && !f.endsWith(".test.ts") && f !== "spec-tools.ts",
);

type Tool = { name: string; body: string };

function toolsIn(src: string): Tool[] {
  // Split on server.tool(" and recover the name + the block up to the next registration.
  const parts = src.split(/server\.tool\(\s*"/).slice(1);
  return parts.map((p) => {
    const name = p.slice(0, p.indexOf('"'));
    return { name, body: p };
  });
}

const allTools: Tool[] = toolFiles.flatMap((f) => toolsIn(readFileSync(join(here, f), "utf8")));

const isMutating = (n: string) => !/^kc_(list|get|count)/.test(n);
const isDestructive = (n: string) => /(delete|_del\b|clear|logout|regenerate)/.test(n);

describe("tool guardrails (structural)", () => {
  it("discovers the full tool surface", () => {
    expect(allTools.length).toBeGreaterThan(100);
  });

  it("every mutating tool refuses in read-only mode before any change", () => {
    const offenders = allTools
      .filter((t) => isMutating(t.name))
      .filter((t) => !/if \(cfg\.readOnly\) return readOnlyRefusal\(\)/.test(t.body))
      .map((t) => t.name);
    expect(offenders, `mutating tools missing the read-only gate: ${offenders.join(", ")}`).toEqual([]);
  });

  it("every destructive tool is a dry-run unless confirm=true", () => {
    const offenders = allTools
      .filter((t) => isDestructive(t.name))
      .filter((t) => !/if \(!confirm\)/.test(t.body))
      .map((t) => t.name);
    expect(offenders, `destructive tools missing the confirm gate: ${offenders.join(", ")}`).toEqual([]);
  });

  it("no destructive tool mutates before its confirm check", () => {
    const mutators = /\.(del|delById|delByName|remove|clear|logout|regenerate|generateNewClientSecret|delRealm|delRole|delProtocolMapper|delComponent|delMapper|delGroup)\s*\(/;
    const offenders = allTools
      .filter((t) => isDestructive(t.name))
      .filter((t) => {
        const confirmPos = t.body.search(/if \(!confirm\)/);
        const mutPos = t.body.search(mutators);
        return confirmPos === -1 || (mutPos !== -1 && mutPos < confirmPos);
      })
      .map((t) => t.name);
    expect(offenders, `destructive tools whose mutation precedes the confirm gate: ${offenders.join(", ")}`).toEqual([]);
  });
});
