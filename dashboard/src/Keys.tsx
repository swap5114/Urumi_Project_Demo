import { useState } from "react";
import { currentKeyPrefix, type IssuedKey, type KeyRow } from "./api";
import { fmtDate } from "./util";

// Shown right after a key is created. The gateway keeps only a hash, so this is the one and only time the key exists.
export function KeyShown({ issued, forLabel, onDone }: { issued: IssuedKey; forLabel?: string; onDone: () => void }) {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const origin = window.location.origin;
  const snippet = `claude mcp add --transport http gateway ${origin}/mcp --header "Authorization: Bearer ${issued.key}"`;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("yes");
    } catch {
      setCopied("failed"); // clipboard needs a secure context: select the text and copy it by hand
    }
  }

  return (
    <div className="keybox" role="status">
      <strong>{forLabel ? `New key for ${forLabel}` : "Your new key"}</strong>
      <p className="warn small">Copy it now. It is shown only once and cannot be recovered: the gateway stores only a hash.</p>
      <code className="secret">{issued.key}</code>
      <div className="row">
        <button onClick={() => void copy(issued.key)}>Copy key</button>
        <button className="secondary" onClick={() => void copy(snippet)}>Copy Claude Code command</button>
        <button className="secondary" onClick={onDone}>I have saved it</button>
        {copied === "yes" && <span className="muted small">Copied.</span>}
        {copied === "failed" && <span className="error small">Could not copy: select the key and copy it by hand.</span>}
      </div>
      <p className="muted small">
        Use it in an MCP client: URL <code>{origin}/mcp</code> and the header <code>Authorization: Bearer &lt;key&gt;</code>.
        The command above is an example for Claude Code.
      </p>
    </div>
  );
}

export function KeyList({ keys, busy, onRevoke }: { keys: KeyRow[]; busy: boolean; onRevoke: (id: number) => void }) {
  if (keys.length === 0) return <p className="muted small">No keys.</p>;
  return (
    <table className="table">
      <thead>
        <tr><th>Label</th><th>Key</th><th>Created</th><th>Last used</th><th /></tr>
      </thead>
      <tbody>
        {keys.map((k) => <KeyRowView key={k.id} k={k} busy={busy} onRevoke={onRevoke} />)}
      </tbody>
    </table>
  );
}

function KeyRowView({ k, busy, onRevoke }: { k: KeyRow; busy: boolean; onRevoke: (id: number) => void }) {
  const [confirm, setConfirm] = useState(false);
  const thisSession = !k.revokedAt && k.prefix === currentKeyPrefix();
  return (
    <tr className={k.revokedAt ? "revoked" : undefined}>
      <td>{k.label}{thisSession && <span className="tag">this session</span>}</td>
      <td><code>{k.prefix}…</code></td>
      <td>{fmtDate(k.createdAt)}</td>
      <td>{fmtDate(k.lastUsedAt)}</td>
      <td className="actions">
        {k.revokedAt ? (
          <span className="muted small">Revoked {fmtDate(k.revokedAt)}</span>
        ) : confirm ? (
          <>
            <button className="danger" disabled={busy} onClick={() => onRevoke(k.id)}>
              {thisSession ? "Revoke and sign out" : "Confirm revoke"}
            </button>
            <button className="secondary" disabled={busy} onClick={() => setConfirm(false)}>Keep</button>
          </>
        ) : (
          <button className="secondary" disabled={busy} onClick={() => setConfirm(true)}>Revoke</button>
        )}
      </td>
    </tr>
  );
}
