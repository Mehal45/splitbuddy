// Loads everything the signed-in person may see (row-level security decides)
// and shapes it like the demo database, so every screen works unchanged.

import type { SupabaseClient } from "@supabase/supabase-js";
import { DB_VERSION } from "../seed";
import type {
  Attachment, AuditEntry, Customer, CylinderSize, DB, Delivery, Driver, Expense, Invoice, LoadSheet, Movement, Order, Payment, Plant,
  Reconciliation, Settings, Truck, User,
} from "../types";

type Row = Record<string, unknown>;
const n = (v: unknown) => (v == null ? 0 : Number(v));
const s = (v: unknown) => (v == null ? "" : String(v));
const opt = (v: unknown) => (v == null ? undefined : String(v));
const day = (v: unknown) => s(v).slice(0, 10);

async function all(sb: SupabaseClient, table: string, order = "id", limit = 50_000): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < limit; from += 1000) {
    const { data, error } = await sb.from(table).select("*").order(order, { ascending: true }).range(from, from + 999);
    if (error) throw error;
    out.push(...(data as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function loadAll(sb: SupabaseClient): Promise<DB> {
  const [settingsRows, sizes, plants, trucks, drivers, customers, profiles, movements, loads, deliveries, invoices, attachments, payments, recs, expenses, orders, audit] =
    await Promise.all([
      all(sb, "settings"), all(sb, "sizes", "sort"), all(sb, "plants"), all(sb, "trucks", "created_at"), all(sb, "drivers"), all(sb, "customers", "code"),
      all(sb, "profiles", "created_at"), all(sb, "movements", "id", 500_000), all(sb, "load_sheets", "ts"), all(sb, "deliveries", "ts"), all(sb, "invoices", "ts"),
      all(sb, "attachments", "ts"), all(sb, "payments", "ts"), all(sb, "reconciliations", "ts"), all(sb, "expenses", "ts"), all(sb, "orders", "ts"),
      sb.from("audit_log").select("*").order("id", { ascending: false }).limit(3000).then(({ data, error }) => { if (error) throw error; return ((data ?? []) as Row[]).reverse(); }),
    ]);

  const st = settingsRows[0] ?? {};
  const settings: Settings = {
    agencyName: s(st.agency_name) || "Anmol Gas Agency",
    agencyTagline: s(st.agency_tagline),
    agencyGstin: s(st.agency_gstin),
    agencyAddress: s(st.agency_address),
    homeState: s(st.home_state) || "Karnataka",
    hsnCode: s(st.hsn_code) || "2711",
    pendingApprovalHours: n(st.pending_approval_hours) || 10,
    emptiesTolerance: n(st.empties_tolerance),
    gpsMaxDistanceKm: n(st.gps_max_distance_km) || 0.5,
    approvalDefaultV2: true,
    sizes: sizes.map((z): CylinderSize => ({
      id: s(z.id), label: s(z.label), kg: n(z.kg),
      domesticPrice: z.domestic_price == null ? null : n(z.domestic_price),
      commercialPrice: z.commercial_price == null ? null : n(z.commercial_price),
      purchasePrice: n(z.purchase_price), purchaseGst: n(z.purchase_gst), lowStockThreshold: n(z.low_stock_threshold), active: Boolean(z.active),
    })),
  };

  const filesFor = (type: string, id: string): Attachment[] | undefined => {
    const list = attachments.filter((a) => a.owner_type === type && a.owner_id === id).map((a): Attachment => ({
      id: s(a.id), name: s(a.name), kind: a.kind === "pdf" ? "pdf" : "image", dataUrl: "", path: s(a.path), bytes: n(a.bytes), uploadedBy: s(a.uploaded_by), ts: s(a.ts),
    }));
    return list.length ? list : undefined;
  };

  return {
    version: DB_VERSION,
    seededAt: new Date().toISOString(),
    sample: false,
    settings,
    users: profiles.map((p): User => ({
      id: s(p.id), name: s(p.name), role: p.role as User["role"], phone: s(p.phone), driverId: opt(p.driver_id), customerId: opt(p.customer_id), manager: Boolean(p.manager), active: p.active !== false,
    })),
    drivers: drivers.map((d): Driver => ({ id: s(d.id), name: s(d.name), phone: s(d.phone), licenseNo: s(d.license_no), truckId: s(d.truck_id) })),
    trucks: trucks.map((t): Truck => ({ id: s(t.id), regNo: s(t.reg_no), model: s(t.model), capacity: n(t.capacity) })),
    customers: customers.map((c): Customer => ({
      id: s(c.id), code: s(c.code), name: s(c.name), businessName: s(c.business_name), type: c.type === "domestic" ? "domestic" : "commercial",
      category: s(c.category), gstin: s(c.gstin), phone: s(c.phone), address: s(c.address), area: s(c.area), state: s(c.state),
      lat: n(c.lat), lng: n(c.lng), creditLimit: n(c.credit_limit), depositCylinders: (c.deposit_cylinders ?? {}) as Record<string, number>,
      depositAmount: n(c.deposit_amount), paymentMode: c.payment_mode === "credit" ? "credit" : "cod",
      openingOutstanding: n(c.opening_outstanding), openingEmpties: (c.opening_empties ?? {}) as Record<string, number>,
    })),
    plants: plants.map((p): Plant => ({ id: s(p.id), name: s(p.name), gstin: s(p.gstin), state: s(p.state) })),
    movements: movements.map((m): Movement => ({
      id: s(m.id), ts: s(m.ts), userId: s(m.user_id), from: s(m.from_loc), to: s(m.to_loc), size: s(m.size), state: m.state as Movement["state"],
      toState: (m.to_state ?? undefined) as Movement["toState"], qty: n(m.qty), refType: m.ref_type as Movement["refType"], refId: opt(m.ref_id), note: opt(m.note),
    })),
    loadSheets: loads.map((l): LoadSheet => ({ id: s(l.id), no: s(l.no), date: day(l.date), ts: s(l.ts), truckId: s(l.truck_id), driverId: s(l.driver_id), lines: l.lines as LoadSheet["lines"], createdBy: s(l.created_by) })),
    deliveries: deliveries.map((d): Delivery => ({
      id: s(d.id), no: s(d.no), date: day(d.date), ts: s(d.ts), truckId: s(d.truck_id), driverId: s(d.driver_id), customerId: s(d.customer_id),
      full: (d.full ?? {}) as Delivery["full"], empty: (d.empty ?? {}) as Delivery["empty"], payment: (d.payment ?? null) as Delivery["payment"],
      photo: s(d.photo), gps: d.gps as Delivery["gps"], status: d.status as Delivery["status"], rejectReason: opt(d.reject_reason),
      reviewedBy: opt(d.reviewed_by), reviewedAt: opt(d.reviewed_at), invoiceId: opt(d.invoice_id),
    })),
    invoices: invoices.map((i): Invoice => ({
      id: s(i.id), no: s(i.no), kind: i.kind === "purchase" ? "purchase" : "sale", date: day(i.date), ts: s(i.ts), partyId: s(i.party_id), partyName: s(i.party_name),
      partyGstin: s(i.party_gstin), placeOfSupply: s(i.place_of_supply), interstate: Boolean(i.interstate), lines: i.lines as Invoice["lines"],
      taxable: n(i.taxable), cgst: n(i.cgst), sgst: n(i.sgst), igst: n(i.igst), total: n(i.total), source: "app", deliveryId: opt(i.delivery_id),
      attachments: filesFor("invoice", s(i.id)),
    })),
    payments: payments.map((p): Payment => ({ id: s(p.id), customerId: s(p.customer_id), date: day(p.date), ts: s(p.ts), amount: n(p.amount), mode: p.mode as Payment["mode"], ref: opt(p.ref), deliveryId: opt(p.delivery_id), source: "app" })),
    reconciliations: recs.map((r): Reconciliation => ({ id: s(r.id), date: day(r.date), ts: s(r.ts), truckId: s(r.truck_id), driverId: s(r.driver_id), expected: r.expected as Reconciliation["expected"], actual: r.actual as Reconciliation["actual"], mismatch: Boolean(r.mismatch), by: s(r.by) })),
    expenses: expenses.map((e): Expense => ({
      id: s(e.id), no: s(e.no), date: day(e.date), ts: s(e.ts), category: e.category as Expense["category"], amount: n(e.amount), mode: e.mode as Expense["mode"],
      paidTo: s(e.paid_to), note: s(e.note), truckId: opt(e.truck_id), by: s(e.by), attachments: filesFor("expense", s(e.id)),
    })),
    orders: orders.map((o): Order => ({
      id: s(o.id), no: s(o.no), ts: s(o.ts), customerId: s(o.customer_id), lines: o.lines as Order["lines"], wantedDate: day(o.wanted_date), slot: o.slot as Order["slot"],
      note: s(o.note), status: o.status as Order["status"], placedBy: s(o.placed_by), handledBy: opt(o.handled_by), handledAt: opt(o.handled_at), reason: opt(o.reason), deliveryId: opt(o.delivery_id),
    })),
    audit: audit.map((a): AuditEntry => ({ id: s(a.id), ts: s(a.ts), userId: s(a.user_id), action: a.action as AuditEntry["action"], detail: s(a.detail) })),
    syncLog: [],
    lastSyncedAt: null,
    counters: {},
  };
}
