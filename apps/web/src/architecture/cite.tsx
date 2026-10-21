import { REFERENCES, referenceNumber } from '@/content/references';

/** An inline citation: [n], linking to the bibliography entry (chapter 16). */
export function Cite({ k }: { k: string }) {
  const n = referenceNumber(k);
  const ref = REFERENCES[n - 1];
  return (
    <sup className="ml-0.5">
      <a
        href={`#ref-${k}`}
        title={ref ? `${ref.authors} — ${ref.title}` : `unknown reference ${k}`}
        className="font-mono text-[0.7em] text-accent hover:underline"
      >
        [{n > 0 ? n : '?'}]
      </a>
    </sup>
  );
}
