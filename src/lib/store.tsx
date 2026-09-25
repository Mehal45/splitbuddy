"use client";

// Client-side "database": the whole DB lives in React state and is mirrored to
// localStorage after every action, so demo actions survive a refresh.

import * as React from "react";
import { toast } from "sonner";
import { computeStock, type StockMap } from "./engine";
import { buildSeed, DB_VERSION } from "./seed";
import { computeAlerts, customerBalances, type Alert, type CustomerBalance } from "./selectors";
import type { DB, Role, User } from "./types";

const DB_KEY = "anmol-gas-demo:db";
const SESSION_KEY = "anmol-gas-demo:session";

export interface Session {
  userId: string; // who logged in
  viewAsUserId?: string; // owner previewing another role
  remember?: boolean; // "Keep me signed in": localStorage, otherwise only this browser session
}

function readSession(): Session | null {
  const saved = readJSON<Session>(SESSION_KEY);
  if (saved) return saved;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function writeSession(s: Session | null) {
  const keep = s?.remember !== false;
  writeJSON(SESSION_KEY, s && keep ? s : null);
  try {
    if (s && !keep) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch { /* storage blocked: session lives in memory only */ }
}

interface StoreValue {
  db: DB;
  stock: StockMap;
  balances: Record<string, CustomerBalance>;
  alerts: Alert[];
  now: number;
  act: (fn: (draft: DB) => void, success?: string) => boolean;
  resetDemo: () => void;
  session: Session | null;
  login: (userId: string, remember?: boolean) => void;
  logout: () => void;
  viewAs: (userId: string | undefined) => void;
  realUser: User | null;
  user: User | null; // effective user (after "view as")
  role: Role | null;
}

const StoreCtx = React.createContext<StoreValue | null>(null);

// Latest committed DB, read by actions (kept outside React state so rapid
// consecutive actions never work on a stale copy).
let currentDb: DB | null = null;

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function loadDB(): DB {
  const saved = readJSON<DB>(DB_KEY);
  if (saved && saved.version === DB_VERSION) return saved;
  const fresh = buildSeed();
  writeJSON(DB_KEY, fresh);
  return fresh;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = React.useState<DB | null>(null);
  const [session, setSession] = React.useState<Session | null>(null);
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const loaded = loadDB();
    currentDb = loaded;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from localStorage once on mount
    setDb(loaded);
    setSession(readSession());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const act = React.useCallback((fn: (draft: DB) => void, success?: string) => {
    const current = currentDb;
    if (!current) return false;
    const draft = structuredClone(current);
    try {
      fn(draft);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      return false;
    }
    currentDb = draft;
    setDb(draft);
    setNow(Date.now());
    if (!writeJSON(DB_KEY, draft)) {
      toast.warning("Saved for this session only: browser storage is full (try a smaller photo or reset demo data).");
    } else if (success) {
      toast.success(success);
    }
    return true;
  }, []);

  const resetDemo = React.useCallback(() => {
    const fresh = buildSeed();
    currentDb = fresh;
    setDb(fresh);
    setNow(Date.now());
    writeJSON(DB_KEY, fresh);
    toast.success("Demo data reset to a fresh 60-day history");
  }, []);

  const saveSession = React.useCallback((s: Session | null) => {
    setSession(s);
    writeSession(s);
  }, []);

  const value = React.useMemo<StoreValue | null>(() => {
    if (!db) return null;
    const stock = computeStock(db.movements);
    const balances = customerBalances(db);
    const alerts = computeAlerts(db, stock, balances, now);
    const realUser = session ? db.users.find((u) => u.id === session.userId) ?? null : null;
    const viewed = realUser?.role === "owner" && session?.viewAsUserId ? db.users.find((u) => u.id === session.viewAsUserId) ?? null : null;
    const user = viewed ?? realUser;
    return {
      db, stock, balances, alerts, now, act, resetDemo, session,
      login: (userId, remember = true) => saveSession({ userId, remember }),
      logout: () => saveSession(null),
      viewAs: (userId) => session && saveSession({ ...session, viewAsUserId: userId }),
      realUser, user, role: user?.role ?? null,
    };
  }, [db, session, now, act, resetDemo, saveSession]);

  if (!value) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm">Loading demo data…</p>
        </div>
      </div>
    );
  }
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const v = React.useContext(StoreCtx);
  if (!v) throw new Error("useStore outside StoreProvider");
  return v;
}

// Lookup helpers
export function useLookups() {
  const { db } = useStore();
  return React.useMemo(() => {
    const customer = new Map(db.customers.map((c) => [c.id, c]));
    const driver = new Map(db.drivers.map((d) => [d.id, d]));
    const truck = new Map(db.trucks.map((t) => [t.id, t]));
    const user = new Map(db.users.map((u) => [u.id, u]));
    const size = new Map(db.settings.sizes.map((s) => [s.id, s]));
    return { customer, driver, truck, user, size };
  }, [db]);
}
