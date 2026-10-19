import { openDb } from "./db.js";
import { createApp } from "./app.js";
import { ensureBootstrapAdmin } from "./auth.js";
import { seedServers } from "./seed.js";
import { createLlm } from "./llm.js";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 8080);

// Timeouts are configuration, not constants: a cold upstream may need more time than a warm one.
const ms = (v: string | undefined, fallback: number): number => (Number(v) > 0 ? Number(v) : fallback);

// The chat agent needs an LLM. Without a key and a model the gateway still works, only /api/chat answers 503.
// Any OpenAI-compatible provider works: change LLM_BASE_URL, LLM_MODEL and the key (Gemini, Groq, Ollama...).
const llm =
  process.env.LLM_API_KEY && process.env.LLM_MODEL
    ? createLlm({
        baseUrl: process.env.LLM_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai",
        model: process.env.LLM_MODEL,
        apiKey: process.env.LLM_API_KEY,
        timeoutMs: ms(process.env.LLM_TIMEOUT_MS, 30000),
      })
    : undefined;
console.log(llm ? `chat enabled (model ${process.env.LLM_MODEL})` : "chat disabled: LLM_API_KEY or LLM_MODEL not set");

const db = openDb();
const { server, auth, registry } = createApp(
  db,
  {
    listTimeoutMs: ms(process.env.LIST_TIMEOUT_MS, 3000),
    callTimeoutMs: ms(process.env.CALL_TIMEOUT_MS, 15000),
  },
  llm,
);
const isNewDatabase = ensureBootstrapAdmin(auth, db, process.env.BOOTSTRAP_ADMIN_EMAIL, process.env.BOOTSTRAP_ADMIN_KEY);

server.listen(PORT, HOST, () => console.log(`gateway listening on http://${HOST}:${PORT}/mcp`));

// Seed the first upstream servers only on the very first start, so a server an admin later deletes stays deleted.
if (isNewDatabase) await seedServers(registry, process.env.SEED_SERVERS);

// Kubernetes sends SIGTERM when it stops a pod: finish in-flight requests, then exit.
function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down`);
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
