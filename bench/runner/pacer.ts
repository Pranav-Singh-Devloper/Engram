// Spaces requests to stay under free per-minute limits (P04 design decision 6).
// Each provider endpoint family gets its own lane. Backoff on 429 still
// applies on top; this just avoids hitting the limit in the first place.

export type Lane = 'gemini-generate' | 'gemini-embed' | 'groq';

export function laneOf(url: string): Lane | null {
  if (url.includes('api.groq.com')) return 'groq';
  if (url.includes('generativelanguage.googleapis.com')) {
    return url.includes(':batchEmbedContents') || url.includes(':embedContent')
      ? 'gemini-embed'
      : 'gemini-generate';
  }
  return null;
}

export const DEFAULT_RPM: Record<Lane, number> = {
  'gemini-generate': 12,
  'gemini-embed': 60,
  groq: 25,
};

export class Pacer {
  private next = new Map<Lane, number>();

  constructor(
    private readonly rpm: Record<Lane, number> = DEFAULT_RPM,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {}

  async wait(url: string): Promise<void> {
    const lane = laneOf(url);
    if (!lane) return;
    const interval = 60_000 / this.rpm[lane];
    const at = Math.max(this.now(), this.next.get(lane) ?? 0);
    this.next.set(lane, at + interval);
    const delay = at - this.now();
    if (delay > 0) await this.sleep(delay);
  }
}
