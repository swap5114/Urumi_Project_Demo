import { useState, type FormEvent } from "react";
import { ApiError } from "./api";
import { useSession } from "./session";

export function Login() {
  const { login } = useSession();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(key);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "That API key is not valid, or it was revoked." : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="center">
      <form className="card" onSubmit={submit}>
        <h1>MCP Gateway</h1>
        <p className="muted">Sign in with your API key. Ask an admin for one, or use the key from the invite.</p>
        <label htmlFor="key">API key</label>
        <input id="key" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} required />
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={busy || key.trim() === ""}>{busy ? "Checking..." : "Sign in"}</button>
      </form>
    </main>
  );
}
