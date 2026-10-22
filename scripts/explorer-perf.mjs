/* global process, fetch, WebSocket, setTimeout, console */
// The /architecture performance check (P09c task 8). Needs Chrome with a
// DevTools port and the GPU on, and a production build being served:
//   "Google Chrome" --headless=new --remote-debugging-port=9333 --user-data-dir=/tmp/x
//   (cd apps/web && pnpm build && pnpm start -p 3999)
//   node scripts/explorer-perf.mjs [--port=9333] [--url=http://localhost:3999/architecture] [--runs=3]
// For each chapter it records long tasks while the chapter mounts on a fresh
// load, then drives its controls for 3 s (sliders swept every frame, steppers
// clicked) with motion enabled, sampling every frame. Prints a markdown table.
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const port = arg('port', '9333');
const base = arg('url', 'http://localhost:3999/architecture');
const runs = Number(arg('runs', '3'));
const IDS = [
  'overview',
  'write-path',
  'bitemporal',
  'versions',
  'resolution',
  'recall',
  'decay',
  'consolidation',
  'galaxy',
  'storage',
  'providers',
  'interfaces',
  'benchmarks',
  'prior-art',
  'decisions',
  'references',
];

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let n = 0;
const pending = new Map();
ws.addEventListener('message', (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  }
});
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++n;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result
    ?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nav = async (q) => {
  await send('Page.navigate', { url: `${base}?theme=dark&perf=${q}` });
  await sleep(3500);
};
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
});

const HARNESS = String.raw`
(() => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const setVal = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const sweep = (sel) => (t) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const lo = Number(el.min || 0), hi = Number(el.max || 1);
    setVal(el, lo + (hi - lo) * (0.5 + 0.5 * Math.sin(t / 300)));
  };
  const clickEach = (sel, every) => {
    let last = -1e9, i = 0;
    return (t) => {
      if (t - last < every) return;
      last = t;
      const els = [...document.querySelectorAll(sel)];
      if (els.length) els[i++ % els.length].click();
    };
  };
  const ACTIONS = {
    overview: () => {},
    'write-path': clickEach('#write-path button', 400),
    bitemporal: clickEach('#bitemporal .space-y-3 ul button', 700),
    versions: clickEach('#versions button', 400),
    resolution: sweep('#resolution input[aria-label="Threshold"]'),
    recall: sweep('#recall input[aria-label="RRF k"]'),
    decay: sweep('#decay input[aria-label="importance"]'),
    consolidation: sweep('#consolidation input[aria-label="Minimum importance"]'),
    galaxy: (t) => {
      const c = document.querySelector('#galaxy canvas');
      if (!c) return;
      const r = c.getBoundingClientRect();
      c.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: r.left + r.width * (0.5 + 0.4 * Math.sin(t / 250)), clientY: r.top + r.height * (0.5 + 0.3 * Math.cos(t / 330)) }));
    },
    storage: clickEach('#storage .react-flow__node', 300),
    providers: sweep('#providers input[aria-label="generate calls"]'),
    interfaces: clickEach('#interfaces button[aria-label="Next step"]', 250),
    benchmarks: sweep('#benchmarks input[aria-label="judge too lenient"]'),
    'prior-art': clickEach('#prior-art th button', 300),
    decisions: (t) => {
      const i = document.querySelector('#decisions input');
      if (i) setVal(i, ['quota', 'bitemporal', 'Neon', ''][Math.floor(t / 700) % 4]);
    },
    references: () => {},
  };
  window.__perf = async (id) => {
    const long = [];
    const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => long.push({ d: e.duration, t: e.startTime })));
    po.observe({ type: 'longtask' });
    const el = document.getElementById(id);
    el.scrollIntoView({ block: 'start' });
    const m0 = performance.now();
    await wait(1800);
    el.scrollIntoView({ block: 'start' });
    window.scrollBy(0, 120);
    await wait(400);
    const s0 = performance.now();
    const deltas = [];
    const act = ACTIONS[id] ?? (() => {});
    await new Promise((resolve) => {
      let prev = performance.now();
      const frame = (now) => {
        deltas.push(now - prev);
        prev = now;
        try { act(now - s0); } catch (e) { /* the measurement goes on */ }
        if (now - s0 < 3000) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    await wait(100);
    po.disconnect();
    const ds = deltas.slice(2).sort((a, b) => a - b);
    const q = (p) => ds[Math.min(ds.length - 1, Math.floor(p * ds.length))];
    const mount = long.filter((x) => x.t < s0).map((x) => Math.round(x.d));
    const during = long.filter((x) => x.t >= s0).map((x) => Math.round(x.d));
    return {
      id,
      frames: ds.length,
      fps: Math.round((1000 * ds.length) / ds.reduce((a, b) => a + b, 0)),
      p50: +q(0.5).toFixed(1),
      p95: +q(0.95).toFixed(1),
      max: +ds[ds.length - 1].toFixed(1),
      dropped: +((100 * ds.filter((d) => d > 25).length) / ds.length).toFixed(1),
      mountLong: mount,
      interactLong: during,
    };
  };
  return "harness ready";
})()
`;
const MOUNT = (id) =>
  `(async()=>{const long=[];const po=new PerformanceObserver(l=>l.getEntries().forEach(e=>long.push(Math.round(e.duration))));po.observe({type:"longtask"});await new Promise(r=>setTimeout(r,300));document.getElementById(${JSON.stringify(id)}).scrollIntoView();await new Promise(r=>setTimeout(r,2500));po.disconnect();return long})()`;

const rows = Object.fromEntries(
  IDS.map((id) => [id, { fps: [], p95: [], max: [], dropped: [], interact: [], mount: [] }]),
);
for (let r = 0; r < runs; r++) {
  await nav(`i${r}`);
  await evaluate(HARNESS);
  for (const id of IDS) {
    const m = await evaluate(`window.__perf(${JSON.stringify(id)})`);
    const row = rows[id];
    row.fps.push(m.fps);
    row.p95.push(m.p95);
    row.max.push(m.max);
    row.dropped.push(m.dropped);
    row.interact.push(...m.interactLong);
  }
  for (const id of IDS) {
    await nav(`m${r}-${id}`);
    rows[id].mount.push(...(await evaluate(MOUNT(id))));
  }
}
ws.close();
const worst = (xs) => (xs.length ? Math.max(...xs) : 0);
console.log(
  `| chapter | fps (min of ${runs}) | p95 frame | worst frame | dropped | long tasks, interacting | long tasks, mounting |`,
);
console.log('|---|---|---|---|---|---|---|');
for (const id of IDS) {
  const r = rows[id];
  const fmt = (xs) => (xs.length ? xs.map((x) => `${x} ms`).join(', ') : 'none');
  console.log(
    `| ${id} | ${Math.min(...r.fps)} | ${worst(r.p95)} ms | ${worst(r.max)} ms | ${worst(r.dropped)}% | ${fmt(r.interact)} | ${fmt(r.mount)} |`,
  );
}
