// The 4-minute film, streamed as the original 1080p60 file (no re-encode), never
// from the deploy, so Vercel serves no video bytes (ADR-024). Hugging Face sends
// video/mp4, which Safari needs; the GitHub release is the fallback and the download.
const RELEASE =
  'https://github.com/Pranav-Singh-Devloper/Engram/releases/download/v1.0.0/engram-film-1080p.mp4';
const SOURCES = [
  'https://huggingface.co/datasets/pranav-singh-developer-1/engram-media/resolve/main/engram-film-1080p.mp4',
  RELEASE,
];

export function Film() {
  return (
    <section id="film" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-16">
      <p className="font-mono text-xs tracking-widest text-accent uppercase">The film</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight">Four minutes, end to end.</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        The problem, a worked example, the architecture and the benchmarks, losses included.
      </p>
      <div className="mt-6 overflow-hidden rounded-xl border bg-black">
        <video
          className="aspect-video w-full"
          controls
          playsInline
          preload="none"
          poster="/film-poster.jpg"
          aria-label="The Engram film: the architecture, the bitemporal model and the benchmarks"
        >
          {SOURCES.map((src) => (
            <source key={src} src={src} type="video/mp4" />
          ))}
        </video>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        3:57 · 1080p60 · voice by{' '}
        <a href="https://elevenlabs.io" className="underline-offset-2 hover:underline">
          ElevenLabs
        </a>{' '}
        ·{' '}
        <a href={RELEASE} className="underline-offset-2 hover:underline">
          download
        </a>
      </p>
    </section>
  );
}
