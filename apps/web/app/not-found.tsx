import Link from 'next/link';
import { BrandImage } from '@/components/brand/brand-image';

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <BrandImage name="stacked" alt="Engram" width={240} height={214} className="h-48 w-auto" />
      <p className="mt-10 font-mono text-xs tracking-widest text-accent uppercase">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        Engram has no memory of this page.
      </h1>
      <p className="mt-2 text-muted-foreground">
        It was never stored, or it was archived. Nothing here was overwritten.
      </p>
      <Link
        href="/"
        className="mt-8 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
      >
        Back to the start
      </Link>
    </div>
  );
}
