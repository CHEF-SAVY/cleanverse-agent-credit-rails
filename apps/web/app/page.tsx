/**
 * The story page.
 *
 * Entirely static: the pitch must render instantly and can never depend on Cleanverse being
 * reachable. Everything live lives on `/live`.
 */

import { Hero } from "@/components/site/hero";
import {
  Architecture,
  CallToAction,
  Ladder,
  Problem,
  SiteFooter,
  Stats,
} from "@/components/site/sections";

export default function Home() {
  return (
    <main className="ambient-page min-h-screen">
      <Hero />
      <Problem />
      <Architecture />
      <Ladder />
      <Stats />
      <CallToAction />
      <SiteFooter />
    </main>
  );
}
