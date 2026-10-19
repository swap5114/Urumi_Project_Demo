import { Client, ProtocolError, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { CallToolResult, Tool } from "@modelcontextprotocol/client";
import { assertSafeUpstreamUrl } from "./ssrf.js";
import type { ServerForCall, createRegistry } from "./registry.js";

type Registry = ReturnType<typeof createRegistry>;

export interface UpstreamOptions {
  listTimeoutMs?: number;
  callTimeoutMs?: number;
  checkUrl?: (url: string) => Promise<unknown>; // injectable so tests can reach localhost
}

// A failure we can explain in one short sentence, safe to show an admin or a model.
export class UpstreamError extends Error {}

function buildHeaders(s: ServerForCall): Record<string, string> {
  if (!s.credential) return {};
  if (s.authType === "bearer") return { Authorization: `Bearer ${s.credential}` };
  if (s.authType === "header" && s.authHeader) return { [s.authHeader]: s.credential };
  return {};
}

// Turn any thrown thing into a short reason. NEVER include headers/credentials in it.
function explain(err: unknown, timeoutMs: number): string {
  const e = err as any;
  const code = e?.cause?.code ?? e?.code;
  if (e?.name === "TimeoutError" || e?.name === "AbortError" || /timeout|aborted/i.test(String(e?.message))) return `timed out after ${timeoutMs}ms`;
  if (code === "ECONNREFUSED") return "connection refused";
  if (code === "ENOTFOUND") return "DNS name not found";
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") return "connection reset";
  if (e?.status === 401 || e?.code === 401 || /\b401\b/.test(String(e?.message))) return "upstream rejected the credential (401)";
  return String(e?.message ?? e).slice(0, 200);
}

export function createUpstream(registry: Registry, opts: UpstreamOptions = {}) {
  const listTimeoutMs = opts.listTimeoutMs ?? 3000;
  const callTimeoutMs = opts.callTimeoutMs ?? 15000;
  const checkUrl = opts.checkUrl ?? assertSafeUpstreamUrl;

  // Open a fresh MCP session, run fn, ALWAYS close. One deadline covers connect + request.
  async function withClient<T>(s: ServerForCall, timeoutMs: number, fn: (c: Client, signal: AbortSignal) => Promise<T>): Promise<T> {
    await checkUrl(s.url); // re-check on EVERY call: DNS may have changed since the admin added it
    const client = new Client({ name: "mcp-gateway", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(s.url), {
      requestInit: { headers: buildHeaders(s), redirect: "error" }, // a redirect could point at an internal address
    });
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      await client.connect(transport, { signal });
      return await fn(client, signal);
    } finally {
      await client.close().catch(() => {});
    }
  }

  function load(serverId: number): ServerForCall {
    const s = registry.getForCall(serverId);
    if (!s) throw new UpstreamError("server not found");
    return s;
  }

  return {
    // Never throws. Returns tools or a reason, and records the status in the DB.
    async listTools(serverId: number): Promise<{ ok: true; tools: Tool[] } | { ok: false; reason: string }> {
      try {
        const s = load(serverId);
        const tools = await withClient(s, listTimeoutMs, async (c, signal) => (await c.listTools(undefined, { signal })).tools);
        registry.setStatus(serverId, "connected", null);
        return { ok: true, tools };
      } catch (err) {
        const reason = explain(err, listTimeoutMs);
        registry.setStatus(serverId, "unreachable", reason);
        return { ok: false, reason };
      }
    },

    // Never throws. A failure becomes a normal tool result with isError: true.
    async callTool(serverId: number, tool: string, args: Record<string, unknown>): Promise<CallToolResult> {
      let slug = String(serverId);
      try {
        const s = load(serverId);
        slug = s.slug;
        const result = await withClient(s, callTimeoutMs, (c, signal) => c.callTool({ name: tool, arguments: args }, { signal }));
        registry.setStatus(serverId, "connected", null);
        return result;
      } catch (err) {
        const reason = explain(err, callTimeoutMs);
        // The server ANSWERED with a protocol error (unknown tool, bad params): it is reachable, the call is just wrong.
        if (err instanceof ProtocolError) registry.setStatus(serverId, "connected", null);
        else registry.setStatus(serverId, "unreachable", reason);
        return { isError: true, content: [{ type: "text", text: `[${slug}] ${tool} failed: ${reason}` }] };
      }
    },
  };
}
