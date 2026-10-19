import { useCallback, useEffect, useState, type FormEvent } from "react";
import { deleteUser, inviteUser, issueKeyFor, listAllKeys, listUsers, revokeKey, type IssuedKey, type KeyRow, type UserRow } from "./api";
import { KeyList, KeyShown } from "./Keys";
import { useSession } from "./session";
import { fmtDate, messageOf } from "./util";

export function Team() {
  const { user: me } = useSession();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ forWho: string; key: IssuedKey } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [u, k] = await Promise.all([listUsers(), listAllKeys()]);
      setUsers(u);
      setKeys(k);
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <section>
      <div className="row">
        <h2>Team</h2>
        <span className="spacer" />
        <button className="secondary" onClick={() => void refresh()}>Refresh</button>
      </div>
      <p className="muted">
        Invite a member: they get their own API key, shown once. Admins manage servers and members; members use the tools.
      </p>
      {issued && <KeyShown issued={issued.key} forLabel={issued.forWho} onDone={() => setIssued(null)} />}
      <InviteForm onInvited={(forWho, key) => { setIssued({ forWho, key }); void refresh(); }} />
      {error && <p className="error" role="alert">{error}</p>}
      {users === null && !error && <p className="muted">Loading...</p>}
      <div className="list">
        {users?.map((u) => (
          <UserCard
            key={u.id}
            user={u}
            isMe={u.id === me?.id}
            keys={keys.filter((k) => k.userId === u.id)}
            onChanged={refresh}
            onIssued={(key) => setIssued({ forWho: u.email, key })}
          />
        ))}
      </div>
    </section>
  );
}

function InviteForm({ onInvited }: { onInvited: (forWho: string, key: IssuedKey) => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await inviteUser(email.trim(), name.trim(), role);
      onInvited(res.user.email, res.key);
      setEmail(""); setName(""); setRole("member"); setOpen(false);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return <button onClick={() => setOpen(true)}>Invite member</button>;
  return (
    <form className="panel" onSubmit={submit}>
      <h3>Invite a team member</h3>
      <label>Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>Name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>Role
        <select value={role} onChange={(e) => setRole(e.target.value as "member" | "admin")}>
          <option value="member">Member: uses the tools</option>
          <option value="admin">Admin: manages servers and members</option>
        </select>
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button type="submit" disabled={busy}>{busy ? "Inviting..." : "Invite and create key"}</button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

function UserCard(props: { user: UserRow; isMe: boolean; keys: KeyRow[]; onChanged: () => Promise<void>; onIssued: (key: IssuedKey) => void }) {
  const { user, isMe, keys, onChanged, onIssued } = props;
  const [showKeys, setShowKeys] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  function issue(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      onIssued(await issueKeyFor(user.id, label.trim() || "issued by admin"));
      setLabel("");
    });
  }

  return (
    <article className="card-row">
      <div className="row">
        <strong>{user.email}</strong>
        <span className={`badge ${user.role}`}>{user.role}</span>
        {isMe && <span className="tag">you</span>}
        <span className="muted small">{user.name} · {user.activeKeys} active {user.activeKeys === 1 ? "key" : "keys"} · joined {fmtDate(user.createdAt)}</span>
        <span className="spacer" />
        <button className="secondary" onClick={() => setShowKeys((v) => !v)}>{showKeys ? "Hide keys" : "Keys"}</button>
        {!isMe && (confirmRemove ? (
          <>
            <button className="danger" disabled={busy} onClick={() => void run(() => deleteUser(user.id))}>Confirm remove</button>
            <button className="secondary" disabled={busy} onClick={() => setConfirmRemove(false)}>Keep</button>
          </>
        ) : (
          <button className="secondary" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove</button>
        ))}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {showKeys && (
        <div className="subpanel">
          <KeyList keys={keys} busy={busy} onRevoke={(id) => void run(() => revokeKey(id))} />
          <form className="row" onSubmit={issue}>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label for a new key (optional)" maxLength={60} />
            <button type="submit" disabled={busy}>Issue key</button>
          </form>
        </div>
      )}
    </article>
  );
}
