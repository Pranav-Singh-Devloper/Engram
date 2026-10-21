'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  // One client per browser tab; reads stay fresh for 30 s and don't refetch on focus,
  // so browsing never hammers the API (or, through it, Neon's compute budget).
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
