import type { Role } from "./types";

// Each group signs in on its own page; the root page is the owner's (PIN protected).
export const LOGIN_PATH: Record<Role, string> = { owner: "/", warehouse: "/staff", driver: "/driver", customer: "/customer" };
export const LOGIN_PAGES = ["/staff", "/driver", "/customer"];

export const DEFAULT_OWNER_PIN = "1234";

// "Keep me signed in" lasts 30 days; otherwise the login ends when the tab
// closes, and at most after 12 hours.
export const REMEMBER_MS = 30 * 24 * 36e5;
export const SESSION_MS = 12 * 36e5;

export const digitsOnly = (s: string) => s.replace(/\D/g, "");
// Last 10 digits of an Indian mobile number, so "+91 98450 12345" == "9845012345"
export const normalizePhone = (s: string) => digitsOnly(s).slice(-10);
export const isValidMobile = (s: string) => /^[6-9]\d{9}$/.test(normalizePhone(s));

// ---------- attempt limiting ----------
// After 5 wrong tries the form locks for 30 s, doubling each time up to 15 min.
// This is a speed bump in a browser-only demo; the real system must enforce it
// on the server (see SECURITY.md).

const FREE_TRIES = 5;
const BASE_LOCK_MS = 30_000;
const MAX_LOCK_MS = 15 * 60_000;

interface LockState { fails: number; lockedUntil: number; lockouts: number }
const key = (scope: string) => `anmol-gas-demo:attempts:${scope}`;

function read(scope: string): LockState {
  try {
    const raw = localStorage.getItem(key(scope));
    const v = raw ? (JSON.parse(raw) as LockState) : null;
    if (v && typeof v.fails === "number" && typeof v.lockedUntil === "number") return { ...v, lockouts: v.lockouts ?? 0 };
  } catch { /* storage blocked */ }
  return { fails: 0, lockedUntil: 0, lockouts: 0 };
}
function write(scope: string, v: LockState | null) {
  try {
    if (v) localStorage.setItem(key(scope), JSON.stringify(v));
    else localStorage.removeItem(key(scope));
  } catch { /* storage blocked */ }
}

/** Milliseconds left on a lock, 0 if the user may try. */
export function lockRemaining(scope: string, now = Date.now()) {
  return Math.max(0, read(scope).lockedUntil - now);
}

/** Record a wrong attempt; returns tries left before a lock (0 = just locked). */
export function recordFailure(scope: string, now = Date.now()) {
  const s = read(scope);
  s.fails += 1;
  if (s.fails >= FREE_TRIES) {
    s.lockedUntil = now + Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** s.lockouts);
    s.lockouts += 1;
    s.fails = 0;
    write(scope, s);
    return 0;
  }
  write(scope, s);
  return FREE_TRIES - s.fails;
}

export function clearFailures(scope: string) {
  write(scope, null);
}

export function formatWait(ms: number) {
  const s = Math.ceil(ms / 1000);
  return s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} s`;
}
