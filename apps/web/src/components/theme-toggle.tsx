'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

/** Runs before first paint (inlined in <head>), so the page never flashes the wrong theme. */
// `?theme=light|dark` overrides for one visit (screenshots, README images).
export const THEME_SCRIPT = `(function(){try{var q=new URLSearchParams(location.search).get('theme');var t=q==='light'||q==='dark'?q:localStorage.getItem('engram-theme');var d=t?t==='dark':!window.matchMedia('(prefers-color-scheme: light)').matches;document.documentElement.classList.add(d?'dark':'light');}catch(e){document.documentElement.classList.add('dark');}})();`;

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    setTheme(document.documentElement.classList.contains('light') ? 'light' : 'dark');
  }, []);
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      aria-label={`Switch to ${next} theme`}
      className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      onClick={() => {
        const root = document.documentElement;
        root.classList.remove('dark', 'light');
        root.classList.add(next);
        try {
          localStorage.setItem('engram-theme', next);
        } catch {
          // Private mode: the choice lasts for this page only.
        }
        setTheme(next);
      }}
    >
      {theme === 'light' ? <Moon className="size-4" /> : <Sun className="size-4" />}
    </button>
  );
}
