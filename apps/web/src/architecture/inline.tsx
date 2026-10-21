import type { ReactNode } from 'react';

/**
 * Renders the small Markdown subset the ADRs use inline: `code`, **bold**,
 * *italic* and [text](url). Text is never injected as HTML; external links
 * open in a new tab.
 */
export function Inline({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = i++;
    if (m[1] !== undefined)
      out.push(
        <code key={key} className="rounded bg-muted px-1 font-mono text-[0.85em]">
          {m[1]}
        </code>,
      );
    else if (m[2] !== undefined)
      out.push(
        <strong key={key} className="font-semibold">
          {m[2]}
        </strong>,
      );
    else if (m[3] !== undefined) out.push(<em key={key}>{m[3]}</em>);
    else if (m[4] !== undefined && m[5] !== undefined) {
      const external = /^https?:/.test(m[5]);
      out.push(
        <a
          key={key}
          href={m[5]}
          className="text-accent underline decoration-dotted underline-offset-2"
          {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
        >
          {m[4]}
        </a>,
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
