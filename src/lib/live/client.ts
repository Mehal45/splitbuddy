// Live mode: the app talks to Supabase when these two public keys are set
// (Vercel -> Project -> Settings -> Environment Variables). Without them the
// app runs as the browser-only demo.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const LIVE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// Staff, drivers and customers sign in with their mobile number. Supabase logins
// are e-mail based, so a number becomes a private address that is never mailed.
export const PHONE_DOMAIN = "phone.anmolgas.app";
export const digits10 = (p: string) => p.replace(/\D/g, "").slice(-10);
export const loginEmail = (id: string) => (id.includes("@") ? id.trim().toLowerCase() : `${digits10(id)}@${PHONE_DOMAIN}`);

const REMEMBER_KEY = "anmol-live-remember";

/** "Keep me signed in": session in localStorage; otherwise only for this tab (sessionStorage). */
export function setRemember(on: boolean) {
  try { localStorage.setItem(REMEMBER_KEY, on ? "1" : "0"); } catch { /* storage blocked */ }
}
const remembered = () => { try { return localStorage.getItem(REMEMBER_KEY) !== "0"; } catch { return true; } };

const storage = {
  getItem: (k: string) => { try { return (remembered() ? localStorage : sessionStorage).getItem(k); } catch { return null; } },
  setItem: (k: string, v: string) => { try { (remembered() ? localStorage : sessionStorage).setItem(k, v); } catch { /* ignore */ } },
  removeItem: (k: string) => { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { /* ignore */ } },
};

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!LIVE) throw new Error("Supabase is not configured");
  client ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage, storageKey: "anmol-live-auth" },
    realtime: { params: { eventsPerSecond: 5 } },
  });
  return client;
}

/** Turns a Supabase/Postgres error into the plain message the database function raised. */
export function errorText(e: unknown): string {
  if (!e) return "Something went wrong";
  const m = (e as { message?: string }).message ?? String(e);
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "No internet connection. Please try again.";
  if (/JWT|token/i.test(m)) return "Your sign-in expired. Please sign in again.";
  if (/permission denied/i.test(m)) return "You don't have permission to do that.";
  return m.replace(/^.*?ERROR:\s*/, "");
}
