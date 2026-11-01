// Creating logins needs the Supabase service key, so it happens on our server
// (src/app/api/people/route.live.ts). The browser sends the owner's session token.

import type { SupabaseClient } from "@supabase/supabase-js";

export type PeopleRequest =
  | { kind: "staff"; name: string; phone: string; password: string; manager: boolean }
  | { kind: "truck"; regNo: string; model: string; capacity: number; driverName: string; phone: string; licenseNo: string; password: string }
  | { kind: "customer"; customerId: string; password: string }
  | { kind: "password"; userId: string; password: string };

export async function peopleApi(sb: SupabaseClient, body: PeopleRequest) {
  const { data } = await sb.auth.getSession();
  const res = await fetch("/api/people", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error || "Couldn't save. Please try again.");
  return json;
}

/** A readable first password the owner can pass on (they can change it after signing in). */
export function tempPassword() {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const b = new Uint32Array(10);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => abc[x % abc.length]).join("");
}
