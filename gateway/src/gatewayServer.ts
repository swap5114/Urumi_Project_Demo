import { Server, ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import type { Principal, ToolService } from "./toolService.js";

// Principal and CallRecord live in toolService.ts; re-exported so older imports keep working.
export type { Principal, CallRecord } from "./toolService.js";

export interface GatewayDeps {
  tools: ToolService;
}

// One gateway "face" for ONE authenticated user. createMcpHandler builds a fresh one per HTTP request.
export function createGatewayServer(deps: GatewayDeps, user: Principal): Server {
  const server = new Server({ name: "mcp-gateway", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler("tools/list", async () => ({ tools: await deps.tools.list() }));

  server.setRequestHandler("tools/call", async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const outcome = await deps.tools.call(user, name, args);
    if (!outcome.found) {
      // Unknown or disabled tool: a protocol error (-32602), not a tool failure.
      throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Unknown tool: ${name}`);
    }
    return outcome.result;
  });

  return server;
}
