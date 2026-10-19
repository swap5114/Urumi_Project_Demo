import { createHash, randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import type { Principal } from "./gatewayServer.js";

const KEY_PREFIX = "mcpgw_";

// SHA-256 is enough here: keys are 256 bits of randomness, so there is nothing to brute-force.
// (Passwords are different: they are guessable, so they need a slow hash like bcrypt/argon2.)
export const hashKey = (key: string): string => createHash("sha256").update(key).digest("hex");

export const generateKey = (): string => KEY_PREFIX + randomBytes(32).toString("base64url");

export type AuthedUser = Principal & { keyId: number };

export interface UserRow { id: number; email: string; name: string; role: "admin" | "member"; createdAt: string }
export interface KeyRow { id: number; userId: number; label: string; prefix: string; createdAt: string; revokedAt: string | null; lastUsedAt: string | null }

export function createAuth(db: Database.Database) {
  return {
    createUser(email: string, name: string, role: "admin" | "member"): UserRow {
      const info = db.prepare("INSERT INTO users(email,name,role) VALUES (?,?,?)").run(email.trim().toLowerCase(), name.trim(), role);
      return this.getUser(Number(info.lastInsertRowid))!;
    },

    getUser(id: number): UserRow | undefined {
      const r = db.prepare("SELECT * FROM users WHERE id=?").get(id) as any;
      return r && { id: r.id, email: r.email, name: r.name, role: r.role, createdAt: r.created_at };
    },

    listUsers: (): UserRow[] =>
      (db.prepare("SELECT * FROM users ORDER BY id").all() as any[]).map((r) => ({
        id: r.id, email: r.email, name: r.name, role: r.role, createdAt: r.created_at,
      })),

    deleteUser: (id: number) => void db.prepare("DELETE FROM users WHERE id=?").run(id), // keys go too (ON DELETE CASCADE)

    // The plaintext key is returned ONCE here and never stored. Only its hash goes in the DB.
    issueKey(userId: number, label: string, key = generateKey()): { id: number; key: string; prefix: string } {
      const prefix = key.slice(0, 10);
      const info = db.prepare("INSERT INTO api_keys(user_id,label,key_prefix,key_hash) VALUES (?,?,?,?)").run(userId, label, prefix, hashKey(key));
      return { id: Number(info.lastInsertRowid), key, prefix };
    },

    listKeys(userId?: number): KeyRow[] {
      const rows = (userId === undefined
        ? db.prepare("SELECT * FROM api_keys ORDER BY id").all()
        : db.prepare("SELECT * FROM api_keys WHERE user_id=? ORDER BY id").all(userId)) as any[];
      return rows.map((r) => ({
        id: r.id, userId: r.user_id, label: r.label, prefix: r.key_prefix,
        createdAt: r.created_at, revokedAt: r.revoked_at, lastUsedAt: r.last_used_at,
      }));
    },

    revokeKey: (id: number) => void db.prepare("UPDATE api_keys SET revoked_at=datetime('now') WHERE id=? AND revoked_at IS NULL").run(id),

    // Hash what the client sent, look the hash up. Revoked keys never match.
    authenticate(key: string): AuthedUser | undefined {
      const r = db.prepare(
        `SELECT k.id AS keyId, u.id, u.email, u.role FROM api_keys k JOIN users u ON u.id = k.user_id
         WHERE k.key_hash = ? AND k.revoked_at IS NULL`,
      ).get(hashKey(key)) as any;
      if (!r) return undefined;
      db.prepare("UPDATE api_keys SET last_used_at=datetime('now') WHERE id=?").run(r.keyId);
      return { id: r.id, email: r.email, role: r.role, keyId: r.keyId };
    },

    countActiveAdminKeys: (): number =>
      (db.prepare(
        `SELECT COUNT(*) AS n FROM api_keys k JOIN users u ON u.id = k.user_id
         WHERE u.role = 'admin' AND k.revoked_at IS NULL`,
      ).get() as { n: number }).n,

    // True when revoking this key would leave the system with no active admin key (a lock-out).
    isLastActiveAdminKey(keyId: number): boolean {
      const r = db.prepare(
        `SELECT u.role AS role, k.revoked_at AS revokedAt FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.id = ?`,
      ).get(keyId) as { role: string; revokedAt: string | null } | undefined;
      if (!r || r.role !== "admin" || r.revokedAt) return false; // not an active admin key: revoking it cannot lock anyone out
      return this.countActiveAdminKeys() <= 1;
    },
  };
}

// Runs at every start. The admin key comes from the environment (a Kubernetes Secret), never from the source.
//  1. No users yet (a brand-new database): create the first admin. Returns true.
//  2. Users exist but NO active admin key (an admin locked everyone out): restore the admin key from the Secret.
//     Whoever can edit that Secret already controls the cluster, so this adds no new power. Returns false.
//  3. Otherwise: nothing to do. Returns false.
// "true" therefore means "brand-new database" and gates the one-time seeding of upstream servers.
export function ensureBootstrapAdmin(auth: ReturnType<typeof createAuth>, db: Database.Database, email?: string, key?: string): boolean {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  if (n > 0) {
    if (auth.countActiveAdminKeys() === 0) restoreAdminKey(auth, db, email, key);
    return false;
  }
  if (!email || !key) throw new Error("No users yet: set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_KEY");
  if (key.length < 32) throw new Error("BOOTSTRAP_ADMIN_KEY must be at least 32 characters");
  const admin = auth.createUser(email, "Admin", "admin");
  auth.issueKey(admin.id, "bootstrap", key);
  console.log(`bootstrap admin created: ${admin.email}`);
  return true;
}

// Case 2 above. Never throws: a gateway that cannot restore access must still start, and say why.
function restoreAdminKey(auth: ReturnType<typeof createAuth>, db: Database.Database, email?: string, key?: string): void {
  if (!key || key.length < 32) {
    console.warn("WARNING: no active admin key exists and BOOTSTRAP_ADMIN_KEY is missing or shorter than 32 characters: admins are locked out");
    return;
  }
  try {
    // The bootstrap key's own row, if it still belongs to an admin: switch it back on.
    const existing = db.prepare(
      `SELECT k.id FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.key_hash = ? AND u.role = 'admin'`,
    ).get(hashKey(key)) as { id: number } | undefined;
    if (existing) {
      db.prepare("UPDATE api_keys SET revoked_at = NULL WHERE id = ?").run(existing.id);
      console.warn("WARNING: no active admin key existed: the bootstrap admin key was re-activated from the environment");
      return;
    }
    // Otherwise issue it to an existing admin, or to a new admin if there is none left.
    const admin = (db.prepare("SELECT id, email FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get() as { id: number; email: string } | undefined)
      ?? (email ? { id: auth.createUser(email, "Admin", "admin").id, email } : undefined);
    if (!admin) {
      console.warn("WARNING: no admin exists and BOOTSTRAP_ADMIN_EMAIL is not set: admins are locked out");
      return;
    }
    auth.issueKey(admin.id, "bootstrap (restored)", key);
    console.warn(`WARNING: no active admin key existed: the bootstrap admin key was restored for ${admin.email}`);
  } catch (err) {
    console.warn(`WARNING: could not restore the admin key: ${(err as Error).message}`);
  }
}
