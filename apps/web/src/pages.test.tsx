// Render smoke tests (P09b tests): every page renders on the server without
// throwing and shows its key text. Browser behavior is checked in Chrome.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/memories',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('q=berlin'),
}));

const { Hero } = await import('./components/landing/hero');
const { HowItWorks, UseIt } = await import('./components/landing/sections');
const { Playground } = await import('./components/chat/playground');
const { Inspector } = await import('./components/memories/inspector');
const { EntityTimeline } = await import('./components/timeline/entity-timeline');
const { Dashboard } = await import('./components/evals/dashboard');

const render = (node: ReactNode) =>
  renderToString(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);

describe('pages render', () => {
  it('landing', () => {
    const html = render(
      <>
        <Hero />
        <HowItWorks />
        <UseIt />
      </>,
    );
    expect(html).toContain('knows when it learned');
    expect(html).toContain('Forget and consolidate');
    expect(html).toContain('claude mcp add');
  });

  it('chat, with the data notice before any session exists', () => {
    const html = render(<Playground />);
    expect(html).toContain('enter personal data');
    expect(html).toContain('Sessions');
  });

  it('memories, with the search from the URL', () => {
    expect(render(<Inspector />)).toContain('ranked by retention score');
  });

  it('entity timeline and evals render their loading states', () => {
    expect(render(<EntityTimeline id="00000000-0000-4000-8000-000000000000" />)).toContain(
      'Loading the timeline',
    );
    expect(render(<Dashboard />)).toContain('Loading bench results');
  });
});
