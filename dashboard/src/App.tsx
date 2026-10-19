import { useState } from "react";
import { Audit } from "./Audit";
import { Chat } from "./Chat";
import { Login } from "./Login";
import { MyKeys } from "./MyKeys";
import { Servers } from "./Servers";
import { Team } from "./Team";
import { useSession } from "./session";

type TabId = "overview" | "chat" | "servers" | "team" | "audit" | "keys";

export function App() {
  const { user, ready, logout } = useSession();
  const [tab, setTab] = useState<TabId>("chat");

  if (!ready) return <main className="center"><p className="muted">Loading...</p></main>;
  if (!user) return <Login />;

  const isAdmin = user.role === "admin";
  // The API enforces roles too: hiding a tab is only for convenience, never for security.
  const tabs: { id: TabId; label: string }[] = [
    { id: "chat", label: "Chat" },
    { id: "overview", label: "Overview" },
    ...(isAdmin ? [{ id: "servers" as const, label: "Servers" }, { id: "team" as const, label: "Team" }, { id: "audit" as const, label: "Audit log" }] : []),
    { id: "keys", label: "My keys" },
  ];

  return (
    <>
      <header className="bar">
        <strong>MCP Gateway</strong>
        <nav className="tabs">
          {tabs.map((t) => (
            <button key={t.id} className={t.id === tab ? "tab active" : "tab"} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </nav>
        <span className="spacer" />
        <span className="muted">{user.email}</span>
        <span className={`badge ${user.role}`}>{user.role}</span>
        <button className="link" onClick={logout}>Sign out</button>
      </header>
      <main className="page">
        {tab === "servers" && isAdmin && <Servers />}
        {tab === "team" && isAdmin && <Team />}
        {tab === "audit" && isAdmin && <Audit />}
        {tab === "keys" && <MyKeys />}
        {tab === "chat" && <Chat />}
        {(tab === "overview" || ((tab === "servers" || tab === "team" || tab === "audit") && !isAdmin)) && (
          <>
            <h2>Welcome</h2>
            <p>You are signed in as <strong>{user.email}</strong> with the <strong>{user.role}</strong> role.</p>
            <p className="muted">Open Chat to ask questions about your stores, or My keys to connect an MCP client.</p>
          </>
        )}
      </main>
    </>
  );
}
