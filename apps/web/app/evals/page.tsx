import type { Metadata } from 'next';
import { Dashboard } from '@/components/evals/dashboard';

export const metadata: Metadata = { title: 'Evals' };

export default function EvalsPage() {
  return <Dashboard />;
}
