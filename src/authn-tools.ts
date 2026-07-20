import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cfg, connect, ok, readOnlyRefusal, Realm } from "./client.js";

type Kc = Awaited<ReturnType<typeof connect>>;

const Max = z.number().int().positive().optional().describe("Max results (default 50, cap 200)");

const cap = (max?: number) => Math.min(max ?? 50, 200);

async function findRequiredAction(kc: Kc, alias: string) {
  const actions = await kc.authenticationManagement.getRequiredActions();
  return actions.find((a) => a.alias === alias);
}

/**
 * Register authentication-configuration tools — flows, flow executions, and required actions.
 * Read-heavy; same guardrails as the other write tools: read-only refusal on every mutation,
 * and confirm=true dry-run gating on the destructive flow delete (built-in flows are refused).
 */
export function registerAuthnTools(server: McpServer): void {
  server.tool(
    "kc_list_auth_flows",
    "List authentication flows in a realm.",
    { realm: Realm, search: z.string().optional().describe("Substring filter on flow alias"), max: Max },
    async ({ realm, search, max }) => {
      const kc = await connect(realm);
      const flows = await kc.authenticationManagement.getFlows();
      const filtered = search ? flows.filter((f) => f.alias?.toLowerCase().includes(search.toLowerCase())) : flows;
      return ok(filtered.slice(0, cap(max)).map((f) => ({
        id: f.id, alias: f.alias, description: f.description, providerId: f.providerId, topLevel: f.topLevel, builtIn: f.builtIn,
      })));
    },
  );

  server.tool(
    "kc_get_flow_executions",
    "List the executions of an authentication flow by flow alias.",
    { realm: Realm, flowAlias: z.string().min(1).describe("Flow alias"), max: Max },
    async ({ realm, flowAlias, max }) => {
      const kc = await connect(realm);
      const executions = await kc.authenticationManagement.getExecutions({ flow: flowAlias });
      return ok(executions.slice(0, cap(max)).map((e) => ({
        id: e.id, displayName: e.displayName, providerId: e.providerId, requirement: e.requirement,
        requirementChoices: e.requirementChoices, level: e.level, index: e.index,
        configurable: e.configurable, authenticationFlow: e.authenticationFlow, flowId: e.flowId,
      })));
    },
  );

  server.tool(
    "kc_list_required_actions",
    "List required actions registered in a realm.",
    { realm: Realm, max: Max },
    async ({ realm, max }) => {
      const kc = await connect(realm);
      const actions = await kc.authenticationManagement.getRequiredActions();
      return ok(actions.slice(0, cap(max)).map((a) => ({
        alias: a.alias, name: a.name, providerId: a.providerId, enabled: a.enabled, defaultAction: a.defaultAction, priority: a.priority,
      })));
    },
  );

  server.tool(
    "kc_update_required_action",
    "Update a required action by alias (merge: only provided fields change).",
    {
      realm: Realm,
      alias: z.string().min(1).describe("Required action alias, e.g. CONFIGURE_TOTP"),
      enabled: z.boolean().optional(),
      defaultAction: z.boolean().optional().describe("Apply to all new users"),
    },
    async ({ realm, alias, enabled, defaultAction }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const current = await findRequiredAction(kc, alias);
      if (!current) return ok({ ok: false, error: `Required action '${alias}' not found.` });
      await kc.authenticationManagement.updateRequiredAction(
        { alias },
        { ...current, enabled: enabled ?? current.enabled, defaultAction: defaultAction ?? current.defaultAction },
      );
      return ok({ ok: true, alias, enabled: enabled ?? current.enabled, defaultAction: defaultAction ?? current.defaultAction });
    },
  );

  server.tool(
    "kc_lower_required_action_priority",
    "Move a required action one position down in the priority order.",
    { realm: Realm, alias: z.string().min(1).describe("Required action alias") },
    async ({ realm, alias }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const current = await findRequiredAction(kc, alias);
      if (!current) return ok({ ok: false, error: `Required action '${alias}' not found.` });
      await kc.authenticationManagement.lowerRequiredActionPriority({ alias });
      return ok({ ok: true, alias, loweredFromPriority: current.priority });
    },
  );

  server.tool(
    "kc_copy_auth_flow",
    "Copy an authentication flow (by source alias) to a new flow name.",
    { realm: Realm, flowAlias: z.string().min(1).describe("Source flow alias"), newName: z.string().min(1).describe("Name of the copy") },
    async ({ realm, flowAlias, newName }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      await kc.authenticationManagement.copyFlow({ flow: flowAlias, newName });
      return ok({ ok: true, copiedFrom: flowAlias, newName });
    },
  );

  server.tool(
    "kc_delete_auth_flow",
    "Delete a non-built-in authentication flow by id (destructive). Dry-run unless confirm=true.",
    { realm: Realm, flowId: z.string().min(1).describe("Flow id (uuid)"), confirm: z.boolean().optional().describe("Must be true to actually delete") },
    async ({ realm, flowId, confirm }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const kc = await connect(realm);
      const flow = await kc.authenticationManagement.getFlow({ flowId }, { catchNotFound: true });
      if (!flow) return ok({ ok: false, error: `Flow '${flowId}' not found.` });
      if (flow.builtIn) return ok({ ok: false, error: `Flow '${flow.alias}' is built-in — refusing to delete.` });
      if (!confirm) return ok({ ok: true, dryRun: true, flowId, alias: flow.alias, note: "Pass confirm=true to delete." });
      await kc.authenticationManagement.deleteFlow({ flowId });
      return ok({ ok: true, deleted: flowId, alias: flow.alias });
    },
  );
}
