import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  createServer, deleteServer, listServers, updateServer,
  type AuthType, type ServerPatch, type ServerView,
} from "./api";
import { messageOf } from "./util";

const AUTH_LABELS: Record<AuthType, string> = {
  none: "No authentication",
  bearer: "Bearer token",
  header: "Custom header",
};
const REFRESH_MS = 10_000;


export function Servers() {
  const [servers, setServers] = useState<ServerView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  // GET /api/servers asks every upstream live, so never run two at once.
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      setServers(await listServers());
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh(); // no polling while the tab is in the background
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <section>
      <div className="row">
        <h2>MCP servers</h2>
        <span className="spacer" />
        <button className="secondary" onClick={() => void refresh()}>Refresh</button>
      </div>
      <p className="muted">
        Every enabled server's tools are available to all members through one gateway endpoint. Credentials are stored
        encrypted on the server and are never shown again.
      </p>
      {error && <p className="error" role="alert">{error}</p>}

      <AddServer onAdded={refresh} />

      {servers === null && !error && <p className="muted">Loading...</p>}
      {servers?.length === 0 && <p className="muted">No servers yet.</p>}
      <div className="list">
        {servers?.map((s) => <ServerCard key={s.id} server={s} onChanged={refresh} />)}
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: ServerView["status"] }) {
  return <span className={`status ${status.toLowerCase()}`}>{status}</span>;
}

function ServerCard({ server, onChanged }: { server: ServerView; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setConfirmRemove(false);
      await onChanged();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card-row">
      <div className="row">
        <strong>{server.slug}</strong>
        <StatusBadge status={server.status} />
        {server.hasCredential && <span className="tag">credential set</span>}
        <span className="spacer" />
        <button className="secondary" disabled={busy} onClick={() => void run(() => updateServer(server.id, { enabled: !server.enabled }))}>
          {server.enabled ? "Disable" : "Enable"}
        </button>
        <button className="secondary" disabled={busy} onClick={() => setEditing((v) => !v)}>
          {editing ? "Cancel" : "Edit"}
        </button>
        {confirmRemove ? (
          <>
            <button className="danger" disabled={busy} onClick={() => void run(() => deleteServer(server.id))}>Confirm remove</button>
            <button className="secondary" disabled={busy} onClick={() => setConfirmRemove(false)}>Keep</button>
          </>
        ) : (
          <button className="secondary" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove</button>
        )}
      </div>

      <p className="muted small">{server.url} · {AUTH_LABELS[server.authType]}{server.authType === "header" && server.authHeader ? ` (${server.authHeader})` : ""}</p>
      {server.status === "Unreachable" && server.statusReason && <p className="error small">Unreachable: {server.statusReason}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {editing && (
        <EditServer
          server={server}
          busy={busy}
          onSave={(patch) => void run(async () => { await updateServer(server.id, patch); setEditing(false); })}
        />
      )}

      {/* Tool names and descriptions come from the upstream server. React renders them as plain text. */}
      <details>
        <summary>{server.tools.length} {server.tools.length === 1 ? "tool" : "tools"}</summary>
        <ul className="tools">
          {server.tools.map((t) => (
            <li key={t.name}>
              <code>{server.slug}__{t.name}</code>
              <span className="muted clip"> {t.description}</span>
            </li>
          ))}
          {server.tools.length === 0 && <li className="muted">{server.enabled ? "No tools available right now." : "Disabled: its tools are hidden from everyone."}</li>}
        </ul>
      </details>
    </article>
  );
}

function CredentialFields(props: {
  authType: AuthType; setAuthType: (v: AuthType) => void;
  authHeader: string; setAuthHeader: (v: string) => void;
  credential: string; setCredential: (v: string) => void;
  credentialHint?: string;
}) {
  return (
    <>
      <label>Authentication
        <select value={props.authType} onChange={(e) => props.setAuthType(e.target.value as AuthType)}>
          {(Object.keys(AUTH_LABELS) as AuthType[]).map((k) => <option key={k} value={k}>{AUTH_LABELS[k]}</option>)}
        </select>
      </label>
      {props.authType === "header" && (
        <label>Header name
          <input value={props.authHeader} onChange={(e) => props.setAuthHeader(e.target.value)} placeholder="X-API-Key" required />
        </label>
      )}
      {props.authType !== "none" && (
        <label>Credential
          <input type="password" autoComplete="off" value={props.credential} onChange={(e) => props.setCredential(e.target.value)} placeholder={props.credentialHint} />
        </label>
      )}
    </>
  );
}

function AddServer({ onAdded }: { onAdded: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [url, setUrl] = useState("");
  const [authType, setAuthType] = useState<AuthType>("none");
  const [authHeader, setAuthHeader] = useState("");
  const [credential, setCredential] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createServer({
        slug: slug.trim(), url: url.trim(), authType,
        ...(authType === "header" ? { authHeader: authHeader.trim() } : {}),
        ...(authType !== "none" && credential ? { credential } : {}),
      });
      setSlug(""); setUrl(""); setAuthType("none"); setAuthHeader(""); setCredential(""); setOpen(false);
      await onAdded();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return <button onClick={() => setOpen(true)}>Add server</button>;
  return (
    <form className="panel" onSubmit={submit}>
      <h3>Add an MCP server</h3>
      <label>Name (slug)
        <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="shop" pattern="[a-z0-9][a-z0-9\-]*" title="lowercase letters, digits and dashes" required />
        <span className="muted small">Tools will be named slug__tool, for example shop__list_orders.</span>
      </label>
      <label>URL
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" required />
        <span className="muted small">Must speak MCP over Streamable HTTP.</span>
      </label>
      <CredentialFields {...{ authType, setAuthType, authHeader, setAuthHeader, credential, setCredential }} />
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button type="submit" disabled={busy}>{busy ? "Adding..." : "Add server"}</button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

function EditServer({ server, busy, onSave }: { server: ServerView; busy: boolean; onSave: (patch: ServerPatch) => void }) {
  const [url, setUrl] = useState(server.url);
  const [authType, setAuthType] = useState<AuthType>(server.authType);
  const [authHeader, setAuthHeader] = useState(server.authHeader ?? "");
  const [credential, setCredential] = useState("");
  const [clear, setClear] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    const patch: ServerPatch = { url: url.trim(), authType };
    if (authType === "header") patch.authHeader = authHeader.trim();
    // Empty = keep the stored credential, "" = remove it, a value = replace it.
    if (authType === "none" || clear) patch.credential = "";
    else if (credential) patch.credential = credential;
    onSave(patch);
  }

  return (
    <form className="panel" onSubmit={submit}>
      <label>URL
        <input value={url} onChange={(e) => setUrl(e.target.value)} required />
      </label>
      <CredentialFields
        {...{ authType, setAuthType, authHeader, setAuthHeader, credential, setCredential }}
        credentialHint={server.hasCredential ? "Leave empty to keep the current credential" : undefined}
      />
      {server.hasCredential && authType !== "none" && (
        <label className="check">
          <input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} /> Remove the stored credential
        </label>
      )}
      <button type="submit" disabled={busy}>{busy ? "Saving..." : "Save"}</button>
    </form>
  );
}
