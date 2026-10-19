import type { IncomingMessage, ServerResponse } from "node:http";
import type { createRegistry, ServerPublic, AuthType } from "./registry.js";
import type { createAggregator } from "./aggregator.js";
import { parseName } from "./aggregator.js";
import type { createAuth, AuthedUser } from "./auth.js";
import type { createAudit } from "./audit.js";
import type { createChatAgent, HistoryItem } from "./chatAgent.js";
import { LlmError } from "./llm.js";

export interface ApiDeps {
  registry: ReturnType<typeof createRegistry>;
  aggregator: ReturnType<typeof createAggregator>;
  auth: ReturnType<typeof createAuth>;
  audit: ReturnType<typeof createAudit>;
  chat?: ReturnType<typeof createChatAgent>; // absent when no LLM is configured
}

// Chat limits: every question costs model quota, so bound what one request and one user can do.
const MAX_HISTORY = 20;
const MAX_MESSAGE_CHARS = 4000;

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type Body = Record<string, unknown>;
interface Ctx { user: AuthedUser; params: string[]; query: URLSearchParams; body: Body }
type Handler = (c: Ctx) => Promise<[number, unknown?]> | [number, unknown?];
interface Route { method: string; re: RegExp; adminOnly: boolean; handler: Handler }

const MAX_BODY = 64 * 1024;

async function readJson(req: IncomingMessage): Promise<Body> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "body too large");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as Body;
  } catch {
    throw new HttpError(400, "body must be a JSON object");
  }
}

function reqString(b: Body, k: string): string {
  const v = b[k];
  if (typeof v !== "string" || !v.trim()) throw new HttpError(400, `"${k}" is required`);
  return v;
}
function optString(b: Body, k: string): string | undefined {
  const v = b[k];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new HttpError(400, `"${k}" must be a string`);
  return v;
}

// Known registry/validation errors become 400, unique-constraint clashes become 409.
// Anything else is a bug and falls through to a generic 500 (no internals leaked).
function userError<T>(fn: () => T): T;
function userError<T>(fn: () => Promise<T>): Promise<T>;
function userError(fn: () => unknown): unknown {
  const wrap = (e: unknown): never => {
    const err = e as Error & { code?: string };
    if (err.code?.startsWith("SQLITE_CONSTRAINT")) throw new HttpError(409, "already exists");
    throw new HttpError(400, err.message);
  };
  try {
    const r = fn();
    return r instanceof Promise ? r.catch(wrap) : r;
  } catch (e) { return wrap(e); }
}

export function createApi(d: ApiDeps) {
  const routes: Route[] = [];
  const add = (method: string, path: string, adminOnly: boolean, handler: Handler) =>
    routes.push({ method, re: new RegExp("^" + path.replace(/:\w+/g, "([^/]+)") + "$"), adminOnly, handler });

  const intParam = (s: string): number => {
    const n = Number(s);
    if (!Number.isInteger(n) || n < 1) throw new HttpError(400, "bad id");
    return n;
  };

  // What the dashboard sees for a server. No credential, ever: only hasCredential.
  const serverView = (s: ServerPublic, tools: { name: string; description: string }[]) => ({
    id: s.id, slug: s.slug, url: s.url, authType: s.authType, authHeader: s.authHeader,
    hasCredential: s.hasCredential, enabled: s.enabled,
    status: !s.enabled ? "Disabled" : s.status === "connected" ? "Connected" : s.status === "unreachable" ? "Unreachable" : "Unknown",
    statusReason: s.enabled ? s.statusReason : null,
    statusCheckedAt: s.statusCheckedAt, createdAt: s.createdAt, tools,
  });

  async function listServers() {
    const { tools } = await d.aggregator.listAllTools(); // live: also refreshes each server's status
    const bySlug = new Map<string, { name: string; description: string }[]>();
    for (const t of tools) {
      const p = parseName(t.name);
      if (!p) continue;
      (bySlug.get(p.slug) ?? bySlug.set(p.slug, []).get(p.slug)!).push({ name: p.tool, description: t.description ?? "" });
    }
    return d.registry.list().map((s) => serverView(s, bySlug.get(s.slug) ?? []));
  }

  // ---- anyone logged in ----
  add("GET", "/api/me", false, (c) => [200, { id: c.user.id, email: c.user.email, role: c.user.role }]);
  add("GET", "/api/me/keys", false, (c) => [200, d.auth.listKeys(c.user.id)]);
  add("POST", "/api/me/keys", false, (c) => [201, d.auth.issueKey(c.user.id, reqString(c.body, "label"))]);
  add("DELETE", "/api/keys/:id", false, (c) => {
    const id = intParam(c.params[0]);
    const key = d.auth.listKeys().find((k) => k.id === id);
    if (!key) throw new HttpError(404, "key not found");
    if (c.user.role !== "admin" && key.userId !== c.user.id) throw new HttpError(403, "not your key");
    // Never let the last active admin key go: nobody could manage the system afterwards.
    if (d.auth.isLastActiveAdminKey(id)) throw new HttpError(400, "this is the last active admin key: create another admin key first");
    d.auth.revokeKey(id);
    return [204];
  });

  // The chat agent acts as the logged-in user: its tool calls are audited under c.user.
  // One question at a time per user, so a stuck client cannot burn the model quota.
  const chatsInFlight = new Set<number>();
  add("POST", "/api/chat", false, async (c) => {
    if (!d.chat) throw new HttpError(503, "chat is not configured: set LLM_API_KEY and LLM_MODEL");
    const raw = c.body.messages;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_HISTORY) {
      throw new HttpError(400, `"messages" must be a list of 1 to ${MAX_HISTORY} items`);
    }
    const history: HistoryItem[] = raw.map((m: any) => {
      if ((m?.role !== "user" && m?.role !== "assistant") || typeof m.content !== "string" || m.content.length > MAX_MESSAGE_CHARS) {
        throw new HttpError(400, `each message needs a role (user or assistant) and text up to ${MAX_MESSAGE_CHARS} characters`);
      }
      return { role: m.role, content: m.content };
    });
    if (history[history.length - 1].role !== "user") throw new HttpError(400, "the last message must be from the user");

    if (chatsInFlight.has(c.user.id)) throw new HttpError(429, "you already have a question running, wait for it to finish");
    chatsInFlight.add(c.user.id);
    try {
      return [200, await d.chat.run(c.user, history)];
    } finally {
      chatsInFlight.delete(c.user.id);
    }
  });

  // ---- admin only ----
  add("GET", "/api/servers", true, async () => [200, await listServers()]);
  add("POST", "/api/servers", true, async (c) => {
    const authType = optString(c.body, "authType") as AuthType | undefined;
    if (authType !== undefined && !["none", "bearer", "header"].includes(authType)) throw new HttpError(400, "bad authType");
    const s = await userError(() => d.registry.create({
      slug: reqString(c.body, "slug"), url: reqString(c.body, "url"), authType,
      authHeader: optString(c.body, "authHeader"), credential: optString(c.body, "credential"),
    }));
    return [201, serverView(s, [])];
  });
  add("PATCH", "/api/servers/:id", true, async (c) => {
    const id = intParam(c.params[0]);
    if (!d.registry.get(id)) throw new HttpError(404, "server not found");
    if (typeof c.body.enabled === "boolean") d.registry.setEnabled(id, c.body.enabled);
    const authType = optString(c.body, "authType") as AuthType | undefined;
    if (authType !== undefined && !["none", "bearer", "header"].includes(authType)) throw new HttpError(400, "bad authType");
    const s = await userError(() => d.registry.update(id, {
      url: optString(c.body, "url"), authType, authHeader: optString(c.body, "authHeader"), credential: optString(c.body, "credential"),
    }));
    return [200, serverView(s, [])];
  });
  add("DELETE", "/api/servers/:id", true, (c) => {
    const id = intParam(c.params[0]);
    if (!d.registry.get(id)) throw new HttpError(404, "server not found");
    d.registry.remove(id);
    return [204];
  });

  add("GET", "/api/users", true, () => {
    const keys = d.auth.listKeys();
    return [200, d.auth.listUsers().map((u) => ({ ...u, activeKeys: keys.filter((k) => k.userId === u.id && !k.revokedAt).length }))];
  });
  // "Invite": create the user and hand back their first key ONCE.
  add("POST", "/api/users", true, (c) => {
    const role = optString(c.body, "role") ?? "member";
    if (role !== "admin" && role !== "member") throw new HttpError(400, "role must be admin or member");
    const user = userError(() => d.auth.createUser(reqString(c.body, "email"), reqString(c.body, "name"), role));
    return [201, { user, key: d.auth.issueKey(user.id, "initial") }];
  });
  add("DELETE", "/api/users/:id", true, (c) => {
    const id = intParam(c.params[0]);
    if (id === c.user.id) throw new HttpError(400, "you cannot delete yourself");
    if (!d.auth.getUser(id)) throw new HttpError(404, "user not found");
    d.auth.deleteUser(id);
    return [204];
  });
  add("POST", "/api/users/:id/keys", true, (c) => {
    const id = intParam(c.params[0]);
    if (!d.auth.getUser(id)) throw new HttpError(404, "user not found");
    return [201, d.auth.issueKey(id, optString(c.body, "label") ?? "issued by admin")];
  });
  add("GET", "/api/keys", true, () => {
    const emails = new Map(d.auth.listUsers().map((u) => [u.id, u.email]));
    return [200, d.auth.listKeys().map((k) => ({ ...k, userEmail: emails.get(k.userId) ?? null }))];
  });

  add("GET", "/api/audit", true, (c) => {
    const num = (k: string) => (c.query.has(k) ? Number(c.query.get(k)) : undefined);
    const outcome = c.query.get("outcome");
    if (outcome && outcome !== "success" && outcome !== "error") throw new HttpError(400, "bad outcome");
    return [200, d.audit.list({
      userId: num("user"), server: c.query.get("server") ?? undefined,
      outcome: (outcome as "success" | "error" | null) ?? undefined, limit: num("limit"), offset: num("offset"),
    })];
  });

  function send(res: ServerResponse, status: number, data?: unknown): void {
    if (data === undefined) { res.writeHead(status).end(); return; }
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(data));
  }

  // Called by app.ts AFTER the API key was verified. `user` is who is calling.
  return async function handle(req: IncomingMessage, res: ServerResponse, user: AuthedUser, url: URL): Promise<void> {
    try {
      const method = req.method ?? "GET";
      let pathMatched = false;
      for (const r of routes) {
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        pathMatched = true;
        if (r.method !== method) continue;
        if (r.adminOnly && user.role !== "admin") throw new HttpError(403, "admin only");
        const body = method === "POST" || method === "PATCH" ? await readJson(req) : {};
        const [status, data] = await r.handler({ user, params: m.slice(1), query: url.searchParams, body });
        return send(res, status, data);
      }
      throw new HttpError(pathMatched ? 405 : 404, pathMatched ? "method not allowed" : "not found");
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      if (e instanceof LlmError) return send(res, e.status, { error: e.message }); // already a safe, short reason
      console.error("api error:", (e as Error).message);
      send(res, 500, { error: "internal error" });
    }
  };
}
