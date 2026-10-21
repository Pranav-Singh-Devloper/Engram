import type { Metadata } from 'next';
import { EntityTimeline } from '@/components/timeline/entity-timeline';

export const metadata: Metadata = { title: 'Timeline' };

export default async function EntityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EntityTimeline id={id} />;
}
