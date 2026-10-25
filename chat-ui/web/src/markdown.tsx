import type { ReactNode } from "react";

// Renders the subset the chat uses: fenced code, paragraphs, line breaks, inline code, and bold. Text becomes
// React children, so nothing is parsed as HTML.

const FENCE = /```[^\n]*\n?([\s\S]*?)```/g;
const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/;

export function Markdown({ text }: { text: string }) {
  return <>{renderBlocks(text)}</>;
}

function renderBlocks(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(FENCE)) {
    const start = match.index ?? 0;
    nodes.push(...paragraphs(text.slice(last, start), `p${last}`));
    nodes.push(
      <pre key={`code${start}`}>
        <code>{match[1].replace(/\n$/, "")}</code>
      </pre>,
    );
    last = start + match[0].length;
  }
  nodes.push(...paragraphs(text.slice(last), `p${last}`));
  return nodes;
}

function paragraphs(text: string, keyPrefix: string): ReactNode[] {
  return text
    .split(/\n{2,}/)
    .filter((paragraph) => paragraph.trim() !== "")
    .map((paragraph, index) => <p key={`${keyPrefix}-${index}`}>{inline(paragraph)}</p>);
}

// split() with a capture group puts each match at an odd index.
function inline(paragraph: string): ReactNode[] {
  return paragraph.split("\n").flatMap((line, lineIndex) => {
    const parts = line.split(INLINE).map((part, partIndex) => {
      const key = `${lineIndex}-${partIndex}`;
      if (partIndex % 2 === 0) return part;
      if (part.startsWith("`")) return <code key={key}>{part.slice(1, -1)}</code>;
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    });
    return lineIndex === 0 ? parts : [<br key={`br${lineIndex}`} />, ...parts];
  });
}
