// Business logic. Every function mutates the DB passed in (the store hands in a
// fresh clone) so the same code builds the 60 day seed history and powers the UI.

import { computeTotals } from "./gst";
import { dayKey } from "./format";
import type {
  CylState, Customer, DB, Delivery, GeoPoint, Invoice, InvoiceLine, LocationKey, Movement, SizeQty,
} from "./types";

export const WH = "WH";
export const PLANT = "PLANT";
export const LOSS = "LOSS";
export const truckLoc = (id: string) => `TRUCK:${id}`;
export const custLoc = (id: string) => `CUST:${id}`;

export function nextId(db: DB, prefix: string) {
  db.counters[prefix] = (db.counters[prefix] ?? 0) + 1;
  return `${prefix}${db.counters[prefix]}`;
}

function fyOf(date: string) {
  const [y, m] = date.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

export function nextNo(db: DB, series: string, date: string) {
  const key = `no:${series}:${fyOf(date)}`;
  db.counters[key] = (db.counters[key] ?? 0) + 1;
  return `${series}/${fyOf(date)}/${String(db.counters[key]).padStart(5, "0")}`;
}

export function move(db: DB, m: Omit<Movement, "id">) {
  if (m.qty <= 0) return;
  db.movements.push({ id: nextId(db, "m"), ...m });
}

export const sizeById = (db: DB, id: string) => db.settings.sizes.find((s) => s.id === id);

export function priceFor(db: DB, sizeId: string, type: Customer["type"]) {
  const s = sizeById(db, sizeId);
  if (!s) return 0;
  return (type === "domestic" ? s.domesticPrice ?? s.commercialPrice : s.commercialPrice ?? s.domesticPrice) ?? 0;
}
export const gstFor = (type: Customer["type"]) => (type === "domestic" ? 5 : 18);

// ---------- stock ----------

export type StockMap = Record<LocationKey, Record<string, Record<CylState, number>>>;

const blank = (): Record<CylState, number> => ({ full: 0, empty: 0, defective: 0, testing: 0 });

export function computeStock(movements: Movement[], upTo?: string): StockMap {
  const s: StockMap = {};
  const bump = (loc: string, size: string, st: CylState, q: number) => {
    const l = (s[loc] ??= {});
    const z = (l[size] ??= blank());
    z[st] += q;
  };
  for (const m of movements) {
    if (upTo && m.ts > upTo) continue;
    bump(m.from, m.size, m.state, -m.qty);
    bump(m.to, m.size, m.toState ?? m.state, m.qty);
  }
  return s;
}

export function locQty(stock: StockMap, loc: string, size: string, state: CylState) {
  return stock[loc]?.[size]?.[state] ?? 0;
}

// ---------- load sheet ----------

export function createLoadSheet(db: DB, a: { date: string; ts: string; truckId: string; driverId: string; lines: SizeQty; userId: string }) {
  const id = nextId(db, "ls");
  const no = nextNo(db, "LS", a.date);
  db.loadSheets.push({ id, no, date: a.date, ts: a.ts, truckId: a.truckId, driverId: a.driverId, lines: a.lines, createdBy: a.userId });
  for (const [size, qty] of Object.entries(a.lines)) {
    move(db, { ts: a.ts, userId: a.userId, from: WH, to: truckLoc(a.truckId), size, state: "full", qty, refType: "load", refId: id });
  }
  return id;
}

// ---------- delivery ----------

export function submitDelivery(db: DB, a: {
  ts: string; truckId: string; driverId: string; customerId: string; full: SizeQty; empty: SizeQty;
  payment: Delivery["payment"]; photo: string; gps: GeoPoint; userId: string;
}) {
  const id = nextId(db, "d");
  const date = dayKey(a.ts);
  const d: Delivery = {
    id, no: nextNo(db, "DL", date), date, ts: a.ts, truckId: a.truckId, driverId: a.driverId, customerId: a.customerId,
    full: a.full, empty: a.empty, payment: a.payment, photo: a.photo, gps: a.gps, status: "pending",
  };
  db.deliveries.push(d);
  // Physical movement happens at the doorstep; the customer's balance and dues
  // only change once the acknowledgement is approved.
  for (const [size, q] of Object.entries(a.full)) move(db, { ts: a.ts, userId: a.userId, from: truckLoc(a.truckId), to: custLoc(a.customerId), size, state: "full", qty: q, refType: "delivery", refId: id });
  for (const [size, q] of Object.entries(a.empty)) move(db, { ts: a.ts, userId: a.userId, from: custLoc(a.customerId), to: truckLoc(a.truckId), size, state: "empty", qty: q, refType: "delivery", refId: id });
  return d;
}

export function createSaleInvoice(db: DB, a: {
  customerId: string; date: string; ts: string; full: SizeQty; empty: SizeQty; source: Invoice["source"]; deliveryId?: string;
}) {
  const c = db.customers.find((x) => x.id === a.customerId)!;
  const sizes = new Set([...Object.keys(a.full), ...Object.keys(a.empty)]);
  const lines: InvoiceLine[] = [];
  for (const size of sizes) {
    const qty = a.full[size] ?? 0;
    const emptiesReturned = a.empty[size] ?? 0;
    if (!qty && !emptiesReturned) continue;
    lines.push({ size, qty, emptiesReturned, rate: priceFor(db, size, c.type), gstRate: gstFor(c.type) });
  }
  const interstate = c.state !== db.settings.homeState;
  const inv: Invoice = {
    id: nextId(db, "inv"), no: nextNo(db, "AGA", a.date), kind: "sale", date: a.date, ts: a.ts,
    partyId: c.id, partyName: c.businessName || c.name, partyGstin: c.gstin, placeOfSupply: c.state, interstate,
    lines, ...computeTotals(lines, interstate), source: a.source, deliveryId: a.deliveryId,
  };
  db.invoices.push(inv);
  return inv;
}

export function approveDelivery(db: DB, id: string, userId: string, ts: string) {
  const d = db.deliveries.find((x) => x.id === id);
  if (!d || d.status !== "pending") return;
  d.status = "approved";
  d.reviewedBy = userId;
  d.reviewedAt = ts;
  const inv = createSaleInvoice(db, { customerId: d.customerId, date: d.date, ts: d.ts, full: d.full, empty: d.empty, source: "app", deliveryId: d.id });
  d.invoiceId = inv.id;
  if (d.payment && d.payment.amount > 0) {
    db.payments.push({ id: nextId(db, "p"), customerId: d.customerId, date: d.date, ts: d.ts, amount: d.payment.amount, mode: d.payment.mode, deliveryId: d.id, source: "app", ref: d.no });
  }
}

export function rejectDelivery(db: DB, id: string, userId: string, reason: string, ts: string) {
  const d = db.deliveries.find((x) => x.id === id);
  if (!d || d.status !== "pending") return;
  d.status = "rejected";
  d.rejectReason = reason;
  d.reviewedBy = userId;
  d.reviewedAt = ts;
  // Undo the doorstep movement so stock stays correct.
  for (const [size, q] of Object.entries(d.full)) move(db, { ts, userId, from: custLoc(d.customerId), to: truckLoc(d.truckId), size, state: "full", qty: q, refType: "reversal", refId: id, note: `Rejected: ${reason}` });
  for (const [size, q] of Object.entries(d.empty)) move(db, { ts, userId, from: truckLoc(d.truckId), to: custLoc(d.customerId), size, state: "empty", qty: q, refType: "reversal", refId: id, note: `Rejected: ${reason}` });
}

// ---------- end of day ----------

export function truckExpected(db: DB, stock: StockMap, truckId: string) {
  const out: Record<string, { full: number; empty: number }> = {};
  for (const s of db.settings.sizes) {
    out[s.id] = { full: locQty(stock, truckLoc(truckId), s.id, "full"), empty: locQty(stock, truckLoc(truckId), s.id, "empty") };
  }
  return out;
}

export function reconcileTruck(db: DB, a: { date: string; ts: string; truckId: string; driverId: string; actual: Record<string, { full: number; empty: number }>; userId: string }) {
  const stock = computeStock(db.movements);
  const expected = truckExpected(db, stock, a.truckId);
  let mismatch = false;
  const id = nextId(db, "rc");
  for (const [size, exp] of Object.entries(expected)) {
    const act = a.actual[size] ?? { full: 0, empty: 0 };
    for (const st of ["full", "empty"] as const) {
      const e = exp[st], x = act[st];
      if (e !== x) mismatch = true;
      move(db, { ts: a.ts, userId: a.userId, from: truckLoc(a.truckId), to: WH, size, state: st, qty: Math.min(e, x), refType: "return", refId: id });
      if (e > x) move(db, { ts: a.ts, userId: a.userId, from: truckLoc(a.truckId), to: LOSS, size, state: st, qty: e - x, refType: "return", refId: id, note: "Shortage at end of day" });
      if (x > e) move(db, { ts: a.ts, userId: a.userId, from: LOSS, to: WH, size, state: st, qty: x - e, refType: "return", refId: id, note: "Excess at end of day" });
    }
  }
  db.reconciliations.push({ id, date: a.date, ts: a.ts, truckId: a.truckId, driverId: a.driverId, expected, actual: a.actual, mismatch, by: a.userId });
  return id;
}

// ---------- purchases ----------

export function createPurchase(db: DB, a: {
  date: string; ts: string; plantId: string; full: SizeQty; emptiesBack: SizeQty; defectiveBack?: SizeQty; testingBack?: SizeQty;
  userId: string; source: Invoice["source"];
}) {
  const plant = db.plants.find((p) => p.id === a.plantId)!;
  const interstate = plant.state !== db.settings.homeState;
  const lines: InvoiceLine[] = [];
  const sizes = new Set([...Object.keys(a.full), ...Object.keys(a.emptiesBack)]);
  for (const size of sizes) {
    const s = sizeById(db, size);
    if (!s) continue;
    const qty = a.full[size] ?? 0;
    const back = a.emptiesBack[size] ?? 0;
    if (!qty && !back) continue;
    lines.push({ size, qty, emptiesReturned: back, rate: s.purchasePrice, gstRate: s.purchaseGst });
  }
  const id = nextId(db, "inv");
  const inv: Invoice = {
    id, no: `${plant.id === "pl2" ? "HSR" : "BPC"}/${fyOf(a.date)}/${String(40000 + (db.counters["pur"] = (db.counters["pur"] ?? 0) + 1))}`,
    kind: "purchase", date: a.date, ts: a.ts, partyId: plant.id, partyName: plant.name, partyGstin: plant.gstin,
    placeOfSupply: db.settings.homeState, interstate, lines, ...computeTotals(lines, interstate), source: a.source,
  };
  db.invoices.push(inv);
  const m = (size: string, from: string, to: string, state: CylState, qty: number) =>
    move(db, { ts: a.ts, userId: a.userId, from, to, size, state, qty, refType: a.source === "tally" ? "tally" : "purchase", refId: id });
  for (const [size, q] of Object.entries(a.full)) m(size, PLANT, WH, "full", q);
  for (const [size, q] of Object.entries(a.emptiesBack)) m(size, WH, PLANT, "empty", q);
  for (const [size, q] of Object.entries(a.defectiveBack ?? {})) m(size, WH, PLANT, "defective", q);
  for (const [size, q] of Object.entries(a.testingBack ?? {})) m(size, WH, PLANT, "testing", q);
  return inv;
}

export function recordPayment(db: DB, a: { customerId: string; date: string; ts: string; amount: number; mode: "cash" | "upi" | "cheque" | "neft"; ref?: string; source: "app" | "tally" | "seed" }) {
  db.payments.push({ id: nextId(db, "p"), ...a });
}

export function changeState(db: DB, a: { ts: string; size: string; from: CylState; to: CylState; qty: number; userId: string; note?: string }) {
  move(db, { ts: a.ts, userId: a.userId, from: WH, to: WH, size: a.size, state: a.from, toState: a.to, qty: a.qty, refType: "adjust", note: a.note });
}
