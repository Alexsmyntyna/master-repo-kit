"use client";
import { useEffect } from "react";

// Collapsed messages are <details>; following a #mN link opens that one and scrolls to it.
export function OpenOnHash() {
  useEffect(() => {
    const open = () => {
      const el = document.getElementById(location.hash.slice(1));
      if (el instanceof HTMLDetailsElement) {
        el.open = true;
        el.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}
