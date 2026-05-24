import React from "react";

function inline(text: string, keyBase: string): React.ReactNode[] {
  // Split on **bold** and *italic*
  const out: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={`${keyBase}-b${i}`} className="font-semibold text-white">{m[1]}</strong>);
    else if (m[2]) out.push(<em key={`${keyBase}-i${i}`}>{m[2]}</em>);
    else if (m[3]) out.push(<em key={`${keyBase}-u${i}`} className="text-mist-dim">{m[3]}</em>);
    last = regex.lastIndex;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Minimal, safe markdown-ish renderer: bold/italic, bullets, paragraphs. */
export function Rich({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let key = 0;

  const flushList = () => {
    if (list.length) {
      const items = [...list];
      blocks.push(
        <ul key={`ul${key++}`} className="my-1.5 space-y-1 pl-1">
          {items.map((it, idx) => (
            <li key={idx} className="flex gap-2">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-violet-glow" />
              <span>{inline(it, `li${key}-${idx}`)}</span>
            </li>
          ))}
        </ul>,
      );
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/g, "");
    const bullet = line.match(/^\s*(?:[•\-*]|\d+\.)\s+(.*)$/);
    if (bullet) {
      list.push(bullet[1]);
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      blocks.push(
        <p key={`p${key++}`} className="my-1 leading-relaxed">
          {inline(line, `p${key}`)}
        </p>,
      );
    }
  }
  flushList();

  return <div className="text-sm text-white/90">{blocks}</div>;
}
