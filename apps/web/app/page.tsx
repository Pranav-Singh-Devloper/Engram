import { Bento } from '@/components/landing/bento';
import { Hero } from '@/components/landing/hero';
import { LiveStats, Measured, Stack, UseIt } from '@/components/landing/sections';

export default function Home() {
  return (
    <>
      <Hero />
      <Stack />
      <LiveStats />
      <Bento />
      <Measured />
      <UseIt />
    </>
  );
}
