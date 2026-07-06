"use client";

import { useEffect } from "react";

const SCROLLBAR_CLASS = "scrollbar-scrolling";
const SCROLLBAR_IDLE_DELAY_MS = 780;

export function ScrollbarVisibilityProvider() {
  useEffect(() => {
    const timers = new WeakMap<Element, number>();
    const activeTimers = new Set<number>();

    function markScrolling(target: EventTarget | null) {
      const element = target instanceof Element ? target : document.scrollingElement ?? document.documentElement;
      element.classList.add(SCROLLBAR_CLASS);

      const existingTimer = timers.get(element);
      if (existingTimer !== undefined) {
        window.clearTimeout(existingTimer);
        activeTimers.delete(existingTimer);
      }

      const timer = window.setTimeout(() => {
        element.classList.remove(SCROLLBAR_CLASS);
        timers.delete(element);
        activeTimers.delete(timer);
      }, SCROLLBAR_IDLE_DELAY_MS);

      timers.set(element, timer);
      activeTimers.add(timer);
    }

    function handleScroll(event: Event) {
      markScrolling(event.target);
    }

    window.addEventListener("scroll", handleScroll, { capture: true, passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      activeTimers.forEach((timer) => window.clearTimeout(timer));
      activeTimers.clear();
      document.querySelectorAll(`.${SCROLLBAR_CLASS}`).forEach((element) => {
        element.classList.remove(SCROLLBAR_CLASS);
      });
    };
  }, []);

  return null;
}
