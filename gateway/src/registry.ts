import type Database from "better-sqlite3";
import { decrypt, encrypt } from "./crypto.js";
import { assertSafeUpstreamUrl } from "./ssrf.js";

export type AuthType = "none" | "bearer" | "header";

// What the dashboard / API may see. NO credential field, only a boolean.
export interface ServerPublic {
  id: number; slug: string; url: string; authType: AuthType; authHeader: string | null;
  hasCredential: boolean; enabled: boolean;
  status: string; statusReason: string | null; statusCheckedAt: string | null; createdAt: string;
}

// What only the gateway's own upstream code may see.
export interface ServerForCall extends ServerPublic { credential: string | null }

export interface ServerInput {
  slug: string; url: string; authType?: AuthType; authHeader?: string; credential?: string;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function toPublic(r: any): ServerPublic {
  return {
    id: r.id, slug: r.slug, url: r.url, authType: r.auth_type, authHeader: r.auth_header,
    hasCredential: r.credential_enc !== null, enabled: r.enabled === 1,
    status: r.status, statusReason: r.status_reason, statusCheckedAt: r.status_checked_at, createdAt: r.created_at,
  };
}

// checkUrl is injectable so tests can use localhost; production always uses the real SSRF check.
export function createRegistry(db: Database.Database, checkUrl: (url: string) => Promise<unknown> = assertSafeUpstreamUrl) {
  const byId = (id: number) => db.prepare("SELECT * FROM servers WHERE id = ?").get(id) as any;

  return {
    list: (): ServerPublic[] => (db.prepare("SELECT * FROM servers ORDER BY id").all() as any[]).map(toPublic),
    get: (id: number): ServerPublic | undefined => { const r = byId(id); return r && toPublic(r); },

    // Internal only: includes the decrypted credential.
    getForCall(id: number): ServerForCall | undefined {
      const r = byId(id);
      return r && { ...toPublic(r), credential: r.credential_enc ? decrypt(r.credential_enc) : null };
    },

    async create(input: ServerInput): Promise<ServerPublic> {
      if (!SLUG_RE.test(input.slug)) throw new Error("slug must be lowercase letters, digits and '-'");
      await checkUrl(input.url);
      const authType = input.authType ?? (input.credential ? "bearer" : "none");
      if (authType === "header" && !input.authHeader) throw new Error("authHeader required for header auth");
      const info = db.prepare(
        "INSERT INTO servers(slug,url,auth_type,auth_header,credential_enc) VALUES (?,?,?,?,?)",
      ).run(input.slug, input.url, authType, input.authHeader ?? null, input.credential ? encrypt(input.credential) : null);
      return toPublic(byId(Number(info.lastInsertRowid)));
    },

    async update(id: number, patch: Partial<ServerInput>): Promise<ServerPublic> {
      const cur = byId(id);
      if (!cur) throw new Error("server not found");
      if (patch.url) await checkUrl(patch.url);
      // credential: undefined = keep existing, "" = clear it, string = replace it
      const credEnc = patch.credential === undefined ? cur.credential_enc : patch.credential === "" ? null : encrypt(patch.credential);
      db.prepare("UPDATE servers SET url=?, auth_type=?, auth_header=?, credential_enc=? WHERE id=?").run(
        patch.url ?? cur.url, patch.authType ?? cur.auth_type, patch.authHeader ?? cur.auth_header, credEnc, id,
      );
      return toPublic(byId(id));
    },

    setEnabled: (id: number, enabled: boolean) =>
      void db.prepare("UPDATE servers SET enabled=? WHERE id=?").run(enabled ? 1 : 0, id),

    setStatus: (id: number, status: "connected" | "unreachable", reason: string | null) =>
      void db.prepare("UPDATE servers SET status=?, status_reason=?, status_checked_at=datetime('now') WHERE id=?").run(status, reason, id),

    remove: (id: number) => void db.prepare("DELETE FROM servers WHERE id=?").run(id),
  };
}
