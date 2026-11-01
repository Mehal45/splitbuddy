"use client";

// Client-side "database": the whole DB lives in React state and is mirrored to
// localStorage after every action, so demo actions survive a refresh.

import * as React from "react";
import { toast } from "sonner";
import { REMEMBER_MS, SESSION_MS } from "./auth";
import { computeStock, logAudit, type StockMap } from "./engine";
import { buildEmpty, buildSeed, DB_VERSION } from "./seed";
import { computeAlerts, customerBalances, type Alert, type CustomerBalance } from "./selectors";
import type { AuditAction, DB, Role, User } from "./types";

const DB_KEY = "anmol-gas-demo:db";
const SESSION_KEY = "anmol-gas-demo:session";

export interface Session {
  userId: string; // who logged in
  viewAsUserId?: string; // owner previewing another role
  remember?: boolean; // "Keep me signed in": localStorage, otherwise only this browser session
  expiresAt?: number; // epoch ms; expired sessions are ignored
}

function validSession(v: unknown): Session | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Session;
  if (typeof s.userId !== "string") return null;
  if (typeof s.expiresAt !== "number" || s.expiresAt < Date.now()) return null;
  return s;
}

function readSession(): Session | null {
  const saved = validSession(readJSON<Session>(SESSION_KEY));
  if (saved) return saved;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return validSession(raw ? JSON.parse(raw) : null);
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
  clearAll: (actorId: string) => void;
  loadSample: (actorId: string) => void;
  session: Session | null;
  login: (userId: string, remember?: boolean) => void;
  logout: () => void;
  logEvent: (userId: string, action: AuditAction, detail: string) => void;
  viewAs: (userId: string | undefined) => void;
  realUser: User | null;
  user: User | null; // effective user (after "view as")
  role: Role | null;
}

const StoreCtx = React.createContext<StoreValue | null>(null);

// Latest committed DB, read by actions (kept outside React state so rapid
// consecutive actions never work on a stale copy).
let currentDb: DB | null = null;
let lastRaw: string | null = null; // exact text last read from / written to storage

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

function writeDb(d: DB) {
  try { const raw = JSON.stringify(d); localStorage.setItem(DB_KEY, raw); lastRaw = raw; return true; } catch { return false; }
}

// Stored data can be edited, damaged or from an older version. Anything that
// doesn't look like our database is replaced instead of crashing the app.
function looksValid(d: unknown): d is DB {
  if (!d || typeof d !== "object") return false;
  const x = d as DB;
  const arrays = [x.users, x.drivers, x.trucks, x.customers, x.plants, x.movements, x.loadSheets, x.deliveries, x.invoices, x.payments, x.reconciliations, x.syncLog];
  return x.version === DB_VERSION && arrays.every(Array.isArray)
    && !!x.settings && Array.isArray(x.settings.sizes) && x.settings.sizes.length > 0
    && typeof x.counters === "object" && x.users.some((u) => u.role === "owner");
}

// Bring data saved by an older version of the app up to date without losing anything.
function upgrade(d: DB): DB {
  if (!Array.isArray(d.expenses)) d.expenses = [];
  if (!Array.isArray(d.orders)) d.orders = [];
  // Old default was 4 hours; the default is now 10 (the owner can still change it in Settings)
  if (!d.settings.approvalDefaultV2) { if (d.settings.pendingApprovalHours === 4) d.settings.pendingApprovalHours = 10; d.settings.approvalDefaultV2 = true; }
  return d;
}

function loadDB(): { db: DB; recovered: boolean } {
  const saved = readJSON<unknown>(DB_KEY);
  if (looksValid(saved)) return { db: upgrade(saved), recovered: false };
  const fresh = buildEmpty();
  writeJSON(DB_KEY, fresh);
  return { db: fresh, recovered: saved !== null && (saved as DB)?.version === DB_VERSION };
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = React.useState<DB | null>(null);
  const [session, setSession] = React.useState<Session | null>(null);
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const { db: loaded, recovered } = loadDB();
    currentDb = loaded;
    try { lastRaw = localStorage.getItem(DB_KEY); } catch { /* storage blocked */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from localStorage once on mount
    setDb(loaded);
    const sess = readSession();
    setSession(sess && loaded.users.some((u) => u.id === sess.userId) ? sess : null);
    if (recovered) toast.warning("Saved demo data was damaged, so a fresh copy was loaded.");
    const t = setInterval(() => setNow(Date.now()), 60_000);
    // Another tab or window changed the data (e.g. a customer placed an order): show it here at once
    const onStorage = (e: StorageEvent) => {
      if (e.key !== DB_KEY || !e.newValue) return;
      try {
        const next = JSON.parse(e.newValue) as unknown;
        if (!looksValid(next)) return;
        currentDb = upgrade(next);
        lastRaw = e.newValue;
        setDb(currentDb);
        setNow(Date.now());
      } catch { /* ignore a half-written value */ }
    };
    window.addEventListener("storage", onStorage);
    return () => { clearInterval(t); window.removeEventListener("storage", onStorage); };
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
    if (!writeDb(draft)) {
      toast.warning("Saved for this session only: browser storage is full (try a smaller photo or reset demo data).");
    } else if (success) {
      toast.success(success);
    }
    return true;
  }, []);

  // Replace the whole database. The owner login and PIN always survive, so the
  // owner can never lock themselves out by clearing data.
  const replaceDb = React.useCallback((next: DB, actorId: string, detail: string, message: string) => {
    const prev = currentDb;
    if (prev) {
      next.settings.ownerPin = prev.settings.ownerPin;
      const owner = prev.users.find((u) => u.role === "owner");
      if (owner) next.users = [owner, ...next.users.filter((u) => u.role !== "owner")];
    }
    logAudit(next, actorId, "demo_reset", detail);
    currentDb = next;
    setDb(next);
    setNow(Date.now());
    writeDb(next);
    toast.success(message);
  }, []);

  const clearAll = React.useCallback((actorId: string) => {
    const empty = buildEmpty();
    // keep the agency's own setup: name, GSTIN, sizes, prices, thresholds
    if (currentDb) empty.settings = structuredClone(currentDb.settings);
    replaceDb(empty, actorId, "Cleared all data (started empty)", "All data cleared. The app is now empty.");
  }, [replaceDb]);

  const loadSample = React.useCallback((actorId: string) => {
    replaceDb(buildSeed(), actorId, "Loaded the 60-day sample data", "Sample data loaded (60 days ending today)");
  }, [replaceDb]);

  const saveSession = React.useCallback((s: Session | null) => {
    setSession(s);
    writeSession(s);
  }, []);

  const logEvent = React.useCallback((userId: string, action: AuditAction, detail: string) => {
    act((d) => logAudit(d, userId, action, detail));
  }, [act]);

  const value = React.useMemo<StoreValue | null>(() => {
    if (!db) return null;
    const stock = computeStock(db.movements);
    const balances = customerBalances(db);
    const alerts = computeAlerts(db, stock, balances, now);
    const realUser = session ? db.users.find((u) => u.id === session.userId) ?? null : null;
    const viewed = realUser?.role === "owner" && session?.viewAsUserId ? db.users.find((u) => u.id === session.viewAsUserId) ?? null : null;
    const user = viewed ?? realUser;
    return {
      db, stock, balances, alerts, now, act, clearAll, loadSample, session,
      login: (userId, remember = true) => {
        logEvent(userId, "login", remember ? "Signed in (kept signed in)" : "Signed in (this tab only)");
        saveSession({ userId, remember, expiresAt: Date.now() + (remember ? REMEMBER_MS : SESSION_MS) });
      },
      logout: () => {
        if (session) logEvent(session.userId, "logout", "Signed out");
        saveSession(null);
      },
      logEvent,
      viewAs: (userId) => {
        if (!session || realUser?.role !== "owner") return;
        if (userId) logEvent(session.userId, "view_as", `Viewed the app as ${db.users.find((u) => u.id === userId)?.name ?? userId}`);
        saveSession({ ...session, viewAsUserId: userId });
      },
      realUser, user, role: user?.role ?? null,
    };
  }, [db, session, now, act, clearAll, loadSample, saveSession, logEvent]);

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
