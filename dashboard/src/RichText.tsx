import type { ReactNode } from "react";

// A tiny, SAFE formatter for model answers: paragraphs, bullet and numbered lists, **bold** and `code`.
// It builds React elements and never injects HTML, so text from a model or an upstream server cannot run as script.

function inline(text: string, prefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;
  let last = 0;
  let n = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${prefix}-${n++}`;
    out.push(tok.startsWith("**") ? <strong key={key}>{tok.slice(2, -2)}</strong> : <code key={key}>{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  let b = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i++; continue; }

    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      const re = bullet ? BULLET : NUMBERED;
      const items: ReactNode[] = [];
      for (let m = re.exec(lines[i] ?? ""); i < lines.length && m; m = re.exec(lines[i] ?? "")) {
        items.push(<li key={items.length}>{inline(m[1], `b${b}-${items.length}`)}</li>);
        i++;
      }
      blocks.push(bullet ? <ul key={b++}>{items}</ul> : <ol key={b++}>{items}</ol>);
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i])) para.push(lines[i++]);
    blocks.push(
      <p key={b++}>
        {para.flatMap((p, k) => (k === 0 ? inline(p, `p${b}-${k}`) : [<br key={`br${k}`} />, ...inline(p, `p${b}-${k}`)]))}
      </p>,
    );
  }
  return <div className="rich">{blocks}</div>;
}
