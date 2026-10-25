'use client';

import { schemeTableau10 } from 'd3';
import { Minus, Pause, Play, Plus, RotateCcw, Search } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Cite } from '../cite';
import { GALAXY, PERSONAS, SPACES, neighbourStats } from '../data/galaxy';
import type { GalaxyKind, GalaxyPoint } from '../data/galaxy';

const Scene = dynamic(() => import('./galaxy-scene'), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-xs text-muted-foreground">
      loading the scene…
    </div>
  ),
});

const KIND: Record<GalaxyKind, { label: string; token: string; size: number }> = {
  story: { label: 'turns about the user', token: '--valid', size: 8 },
  fact: { label: 'facts Engram extracted', token: '--accent', size: 10 },
  filler: { label: 'filler turns (general questions)', token: '--muted-foreground', size: 6 },
};
const DEFAULT_DISTANCE = 1.9;

/** A CSS colour (oklch tokens included) as linear-ish RGB in 0–1, via a 1-pixel canvas. */
function rgbOf(css: string): [number, number, number] {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const ctx = c.getContext('2d');
  if (!ctx) return [1, 1, 1];
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 255, g = 255, b = 255] = ctx.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255];
}

/** The page's theme, kept current as the toggle flips it. */
function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => {
    const root = document.documentElement;
    const read = () => {
      setTheme(root.classList.contains('light') ? 'light' : 'dark');
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => {
      mo.disconnect();
    };
  }, []);
  return theme;
}

const hasWebGL = () => {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    // The probe's context is released at once; the scene creates its own.
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return Boolean(gl);
  } catch {
    return false;
  }
};

/**
 * Without WebGL: the same points flattened onto the projection's two widest
 * axes (z across, y up), the view the 3D camera starts from.
 */
function Flat({
  points,
  colors,
  alphas,
}: {
  points: readonly GalaxyPoint[];
  colors: Float32Array;
  alphas: Float32Array;
}) {
  const zs = points.map((p) => p.z);
  const ys = points.map((p) => -p.y);
  const pad = 0.06;
  const [x0, x1, y0, y1] = [Math.min(...zs), Math.max(...zs), Math.min(...ys), Math.max(...ys)];
  const rgb = (i: number) =>
    `rgb(${[0, 1, 2].map((k) => String(Math.round((colors[i * 3 + k] ?? 1) * 255))).join(' ')})`;
  return (
    <svg
      viewBox={`${String(x0 - pad)} ${String(y0 - pad)} ${String(x1 - x0 + 2 * pad)} ${String(y1 - y0 + 2 * pad)}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
      role="img"
      aria-label="The embedding galaxy, flattened to two dimensions"
    >
      {points.map((p, i) => (
        <circle key={i} cx={p.z} cy={-p.y} r={0.011} fill={rgb(i)} opacity={alphas[i] ?? 1}>
          <title>{p.text}</title>
        </circle>
      ))}
    </svg>
  );
}

export function Galaxy() {
  const still = useReducedMotion();
  const theme = useTheme();
  const box = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'kind' | 'persona'>('kind');
  const [persona, setPersona] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [spin, setSpin] = useState(true);
  const [distance, setDistance] = useState(DEFAULT_DISTANCE);
  const [visible, setVisible] = useState(false);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  // Which embedding space to show: Gemini, or local mode's embeddinggemma.
  const [spaceIndex, setSpaceIndex] = useState(0);
  const G = SPACES[spaceIndex] ?? GALAXY;
  const stats = useMemo(() => neighbourStats(G.points), [G]);

  useEffect(() => {
    // Creating a WebGL context is the costly part of the check, so it runs in
    // its own idle task, not in the chapter's mount (P09c task 8).
    const idle = 'requestIdleCallback' in window;
    const probe = () => {
      setWebgl(hasWebGL());
    };
    const handle = idle
      ? window.requestIdleCallback(probe, { timeout: 400 })
      : window.setTimeout(probe, 0);
    const el = box.current;
    if (!el) return;
    // Render frames only while the scene is on screen.
    const io = new IntersectionObserver(([e]) => {
      setVisible(Boolean(e?.isIntersecting));
    });
    io.observe(el);
    return () => {
      io.disconnect();
      if (idle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, []);

  const palette = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const style = getComputedStyle(document.documentElement);
    const token = (t: string) => rgbOf(style.getPropertyValue(t).trim() || '#888');
    return {
      kind: Object.fromEntries(
        (Object.keys(KIND) as GalaxyKind[]).map((k) => [k, token(KIND[k].token)]),
      ) as Record<GalaxyKind, [number, number, number]>,
      persona: Object.fromEntries(PERSONAS.map((p, i) => [p, rgbOf(schemeTableau10[i] ?? '#888')])),
    };
    // Recomputed when the theme flips, because the tokens change with it.
  }, [theme, webgl]);

  const needle = query.trim().toLowerCase();
  const { colors, alphas, sizes, matches } = useMemo(() => {
    const n = G.points.length;
    const colors = new Float32Array(n * 3);
    const alphas = new Float32Array(n);
    const sizes = new Float32Array(n);
    let matches = 0;
    G.points.forEach((p, i) => {
      const c =
        (mode === 'kind' ? palette?.kind[p.kind] : palette?.persona[p.persona]) ??
        ([1, 1, 1] as const);
      colors.set(c, i * 3);
      const hit =
        (persona === null || p.persona === persona) &&
        (needle === '' || p.text.toLowerCase().includes(needle));
      if (hit && (persona !== null || needle !== '')) matches++;
      const dim = !hit;
      alphas[i] = dim ? 0.08 : p.kind === 'filler' && mode === 'kind' ? 0.55 : 0.95;
      sizes[i] = KIND[p.kind].size * (i === picked ? 2.2 : dim ? 0.7 : 1);
    });
    return { colors, alphas, sizes, matches };
  }, [G, mode, palette, persona, needle, picked]);

  const pickedPoint = picked === null ? null : G.points[picked];
  const hoverPoint = hover ? G.points[hover.i] : null;
  const rect = box.current?.getBoundingClientRect();

  return (
    <div>
      <p className="max-w-3xl text-muted-foreground">
        Everything Engram recalls by meaning lives in one 768-dimensional space. Gemini Embedding
        <Cite k="lee2025" /> is asked for 768 of its dimensions, which its Matryoshka training makes
        a faithful truncation
        <Cite k="kusupati2022" />. Below are {G.points.length} real texts from the dev-long
        histories, embedded exactly as the engine embeds them and projected to 3D with seeded UMAP
        <Cite k="mcinnes2018" />. Drag to turn it, hover a star to read it, click to pin it.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div
          className="inline-flex rounded-md border p-0.5"
          role="group"
          aria-label="Embedding space"
        >
          {SPACES.map((g, i) => (
            <button
              key={g.space}
              onClick={() => {
                setSpaceIndex(i);
              }}
              aria-pressed={spaceIndex === i}
              className={cn(
                'rounded px-2.5 py-0.5 font-mono text-[11px]',
                spaceIndex === i ? 'bg-accent/15 text-foreground' : 'text-muted-foreground',
              )}
            >
              {g.space.split('@')[0]}
            </button>
          ))}
        </div>
        {(['kind', 'persona'] as const).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
            }}
            className={cn(
              'rounded-md border px-2.5 py-1 text-xs',
              mode === m ? 'border-accent bg-accent/10' : 'text-muted-foreground',
            )}
          >
            colour by {m}
          </button>
        ))}
        <select
          value={persona ?? ''}
          onChange={(e) => {
            setPersona(e.target.value || null);
          }}
          aria-label="Highlight a persona"
          className="h-7 rounded-md border bg-background px-2 text-xs"
        >
          <option value="">all 8 personas</option>
          {PERSONAS.map((p) => (
            <option key={p} value={p}>
              persona {p}
            </option>
          ))}
        </select>
        <label className="relative">
          <Search className="pointer-events-none absolute top-1.5 left-2 size-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            placeholder="find text (e.g. allergic)"
            aria-label="Find text in the galaxy"
            className="h-7 w-48 rounded-md border bg-background pr-2 pl-7 text-xs outline-none focus:border-accent"
          />
        </label>
        {(persona !== null || needle !== '') && (
          <span className="font-mono text-[11px] text-muted-foreground">{matches} lit</span>
        )}
      </div>

      <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_17rem]">
        <div
          ref={box}
          className="relative h-[340px] overflow-hidden rounded-lg border bg-card sm:h-[460px]"
          onMouseLeave={() => {
            setHover(null);
          }}
        >
          {webgl === false && palette ? (
            <Flat points={G.points} colors={colors} alphas={alphas} />
          ) : (
            webgl && (
              <Scene
                points={G.points}
                colors={colors}
                alphas={alphas}
                sizes={sizes}
                additive={theme === 'dark'}
                rotate={spin && !still}
                running={visible}
                distance={distance}
                onHover={(i, client) => {
                  setHover(i === null || !client ? null : { i, ...client });
                }}
                onPick={setPicked}
              />
            )
          )}
          <div className="absolute right-2 bottom-2 flex gap-1">
            {[
              {
                label: spin && !still ? 'Pause rotation' : 'Rotate',
                icon: spin && !still ? Pause : Play,
                on: () => {
                  setSpin(!spin);
                },
              },
              {
                label: 'Zoom in',
                icon: Plus,
                on: () => {
                  setDistance((d) => Math.max(1.3, d - 0.5));
                },
              },
              {
                label: 'Zoom out',
                icon: Minus,
                on: () => {
                  setDistance((d) => Math.min(6, d + 0.5));
                },
              },
              {
                label: 'Reset',
                icon: RotateCcw,
                on: () => {
                  setDistance(DEFAULT_DISTANCE);
                  setPicked(null);
                  setQuery('');
                  setPersona(null);
                },
              },
            ].map((b) => (
              <button
                key={b.label}
                onClick={b.on}
                aria-label={b.label}
                title={b.label}
                className="grid size-7 place-items-center rounded-md border bg-background/80 text-muted-foreground backdrop-blur hover:text-foreground"
              >
                <b.icon className="size-3.5" />
              </button>
            ))}
          </div>
          {hoverPoint && hover && rect && (
            <div
              className="pointer-events-none absolute z-10 w-60 rounded-lg border bg-card/95 p-2.5 text-xs shadow-xl backdrop-blur"
              style={{
                left: Math.min(hover.x - rect.left + 12, rect.width - 250),
                top: Math.min(hover.y - rect.top + 12, rect.height - 90),
              }}
            >
              <p className="font-mono text-[10px] text-muted-foreground">
                {hoverPoint.kind} · persona {hoverPoint.persona}
              </p>
              <p className="mt-1">{hoverPoint.text}</p>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <ul className="space-y-1.5 rounded-lg border bg-card p-3 text-xs">
            {mode === 'kind'
              ? (Object.keys(KIND) as GalaxyKind[]).map((k) => (
                  <li key={k} className="flex items-center gap-2">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ background: `var(${KIND[k].token})` }}
                    />
                    {KIND[k].label}
                    <span className="ml-auto font-mono text-muted-foreground">
                      {stats.find((s) => s.kind === k)?.n}
                    </span>
                  </li>
                ))
              : PERSONAS.map((p, i) => (
                  <li key={p} className="flex items-center gap-2">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ background: schemeTableau10[i] }}
                    />
                    persona {p}
                  </li>
                ))}
          </ul>
          <div className="rounded-lg border bg-card p-3 text-xs">
            <p className="font-mono text-[11px] text-muted-foreground">
              each point’s 5 nearest neighbours
            </p>
            <table className="mt-2 w-full">
              <thead className="text-[10px] text-muted-foreground">
                <tr>
                  <th className="text-left font-normal">kind</th>
                  <th className="text-right font-normal">same kind</th>
                  <th className="text-right font-normal">same persona</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {stats.map((s) => (
                  <tr key={s.kind}>
                    <td className="py-0.5 font-sans">{s.kind}</td>
                    <td className="text-right">{Math.round(s.sameKind * 100)}%</td>
                    <td className="text-right">{Math.round(s.samePersona * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-muted-foreground">
              Chance for persona is {Math.round(100 / PERSONAS.length)}%. The space sorts by
              meaning, not by who said it: p2’s “I live in Melbourne” sits beside p4’s “I live in
              Osaka”. That’s why users are separated by namespace in SQL, never by embeddings.
            </p>
          </div>
          {pickedPoint && (
            <div className="rounded-lg border border-accent/50 bg-card p-3 text-xs">
              <p className="font-mono text-[10px] text-muted-foreground">
                pinned · {pickedPoint.kind} · persona {pickedPoint.persona}
              </p>
              <p className="mt-1">{pickedPoint.text}</p>
            </div>
          )}
        </div>
      </div>

      <p className="mt-3 max-w-3xl text-xs text-muted-foreground">
        {G.method}. Source: {G.source}. UMAP keeps neighbourhoods, not distances: two clusters far
        apart here aren’t necessarily far apart in 768-d, and recall never uses this projection.
        Switch the space to see local mode’s embeddinggemma place the same texts: the shapes differ,
        but the neighbourhoods agree (about three quarters of a story turn’s neighbours are story
        turns in either, and persona stays near chance). The coordinates themselves can’t be
        compared, which is why a namespace never mixes the two spaces (ADR-017).
      </p>
    </div>
  );
}
