import { createServer } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import {
  toNodeHandler,
  localhostHostValidation,
  localhostOriginValidation,
} from "@modelcontextprotocol/node";
import { createWooServer } from "./server.js";
import { loadConfig } from "./wooClient.js";
loadConfig();

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3000);
const isLoopback = HOST === "127.0.0.1" || HOST === "localhost" || HOST === "::1";


const nodeHandler = toNodeHandler(createMcpHandler(() => createWooServer()));


const validateHost = isLoopback ? localhostHostValidation() : null;
const validateOrigin = isLoopback ? localhostOriginValidation() : null;

const httpServer = createServer((req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://placeholder");

  // Liveness: answers without calling WooCommerce, so a slow store never restarts this pod.
  // Checked BEFORE the Host guard because kubelet probes use the pod IP as Host.
  if (pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  if (pathname !== "/mcp") {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }

  if (validateHost && !validateHost(req, res)) return;
  if (validateOrigin && !validateOrigin(req, res)) return;

  Promise.resolve(nodeHandler(req, res)).catch((err: Error) => {
    console.error("MCP handler failed:", err.message);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" });
    }
    res.end("Internal server error");
  });
});

httpServer.listen(PORT, HOST, () => {
  console.log(`woocommerce-mcp listening on http://${HOST}:${PORT}/mcp`);
});

// Kubernetes sends SIGTERM when it stops a pod: finish in-flight requests, then exit.
function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down`);
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref(); // do not hang forever
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));