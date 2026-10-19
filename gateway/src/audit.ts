import type Database from "better-sqlite3";
import type { CallRecord } from "./gatewayServer.js";

export interface AuditRow {
  id: number;
  ts: string;
  userId: number | null;
  userEmail: string | null;
  serverSlug: string | null;
  tool: string;
  durationMs: number;
  outcome: "success" | "error";
  error: string | null;
}

export interface AuditFilter {
  userId?: number;
  server?: string;
  outcome?: "success" | "error";
  limit?: number;
  offset?: number;
}

export function createAudit(db: Database.Database) {
  const insert = db.prepare(
    "INSERT INTO audit_log(user_id,user_email,server_slug,tool,duration_ms,outcome,error) VALUES (?,?,?,?,?,?,?)",
  );

  return {
    // Must never break the user's tool call: if the write fails we log to stderr and carry on.
    record(rec: CallRecord): void {
      try {
        insert.run(rec.user.id, rec.user.email, rec.serverSlug, rec.tool, rec.durationMs, rec.outcome, rec.error ?? null);
      } catch (err) {
        console.error("audit write failed:", (err as Error).message);
      }
    },

    // Newest first. Filters are optional; values go in as bound parameters, never string-concatenated.
    list(f: AuditFilter = {}): AuditRow[] {
      const where: string[] = [];
      const params: unknown[] = [];
      if (f.userId !== undefined) { where.push("user_id = ?"); params.push(f.userId); }
      if (f.server) { where.push("server_slug = ?"); params.push(f.server); }
      if (f.outcome) { where.push("outcome = ?"); params.push(f.outcome); }
      const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
      const offset = Math.max(f.offset ?? 0, 0);
      const sql = `SELECT * FROM audit_log ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?`;
      return (db.prepare(sql).all(...params, limit, offset) as any[]).map((r) => ({
        id: r.id, ts: r.ts, userId: r.user_id, userEmail: r.user_email, serverSlug: r.server_slug,
        tool: r.tool, durationMs: r.duration_ms, outcome: r.outcome, error: r.error,
      }));
    },
  };
}
