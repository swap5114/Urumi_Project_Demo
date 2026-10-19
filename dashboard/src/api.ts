// The only place that talks to the gateway. Every page uses request() so the key handling lives in one spot.

export interface Me {
  id: number;
  email: string;
  role: "admin" | "member";
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let apiKey: string | null = null;
let onUnauthorized: (() => void) | undefined;

export const setApiKey = (key: string | null): void => {
  apiKey = key;
};
// Called when the gateway answers 401 to a logged-in session (key revoked, for example).
export const setUnauthorizedHandler = (fn: () => void): void => {
  onUnauthorized = fn;
};

export async function request<T>(method: string, path: string, body?: unknown, keyOverride?: string): Promise<T> {
  const key = keyOverride ?? apiKey;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { "content-type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Cannot reach the gateway. Is it running?");
  }
  if (res.status === 401 && !keyOverride) onUnauthorized?.();
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `HTTP ${res.status}`);
  return data as T;
}

export const getMe = (keyOverride?: string): Promise<Me> => request<Me>("GET", "/api/me", undefined, keyOverride);

// ---- Servers (admin) ----

export type AuthType = "none" | "bearer" | "header";

export interface ToolInfo {
  name: string;
  description: string;
}

// What the gateway returns for a server. There is NO credential field: only hasCredential.
export interface ServerView {
  id: number;
  slug: string;
  url: string;
  authType: AuthType;
  authHeader: string | null;
  hasCredential: boolean;
  enabled: boolean;
  status: "Connected" | "Unreachable" | "Disabled" | "Unknown";
  statusReason: string | null;
  statusCheckedAt: string | null;
  createdAt: string;
  tools: ToolInfo[];
}

export interface ServerInput {
  slug: string;
  url: string;
  authType?: AuthType;
  authHeader?: string;
  credential?: string;
}

// For an edit: a missing credential keeps the stored one, "" removes it, a value replaces it.
export interface ServerPatch {
  url?: string;
  authType?: AuthType;
  authHeader?: string;
  credential?: string;
  enabled?: boolean;
}

export const listServers = (): Promise<ServerView[]> => request<ServerView[]>("GET", "/api/servers");
export const createServer = (input: ServerInput): Promise<ServerView> => request<ServerView>("POST", "/api/servers", input);
export const updateServer = (id: number, patch: ServerPatch): Promise<ServerView> => request<ServerView>("PATCH", `/api/servers/${id}`, patch);
export const deleteServer = (id: number): Promise<void> => request<void>("DELETE", `/api/servers/${id}`);

// ---- Team and keys ----

export interface UserRow {
  id: number;
  email: string;
  name: string;
  role: "admin" | "member";
  createdAt: string;
  activeKeys: number;
}

// A key as listed: only a short prefix to recognise it. The full key is shown once, when it is created.
export interface KeyRow {
  id: number;
  userId: number;
  label: string;
  prefix: string;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  userEmail?: string | null; // only in the admin list
}

export interface IssuedKey {
  id: number;
  key: string; // the plaintext key: this is the ONLY time the gateway returns it
  prefix: string;
}

// First characters of the key this session is signed in with, to mark it in key lists.
export const currentKeyPrefix = (): string | null => (apiKey ? apiKey.slice(0, 10) : null);

export const listUsers = (): Promise<UserRow[]> => request<UserRow[]>("GET", "/api/users");
export const inviteUser = (email: string, name: string, role: "admin" | "member"): Promise<{ user: UserRow; key: IssuedKey }> =>
  request("POST", "/api/users", { email, name, role });
export const deleteUser = (id: number): Promise<void> => request<void>("DELETE", `/api/users/${id}`);
export const listAllKeys = (): Promise<KeyRow[]> => request<KeyRow[]>("GET", "/api/keys");
export const issueKeyFor = (userId: number, label: string): Promise<IssuedKey> => request<IssuedKey>("POST", `/api/users/${userId}/keys`, { label });
export const listMyKeys = (): Promise<KeyRow[]> => request<KeyRow[]>("GET", "/api/me/keys");
export const createMyKey = (label: string): Promise<IssuedKey> => request<IssuedKey>("POST", "/api/me/keys", { label });
export const revokeKey = (id: number): Promise<void> => request<void>("DELETE", `/api/keys/${id}`);

// ---- Audit log (admin) ----

export interface AuditRow {
  id: number;
  ts: string;
  userId: number | null;
  userEmail: string | null; // a copy kept at call time, so it survives the user being removed
  serverSlug: string | null; // null when the tool name did not match any enabled server
  tool: string;
  durationMs: number;
  outcome: "success" | "error";
  error: string | null;
}

export interface AuditQuery {
  user?: number;
  server?: string;
  outcome?: "success" | "error";
  limit?: number;
  offset?: number;
}

export function listAudit(q: AuditQuery = {}): Promise<AuditRow[]> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") params.set(k, String(v));
  const qs = params.toString();
  return request<AuditRow[]>("GET", `/api/audit${qs ? `?${qs}` : ""}`);
}

// ---- Chat ----

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

// One tool the agent ran to answer. args and preview come from the model and an upstream server: show as text only.
export interface ToolTrace {
  tool: string;
  args: unknown;
  ok: boolean;
  durationMs: number;
  preview: string;
}

export interface ChatResponse {
  answer: string;
  toolCalls: ToolTrace[];
  steps: number;
  stoppedEarly: boolean;
}

// The backend limits one request to 20 messages of 4000 characters each.
export const CHAT_MAX_MESSAGES = 20;
export const CHAT_MAX_CHARS = 4000;

export const sendChat = (messages: ChatTurn[]): Promise<ChatResponse> => request<ChatResponse>("POST", "/api/chat", { messages });
