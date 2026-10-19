import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { CHAT_MAX_CHARS, CHAT_MAX_MESSAGES, sendChat, type ToolTrace } from "./api";
import { RichText } from "./RichText";
import { fmtDuration, messageOf } from "./util";

interface Turn {
  id: number;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolTrace[];
  stoppedEarly?: boolean;
}

const SUGGESTIONS = [
  "Which products does the store sell?",
  "What orders came in today?",
  "Create a product named Test Mug with price 199",
];

export function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [turns, busy]);

  async function send(text: string) {
    const clean = text.trim();
    if (!clean || busy) return;
    const userTurn: Turn = { id: nextId.current++, role: "user", content: clean };
    // The backend keeps no chat: every request carries the history (last 20 messages, each cut to 4000 characters).
    const history = [...turns, userTurn].slice(-CHAT_MAX_MESSAGES).map((t) => ({ role: t.role, content: t.content.slice(0, CHAT_MAX_CHARS) }));
    setTurns((prev) => [...prev, userTurn]);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const res = await sendChat(history);
      setTurns((prev) => [...prev, { id: nextId.current++, role: "assistant", content: res.answer, toolCalls: res.toolCalls, stoppedEarly: res.stoppedEarly }]);
    } catch (e) {
      // Do not keep a question that got no answer: put the text back so it can be sent again.
      setTurns((prev) => prev.filter((t) => t.id !== userTurn.id));
      setInput(clean);
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const submit = (e: FormEvent) => { e.preventDefault(); void send(input); };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); }
  };

  return (
    <section className="chat">
      <div className="row">
        <h2>Chat</h2>
        <span className="spacer" />
        <button className="secondary" disabled={busy || turns.length === 0} onClick={() => { setTurns([]); setError(null); }}>Clear chat</button>
      </div>
      <p className="muted">
        Ask about your stores. The assistant answers by calling the same tools as an external MCP client, as you:
        every call shows in the audit log under your name.
      </p>

      <div className="messages" aria-live="polite">
        {turns.length === 0 && (
          <div className="suggestions">
            {SUGGESTIONS.map((s) => <button key={s} className="secondary" onClick={() => void send(s)} disabled={busy}>{s}</button>)}
          </div>
        )}
        {turns.map((t) => <Bubble key={t.id} turn={t} />)}
        {busy && <div className="bubble assistant"><span className="muted">Thinking and running tools...</span></div>}
        <div ref={endRef} />
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      <form className="composer" onSubmit={submit}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask a question. Enter to send, Shift+Enter for a new line."
          rows={2}
          maxLength={CHAT_MAX_CHARS}
          aria-label="Your message"
        />
        <button type="submit" disabled={busy || input.trim() === ""}>Send</button>
      </form>
    </section>
  );
}

function Bubble({ turn }: { turn: Turn }) {
  if (turn.role === "user") return <div className="bubble user">{turn.content}</div>;
  return (
    <div className="bubble assistant">
      <RichText text={turn.content || "(no answer)"} />
      {turn.stoppedEarly && <p className="warn small">The assistant stopped before finishing. Try a more specific question.</p>}
      {turn.toolCalls && turn.toolCalls.length > 0 && <ToolCalls calls={turn.toolCalls} />}
    </div>
  );
}

function ToolCalls({ calls }: { calls: ToolTrace[] }) {
  const failed = calls.filter((c) => !c.ok).length;
  return (
    <details className="toolcalls">
      <summary>
        Used {calls.length} {calls.length === 1 ? "tool" : "tools"}
        {failed > 0 && <span className="error"> ({failed} failed)</span>}
      </summary>
      <ul>
        {calls.map((c, i) => (
          <li key={i}>
            <div className="row">
              <code>{c.tool}</code>
              <span className={`status ${c.ok ? "connected" : "unreachable"}`}>{c.ok ? "ok" : "error"}</span>
              <span className="muted small">{fmtDuration(c.durationMs)}</span>
            </div>
            {/* args come from the model and the preview from an upstream server: both are rendered as plain text. */}
            <code className="small args">{JSON.stringify(c.args)}</code>
            <pre className="preview">{c.preview}</pre>
          </li>
        ))}
      </ul>
    </details>
  );
}
