import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/**
 * Derive MCP tool annotations from a tool name. Reads (`kc_list/get/count_*`) are read-only;
 * `delete/clear/logout/regenerate` are destructive; `update/set/assign/add/enable/remove` are
 * idempotent (re-running converges to the same state).
 */
export function annotationsFor(name: string): ToolAnnotations {
  const readOnly = /^kc_(list|get|count)/.test(name);
  const destructive = /(delete|_del\b|clear|logout|regenerate)/.test(name);
  const idempotent = /^kc_(update|set|assign|add|enable|remove)/.test(name);
  return {
    readOnlyHint: readOnly,
    destructiveHint: !readOnly && destructive,
    ...(!readOnly && idempotent ? { idempotentHint: true } : {}),
  };
}
