import { Bento } from '@/components/landing/bento';
import { Film } from '@/components/landing/film';
import { Hero } from '@/components/landing/hero';
import { LiveStats, Measured, Stack, UseIt } from '@/components/landing/sections';

export default function Home() {
  return (
    <>
      <Hero />
      <Film />
      <Stack />
      <LiveStats />
      <Bento />
      <Measured />
      <UseIt />
    </>
  );
}
