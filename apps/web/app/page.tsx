import { Hero } from '@/components/landing/hero';
import { HowItWorks, LiveStats, Measured, UseIt } from '@/components/landing/sections';

export default function Home() {
  return (
    <>
      <Hero />
      <LiveStats />
      <HowItWorks />
      <Measured />
      <UseIt />
    </>
  );
}
