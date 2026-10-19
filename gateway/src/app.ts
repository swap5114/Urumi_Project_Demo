import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type Database from "better-sqlite3";
import { createRegistry } from "./registry.js";
import { createUpstream, type UpstreamOptions } from "./upstream.js";
import { createAggregator } from "./aggregator.js";
import { createAuth } from "./auth.js";
import { createAudit } from "./audit.js";
import { createApi } from "./api.js";
import { createToolService, type Principal } from "./toolService.js";
import { createGatewayServer } from "./gatewayServer.js";
import { createChatAgent } from "./chatAgent.js";
import type { Llm } from "./llm.js";

function bearerToken(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  if (!h) return undefined;
  const [scheme, token] = h.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : undefined;
}

export function createApp(db: Database.Database, upstreamOptions: UpstreamOptions = {}, llm?: Llm): {
  server: HttpServer;
  auth: ReturnType<typeof createAuth>;
  registry: ReturnType<typeof createRegistry>;
  audit: ReturnType<typeof createAudit>;
} {
  const registry = createRegistry(db, upstreamOptions.checkUrl);
  const upstream = createUpstream(registry, upstreamOptions);
  const aggregator = createAggregator(registry, upstream);
  const auth = createAuth(db);
  const audit = createAudit(db);
  const tools = createToolService({ aggregator, upstream, audit: audit.record });
  const deps = { tools };
  // The chat agent uses the same tool service as /mcp, so its calls are routed and audited the same way.
  const chat = llm ? createChatAgent({ llm, tools }) : undefined;
  const api = createApi({ registry, aggregator, auth, audit, chat });

  // The factory runs once per HTTP request. The user was authenticated BEFORE we got here.
  const mcp = toNodeHandler(
    createMcpHandler((ctx) => {
      const user = ctx.authInfo?.extra?.principal as Principal | undefined;
      if (!user) throw new Error("unauthenticated request reached the MCP handler");
      return createGatewayServer(deps, user);
    }),
  );

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://placeholder");
    const pathname = url.pathname;

    if (pathname === "/healthz") { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("ok"); return; } // liveness
    if (pathname === "/readyz") { // readiness: can we reach the DB?
      try { db.prepare("SELECT 1").get(); res.writeHead(200).end("ready"); }
      catch { res.writeHead(503).end("db not ready"); }
      return;
    }

    if (pathname === "/mcp") {
      const key = bearerToken(req);
      const user = key ? auth.authenticate(key) : undefined;
      if (!user) {
        res.writeHead(401, { "Content-Type": "text/plain", "WWW-Authenticate": 'Bearer realm="mcp-gateway"' });
        res.end("Unauthorized");
        return;
      }
      // Hand the identity to the MCP layer. We deliberately do NOT pass the raw key along (token: "").
      (req as IncomingMessage & { auth?: unknown }).auth = {
        token: "", clientId: String(user.id), scopes: [], extra: { principal: { id: user.id, email: user.email, role: user.role } },
      };
      Promise.resolve(mcp(req, res)).catch((err: Error) => {
        console.error("MCP handler failed:", err.message);
        if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal server error");
      });
      return;
    }

    if (pathname.startsWith("/api/")) {
      const key = bearerToken(req);
      const user = key ? auth.authenticate(key) : undefined;
      if (!user) {
        res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": 'Bearer realm="mcp-gateway"' });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      void api(req, res, user, url);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  return { server, auth, registry, audit };
}
