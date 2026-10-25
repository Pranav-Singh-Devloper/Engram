import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { Footer } from '@/components/footer';
import { Nav } from '@/components/nav';
import { Providers } from '@/components/providers';
import { THEME_SCRIPT } from '@/components/theme-toggle';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

// Absolute URLs for the social card (app/opengraph-image.png) on every deploy.
const site =
  process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? 'localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(site.startsWith('localhost') ? `http://${site}` : `https://${site}`),
  title: { default: 'Engram', template: '%s · Engram' },
  description:
    'A persistent memory engine for AI agents: episodic and semantic memory with consolidation, decay, conflict resolution and bitemporal validity.',
  openGraph: { siteName: 'Engram', type: 'website' },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#121216' },
    { media: '(prefers-color-scheme: light)', color: '#fbfbfb' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh font-sans">
        <Providers>
          <Nav />
          <main>{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
