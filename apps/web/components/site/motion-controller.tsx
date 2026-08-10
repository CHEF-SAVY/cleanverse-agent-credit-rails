"use client";

/**
 * Tiny progressive-enhancement layer for the marketing and live surfaces.
 *
 * Scroll entrances use native CSS view timelines. This component only steers the low-contrast
 * ambient light with pointer movement, keeping the rest of the page server-rendered and avoiding
 * hydration-time DOM mutations.
 */

import { useEffect } from "react";

export function MotionController() {
  useEffect(() => {
    const root = document.documentElement;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) return;

    let pointerFrame = 0;
    const moveAmbientLight = (event: PointerEvent) => {
      if (pointerFrame) cancelAnimationFrame(pointerFrame);
      pointerFrame = requestAnimationFrame(() => {
        root.style.setProperty("--pointer-x", `${event.clientX}px`);
        root.style.setProperty("--pointer-y", `${event.clientY}px`);
      });
    };
    window.addEventListener("pointermove", moveAmbientLight, { passive: true });

    return () => {
      window.removeEventListener("pointermove", moveAmbientLight);
      if (pointerFrame) cancelAnimationFrame(pointerFrame);
    };
  }, []);

  return null;
}
