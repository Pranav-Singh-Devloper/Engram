import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Inspector } from '@/components/memories/inspector';

export const metadata: Metadata = { title: 'Memories' };

export default function MemoriesPage() {
  // useSearchParams needs a Suspense boundary for static rendering.
  return (
    <Suspense>
      <Inspector />
    </Suspense>
  );
}
