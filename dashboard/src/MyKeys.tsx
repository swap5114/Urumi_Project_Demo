import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createMyKey, listMyKeys, revokeKey, type IssuedKey, type KeyRow } from "./api";
import { KeyList, KeyShown } from "./Keys";
import { messageOf } from "./util";

// Any signed-in user: create and revoke your own keys. Nobody else's keys are visible here.
export function MyKeys() {
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<IssuedKey | null>(null);

  const refresh = useCallback(async () => {
    try {
      setKeys(await listMyKeys());
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setIssued(await createMyKey(label.trim()));
      setLabel("");
      await refresh();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: number) {
    setBusy(true);
    setError(null);
    try {
      await revokeKey(id);
      await refresh(); // if this was the key you are signed in with, this call gets a 401 and you are signed out
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>My API keys</h2>
      <p className="muted">
        Use a key to connect an MCP client (Claude Code, Cursor) to the gateway: one URL and your key, nothing else to configure.
        Keys are yours: nobody can see them, and you can revoke them at any time.
      </p>
      {issued && <KeyShown issued={issued} onDone={() => setIssued(null)} />}
      <form className="panel" onSubmit={create}>
        <h3>Create a key</h3>
        <label>Label
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="laptop, cursor, ci..." required maxLength={60} />
        </label>
        <div><button type="submit" disabled={busy || label.trim() === ""}>Create key</button></div>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {keys === null && !error && <p className="muted">Loading...</p>}
      {keys && <KeyList keys={keys} busy={busy} onRevoke={(id) => void revoke(id)} />}
    </section>
  );
}
