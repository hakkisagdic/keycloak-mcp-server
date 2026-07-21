import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { cfg, connect, ok, readOnlyRefusal, Realm } from "./client.js";
import { readResourceText } from "./resources.js";

/**
 * Tools that exercise the client-side MCP features — sampling (ask the client's LLM) and elicitation
 * (ask the user). Both degrade gracefully when the connected client does not advertise the
 * capability, so the server stays usable everywhere while still supporting the full spec.
 */
export function registerSpecTools(server: McpServer): void {
  server.tool(
    "kc_ai_review",
    "Ask the connected client's LLM to review a realm's security posture (MCP sampling). Read-only.",
    { realm: Realm },
    async ({ realm }) => {
      const summary = await readResourceText(`keycloak://realm/${realm}`);
      const clients = await readResourceText(`keycloak://realm/${realm}/clients`);
      try {
        const result = await server.server.createMessage({
          maxTokens: 500,
          systemPrompt: "You are a Keycloak security reviewer. Be concise and specific.",
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `Review this realm for security risks and list the top findings with a fix each.\n\nRealm:\n${summary}\n\nClients:\n${clients}`,
              },
            },
          ],
        });
        const text = result.content?.type === "text" ? result.content.text : JSON.stringify(result.content);
        return ok({ ok: true, model: result.model, review: text });
      } catch (e) {
        return ok({ ok: false, error: `sampling unavailable (client may not support it): ${(e as Error).message}` });
      }
    },
  );

  server.tool(
    "kc_delete_realm_interactive",
    "Delete a realm, confirming via MCP elicitation (asks the user directly — no confirm arg). Refused in read-only mode.",
    { realm: Realm },
    async ({ realm }) => {
      if (cfg.readOnly) return readOnlyRefusal();
      try {
        const res = await server.server.elicitInput({
          message: `Permanently delete realm "${realm}" and everything in it? This cannot be undone.`,
          requestedSchema: {
            type: "object",
            properties: { confirm: { type: "boolean", description: `Yes, delete realm ${realm}` } },
            required: ["confirm"],
          },
        });
        if (res.action !== "accept" || (res.content as { confirm?: boolean } | undefined)?.confirm !== true) {
          return ok({ ok: false, cancelled: true, action: res.action });
        }
        const kc = await connect(realm);
        await kc.realms.del({ realm });
        return ok({ ok: true, deleted: realm });
      } catch (e) {
        return ok({ ok: false, error: `elicitation unavailable (client may not support it): ${(e as Error).message}` });
      }
    },
  );
}
