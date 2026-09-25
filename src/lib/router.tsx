"use client";

// Tiny hash router (#/customers/c1). Keeps the app a single static page so it
// runs the same on Vercel, any static host, or opened from a preview link.

import * as React from "react";
import { cn } from "./utils";

function currentPath() {
  if (typeof window === "undefined") return "/";
  const h = window.location.hash.replace(/^#/, "");
  if (!h) return "/";
  // Short share links like #driver work too (some hosts only pass plain anchors)
  return h.startsWith("/") ? h : `/${h}`;
}

export function usePath() {
  const [path, setPath] = React.useState("/");
  React.useEffect(() => {
    const update = () => setPath(currentPath());
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return path;
}

export function navigate(path: string) {
  if (currentPath() === path) return;
  window.location.hash = path;
  window.scrollTo({ top: 0 });
}

export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const a = path.split("?")[0].split("/").filter(Boolean);
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}

export function Link({ href, className, children, ...rest }: Omit<React.ComponentProps<"a">, "href"> & { href: string }) {
  return (
    <a href={`#${href}`} className={cn(className)} {...rest}>
      {children}
    </a>
  );
}
