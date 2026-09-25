"use client";

// The app has two looks: "studio" (new, default) and "classic" (original).
// The choice lives on <html data-style> and in localStorage, so it applies
// before first paint (see the inline script in app/layout.tsx).

import * as React from "react";

export type UiStyle = "studio" | "classic";
const KEY = "anmol-style";

export function getUiStyle(): UiStyle {
  if (typeof document === "undefined") return "studio";
  return document.documentElement.getAttribute("data-style") === "classic" ? "classic" : "studio";
}

export function setUiStyle(s: UiStyle) {
  try { localStorage.setItem(KEY, s); } catch { /* storage blocked: applies for this visit only */ }
  document.documentElement.setAttribute("data-style", s);
}

export function useUiStyle(): UiStyle {
  return React.useSyncExternalStore(
    (cb) => {
      const obs = new MutationObserver(cb);
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-style"] });
      return () => obs.disconnect();
    },
    getUiStyle,
    () => "studio",
  );
}
