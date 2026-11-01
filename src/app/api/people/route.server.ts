// Creates and manages logins. Only the owner may call it. Runs on the server with the
// Supabase service-role key (env SUPABASE_SERVICE_ROLE_KEY), which never reaches a browser.

import { createClient } from "@supabase/supabase-js";

const PHONE_DOMAIN = "phone.anmolgas.app";
const REG_RE = /^[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{0,3}[ -]?\d{1,4}$/;
const digits10 = (p: string) => String(p ?? "").replace(/\D/g, "").slice(-10);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const bad = (error: string, status = 400) => json({ error }, status);
const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return bad("The server isn't set up yet (missing Supabase keys).", 500);
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return bad("Please sign in again.", 401);
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  // Who is asking? Must be an active owner.
  const { data: who } = await admin.auth.getUser(token);
  if (!who.user) return bad("Please sign in again.", 401);
  const { data: me } = await admin.from("profiles").select("id, role, active").eq("id", who.user.id).maybeSingle();
  if (!me || me.role !== "owner" || !me.active) return bad("Only the owner can manage logins.", 403);

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return bad("Invalid request."); }
  const password = String(body.password ?? "");
  if (body.kind !== "password" && (password.length < 8 || password.length > 72)) return bad("Password must be 8 to 72 characters.");
  const audit = (action: string, detail: string) => admin.from("audit_log").insert({ user_id: me.id, action, detail: detail.slice(0, 300) });

  // Makes the sign-in account for a phone number; returns its id or an error message.
  const makeLogin = async (phone: string): Promise<{ id?: string; error?: string }> => {
    const p = digits10(phone);
    if (!/^[6-9]\d{9}$/.test(p)) return { error: "Phone must be a 10-digit Indian mobile number." };
    const { data: taken } = await admin.from("profiles").select("id").like("phone", `%${p.slice(-4)}`);
    if (taken?.length) {
      const { data: rows } = await admin.from("profiles").select("phone").in("id", taken.map((t) => t.id));
      if (rows?.some((r) => digits10(r.phone) === p)) return { error: "This phone number already has a login." };
    }
    const { data, error } = await admin.auth.admin.createUser({ email: `${p}@${PHONE_DOMAIN}`, password, email_confirm: true });
    if (error || !data.user) return { error: /already/i.test(error?.message ?? "") ? "This phone number already has a login." : "Couldn't create the login." };
    return { id: data.user.id };
  };
  const undo = (id?: string) => (id ? admin.auth.admin.deleteUser(id) : null);

  if (body.kind === "staff") {
    const name = text(body.name, 80);
    if (!name) return bad("Name is required.");
    const login = await makeLogin(String(body.phone));
    if (login.error) return bad(login.error);
    const { error } = await admin.from("profiles").insert({ id: login.id, name, role: "warehouse", phone: text(body.phone, 20), manager: Boolean(body.manager) });
    if (error) { await undo(login.id); return bad("Couldn't save the staff member."); }
    await audit("team_changed", `Added warehouse ${body.manager ? "manager" : "staff"} ${name}`);
    return json({ ok: true });
  }

  if (body.kind === "truck") {
    const regNo = text(body.regNo, 20).toUpperCase().replace(/\s+/g, "-");
    const capacity = Number(body.capacity);
    const driverName = text(body.driverName, 80);
    if (!REG_RE.test(regNo)) return bad("Truck number should look like KA-01-AB-1234.");
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) return bad("Capacity must be 1 to 1,000 cylinders.");
    if (!driverName) return bad("Driver name is required.");
    const login = await makeLogin(String(body.phone));
    if (login.error) return bad(login.error);
    const { data: truck, error: tErr } = await admin.from("trucks").insert({ reg_no: regNo, model: text(body.model, 40) || "Truck", capacity }).select("id").single();
    if (tErr || !truck) { await undo(login.id); return bad(/duplicate/i.test(tErr?.message ?? "") ? "A truck with this number already exists." : "Couldn't save the truck."); }
    const { data: driver, error: dErr } = await admin.from("drivers").insert({ name: driverName, phone: text(body.phone, 20), license_no: text(body.licenseNo, 30).toUpperCase(), truck_id: truck.id }).select("id").single();
    const { error: pErr } = driver ? await admin.from("profiles").insert({ id: login.id, name: driverName, role: "driver", phone: text(body.phone, 20), driver_id: driver.id }) : { error: dErr };
    if (dErr || pErr) {
      await undo(login.id);
      if (driver) await admin.from("drivers").delete().eq("id", driver.id);
      await admin.from("trucks").delete().eq("id", truck.id);
      return bad("Couldn't save the driver.");
    }
    await audit("team_changed", `Added truck ${regNo} with driver ${driverName}`);
    return json({ ok: true });
  }

  if (body.kind === "customer") {
    const { data: c } = await admin.from("customers").select("id, name, phone").eq("id", String(body.customerId)).maybeSingle();
    if (!c) return bad("Customer not found.");
    const { data: has } = await admin.from("profiles").select("id").eq("customer_id", c.id).maybeSingle();
    if (has) return bad("This customer already has a login.");
    const login = await makeLogin(c.phone);
    if (login.error) return bad(login.error);
    const { error } = await admin.from("profiles").insert({ id: login.id, name: c.name, role: "customer", phone: c.phone, customer_id: c.id });
    if (error) { await undo(login.id); return bad("Couldn't create the customer's login."); }
    await audit("team_changed", `Created app login for customer ${c.name}`);
    return json({ ok: true });
  }

  if (body.kind === "password") {
    if (password.length < 8 || password.length > 72) return bad("Password must be 8 to 72 characters.");
    const { data: target } = await admin.from("profiles").select("id, name, role").eq("id", String(body.userId)).maybeSingle();
    if (!target) return bad("Login not found.");
    const { error } = await admin.auth.admin.updateUserById(target.id, { password });
    if (error) return bad("Couldn't change the password.");
    await audit("team_changed", `Set a new password for ${target.name}`);
    return json({ ok: true });
  }

  return bad("Unknown request.");
}
