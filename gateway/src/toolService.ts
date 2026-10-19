import type { CallToolResult, Tool } from "@modelcontextprotocol/client";
import type { createAggregator } from "./aggregator.js";
import type { createUpstream } from "./upstream.js";

type Aggregator = ReturnType<typeof createAggregator>;
type Upstream = ReturnType<typeof createUpstream>;

// Who is making a call. Produced from the API key (auth.ts), used for the audit log.
export interface Principal {
  id: number;
  email: string;
  role: "admin" | "member";
}

export interface CallRecord {
  user: Principal;
  serverSlug: string | null;
  tool: string;
  durationMs: number;
  outcome: "success" | "error";
  error?: string;
}

export type CallOutcome = { found: false } | { found: true; result: CallToolResult };

export interface ToolService {
  list(): Promise<Tool[]>;
  call(user: Principal, name: string, args: Record<string, unknown>): Promise<CallOutcome>;
}

export interface ToolServiceDeps {
  aggregator: Aggregator;
  upstream: Upstream;
  audit?: (rec: CallRecord) => void;
}

// The ONE place where a tool call is routed, executed and audited.
// The MCP endpoint (/mcp) and the chat agent both go through here, so both are audited under the real user.
export function createToolService(deps: ToolServiceDeps): ToolService {
  return {
    async list() {
      return (await deps.aggregator.listAllTools()).tools;
    },

    async call(user, name, args) {
      const started = Date.now();
      const target = deps.aggregator.route(name);
      if (!target) {
        // Unknown, malformed or DISABLED-server tool. The caller decides how to report it.
        deps.audit?.({ user, serverSlug: null, tool: name, durationMs: Date.now() - started, outcome: "error", error: "unknown tool" });
        return { found: false };
      }

      // callTool never throws: an upstream failure comes back as { isError: true, ... }
      const result = await deps.upstream.callTool(target.server.id, target.tool, args);
      deps.audit?.({
        user,
        serverSlug: target.server.slug,
        tool: target.tool,
        durationMs: Date.now() - started,
        outcome: result.isError ? "error" : "success",
        error: result.isError ? JSON.stringify(result.content).slice(0, 300) : undefined,
      });
      return { found: true, result };
    },
  };
}
