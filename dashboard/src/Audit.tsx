import { useCallback, useEffect, useRef, useState } from "react";
import { listAudit, listUsers, type AuditRow, type UserRow } from "./api";
import { fmtDate, fmtDuration, messageOf } from "./util";

const PAGE_SIZE = 50;
const REFRESH_MS = 10_000;

export function Audit() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [userId, setUserId] = useState("");
  const [server, setServer] = useState("");
  const [outcome, setOutcome] = useState<"" | "success" | "error">("");
  const [offset, setOffset] = useState(0);
  const [auto, setAuto] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return; // never stack requests
    inFlight.current = true;
    try {
      setRows(await listAudit({
        user: userId ? Number(userId) : undefined,
        server: server.trim() || undefined,
        outcome: outcome || undefined,
        limit: PAGE_SIZE,
        offset,
      }));
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      inFlight.current = false;
    }
  }, [userId, server, outcome, offset]);

  useEffect(() => { void listUsers().then(setUsers).catch(() => undefined); }, []);

  // Reload when a filter or the page changes. Auto-refresh only on the newest page, and not while the tab is hidden.
  useEffect(() => {
    void load();
    if (!auto || offset !== 0) return;
    const timer = setInterval(() => { if (!document.hidden) void load(); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, auto, offset]);

  const changeFilter = (apply: () => void) => { apply(); setOffset(0); };

  return (
    <section>
      <div className="row">
        <h2>Audit log</h2>
        <span className="spacer" />
        <label className="check inline"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-refresh</label>
        <button className="secondary" onClick={() => void load()}>Refresh</button>
      </div>
      <p className="muted">Every tool call, from the chat agent and from external MCP clients: who, which server and tool, when, how long, and the outcome.</p>

      <div className="filters">
        <label>User
          <select value={userId} onChange={(e) => changeFilter(() => setUserId(e.target.value))}>
            <option value="">Everyone</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
          </select>
        </label>
        <label>Server
          <input value={server} onChange={(e) => changeFilter(() => setServer(e.target.value))} placeholder="slug, for example woo" />
        </label>
        <label>Outcome
          <select value={outcome} onChange={(e) => changeFilter(() => setOutcome(e.target.value as "" | "success" | "error"))}>
            <option value="">All</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
          </select>
        </label>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {rows === null && !error && <p className="muted">Loading...</p>}
      {rows?.length === 0 && <p className="muted">No calls match.</p>}
      {rows && rows.length > 0 && (
        <div className="scroll">
          <table className="table">
            <thead>
              <tr><th>When</th><th>User</th><th>Server</th><th>Tool</th><th>Duration</th><th>Outcome</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{fmtDate(r.ts)}</td>
                  <td>{r.userEmail ?? <span className="muted">unknown</span>}</td>
                  <td>{r.serverSlug ?? <span className="muted">none</span>}</td>
                  <td><code>{r.tool}</code></td>
                  <td className="nowrap">{fmtDuration(r.durationMs)}</td>
                  <td>
                    <span className={`status ${r.outcome === "success" ? "connected" : "unreachable"}`}>{r.outcome}</span>
                    {/* The error text can come from an upstream server: React renders it as plain text. */}
                    {r.error && <div className="small muted clip errtext" title={r.error}>{r.error}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="row pager">
        <button className="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Newer</button>
        <span className="muted small">{rows && rows.length > 0 ? `Showing ${offset + 1} to ${offset + rows.length}` : ""}</span>
        <button className="secondary" disabled={!rows || rows.length < PAGE_SIZE} onClick={() => setOffset(offset + PAGE_SIZE)}>Older</button>
      </div>
    </section>
  );
}
