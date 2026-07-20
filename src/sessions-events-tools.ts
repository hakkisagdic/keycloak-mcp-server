import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type EventType from "@keycloak/keycloak-admin-client/lib/defs/eventTypes.js";
import { z } from "zod";
import { cfg, connect, ok, readOnlyRefusal, Realm } from "./client.js";

const Max = z.number().int().positive().max(200).optional().describe("Max rows (default 50, cap 200)");

const capped = (max: number | undefined) => Math.min(max ?? 50, 200);

/**
 * Register observability and security-ops tools: admin/login event queries and clearing,
 * client session stats, and brute-force (attack detection) status/reset. Same guardrails as
 * the other write tools: read-only refusal on every mutation, dry-run unless confirm=true
 * on every destructive action.
 */
export function registerSessionsEventsTools(server: McpServer): void {
  // ---- admin events ----
  server.tool(
    "kc_list_admin_events",
    "List admin (audit) events with optional operation/resource/date filters.",
    {
      realm: Realm,
      operationType: z.string().optional().describe("e.g. CREATE, UPDATE, DELETE, ACTION"),
      resourceType: z.string().optional().describe("e.g. USER, CLIENT, REALM_ROLE, GROUP"),
      dateFrom: z.string().optional().describe("ISO date, e.g. 2026-07-01"),
      dateTo: z.string().optional().describe("ISO date, e.g. 2026-07-21"),
      max: Max,
    },
    async ({ realm, operationType, resourceType, dateFrom, dateTo, max }) => {
      const limit = capped(max);
      const kc = await connect(realm);
      const events = await kc.realms.findAdminEvents({
        realm,
        operationTypes: operationType,
        resourceTypes: resourceType,
        dateFrom: dateFrom ? new Date(dateFrom) : undefined,
        dateTo: dateTo ? new Date(dateTo) : undefined,
        max: limit,
      });
      return ok({ count: Math.min(events.length, limit), events: events.slice(0, limit) });
    },
  );

  // ---- login events ----
  server.tool(
    "kc_list_login_events",
    "List user (login) events with optional type/user/date filters.",
    {
      realm: Realm,
      type: z.string().optional().describe("Event type, e.g. LOGIN, LOGIN_ERROR, LOGOUT, REFRESH_TOKEN"),
      user: z.string().optional().describe("User id"),
      dateFrom: z.string().optional().describe("ISO date, e.g. 2026-07-01"),
      dateTo: z.string().optional().describe("ISO date, e.g. 2026-07-21"),
      max: Max,
    },
    async ({ realm, type, user, dateFrom, dateTo, max }) => {
      const limit = capped(max);
      const kc = await connect(realm);
      const events = await kc.realms.findEvents({
        realm,
        type: type as EventType | undefined,
        user,
        dateFrom,
        dateTo,
        max: limit,
      });
      return ok({ count: Math.min(events.length, limit), events: events.slice(0, limit) });
    },
  );

  server.tool(
    "kc_clear_admin_events",
    "Clear ALL admin (audit) events in a realm (destructive). Dry-run unless confirm=true.",
    { realm: Realm, confirm: z.boolean().optional().describe("Must be true to actually clear") },
    async ({ realm, confirm }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      if (!confirm) return ok({ ok: true, dryRun: true, realm, note: "Pass confirm=true to clear all admin events." });
      const kc = await connect(realm);
      await kc.realms.clearAdminEvents({ realm });
      return ok({ ok: true, cleared: "adminEvents", realm });
    },
  );

  server.tool(
    "kc_clear_login_events",
    "Clear ALL user (login) events in a realm (destructive). Dry-run unless confirm=true.",
    { realm: Realm, confirm: z.boolean().optional().describe("Must be true to actually clear") },
    async ({ realm, confirm }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      if (!confirm) return ok({ ok: true, dryRun: true, realm, note: "Pass confirm=true to clear all login events." });
      const kc = await connect(realm);
      await kc.realms.clearEvents({ realm });
      return ok({ ok: true, cleared: "loginEvents", realm });
    },
  );

  // ---- sessions ----
  server.tool(
    "kc_get_client_session_stats",
    "Active/offline session counts per client in a realm.",
    { realm: Realm, max: Max },
    async ({ realm, max }) => {
      const limit = capped(max);
      const kc = await connect(realm);
      const stats = await kc.realms.getClientSessionStats({ realm });
      return ok({ count: Math.min(stats.length, limit), stats: stats.slice(0, limit) });
    },
  );

  // ---- brute-force / attack detection ----
  server.tool(
    "kc_get_brute_force_status",
    "Brute-force (attack detection) lockout status for a user.",
    { realm: Realm, userId: z.string().min(1) },
    async ({ realm, userId }) => {
      const kc = await connect(realm);
      const status = await kc.attackDetection.findOne({ id: userId });
      return ok({ userId, status: status ?? null });
    },
  );

  server.tool(
    "kc_clear_brute_force",
    "Clear brute-force lockout for one user (userId) or ALL users (destructive). Dry-run unless confirm=true.",
    {
      realm: Realm,
      userId: z.string().optional().describe("Omit to clear ALL users' lockouts"),
      confirm: z.boolean().optional().describe("Must be true to actually clear"),
    },
    async ({ realm, userId, confirm }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      const scope = userId ? { userId } : { all: true };
      if (!confirm) return ok({ ok: true, dryRun: true, realm, ...scope, note: "Pass confirm=true to clear." });
      const kc = await connect(realm);
      if (userId) await kc.attackDetection.del({ id: userId });
      else await kc.attackDetection.delAll();
      return ok({ ok: true, cleared: "bruteForce", realm, ...scope });
    },
  );
}
