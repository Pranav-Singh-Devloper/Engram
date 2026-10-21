import type { Metadata } from 'next';
import { Playground } from '@/components/chat/playground';

export const metadata: Metadata = { title: 'Chat' };

export default function ChatPage() {
  return <Playground />;
}
