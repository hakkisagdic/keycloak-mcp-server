import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createHash } from "node:crypto";
import { readResourceText } from "./resources.js";

/**
 * Resource subscriptions (MCP `resources/subscribe`). A subscribed URI is polled; when its content
 * hash changes the server emits `notifications/resources/updated`. Meaningful for the persistent
 * (stdio) transport; harmless in stateless HTTP where each request is its own short-lived server.
 */

const POLL_MS = Number(process.env.KEYCLOAK_MCP_SUBSCRIBE_POLL_MS ?? 15000);

export function installResourceSubscriptions(server: McpServer): void {
  const hashes = new Map<string, string>();
  let timer: NodeJS.Timeout | null = null;

  const hashOf = async (uri: string): Promise<string | null> => {
    try {
      const text = await readResourceText(uri);
      return text === null ? null : createHash("sha256").update(text).digest("hex");
    } catch {
      return null;
    }
  };

  const tick = async () => {
    for (const uri of hashes.keys()) {
      const h = await hashOf(uri);
      if (h && h !== hashes.get(uri)) {
        hashes.set(uri, h);
        void server.server.sendResourceUpdated({ uri }).catch(() => {});
      }
    }
  };

  const ensureTimer = () => {
    if (!timer && hashes.size > 0) timer = setInterval(() => void tick(), POLL_MS).unref?.() ?? setInterval(() => void tick(), POLL_MS);
  };
  const maybeStopTimer = () => {
    if (timer && hashes.size === 0) {
      clearInterval(timer);
      timer = null;
    }
  };

  server.server.setRequestHandler(SubscribeRequestSchema, async (req) => {
    const uri = req.params.uri;
    hashes.set(uri, (await hashOf(uri)) ?? "");
    ensureTimer();
    return {};
  });

  server.server.setRequestHandler(UnsubscribeRequestSchema, async (req) => {
    hashes.delete(req.params.uri);
    maybeStopTimer();
    return {};
  });

  server.server.onclose = () => {
    if (timer) clearInterval(timer);
    timer = null;
    hashes.clear();
  };
}
