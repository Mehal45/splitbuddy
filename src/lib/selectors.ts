// Derived numbers: balances, alerts and dashboard figures. Nothing here writes.

import { computeStock, custLoc, deliveryBill, locQty, truckLoc, WH, type StockMap } from "./engine";
import { custName, dayKey, distanceKm, hoursSince, monthKey } from "./format";
import type { Customer, CylState, DB, Delivery } from "./types";

export interface CustomerBalance {
  empties: Record<string, number>; // cylinders held (full given - empties returned)
  excessEmpties: number; // above security deposit
  outstanding: number;
  totalBilled: number;
  totalPaid: number;
}

export function customerBalances(db: DB): Record<string, CustomerBalance> {
  const out: Record<string, CustomerBalance> = {};
  for (const c of db.customers) {
    out[c.id] = { empties: { ...c.openingEmpties }, excessEmpties: 0, outstanding: c.openingOutstanding, totalBilled: 0, totalPaid: 0 };
  }
  for (const inv of db.invoices) {
    if (inv.kind !== "sale") continue;
    const b = out[inv.partyId];
    if (!b) continue;
    b.totalBilled += inv.total;
    b.outstanding += inv.total;
    for (const l of inv.lines) b.empties[l.size] = (b.empties[l.size] ?? 0) + l.qty - l.emptiesReturned;
  }
  for (const p of db.payments) {
    const b = out[p.customerId];
    if (!b) continue;
    b.totalPaid += p.amount;
    b.outstanding -= p.amount;
  }
  for (const c of db.customers) {
    const b = out[c.id];
    let excess = 0;
    for (const [size, q] of Object.entries(b.empties)) excess += Math.max(0, q - (c.depositCylinders[size] ?? 0));
    b.excessEmpties = excess;
  }
  return out;
}

export type AlertKind = "lowStock" | "empties" | "credit" | "pending" | "mismatch" | "gps";
export interface Alert {
  id: string;
  kind: AlertKind;
  severity: "high" | "medium";
  title: string;
  detail: string;
  href: string;
}

export const ALERT_LABEL: Record<AlertKind, string> = {
  lowStock: "Low stock",
  empties: "Unreturned empties",
  credit: "Over credit limit",
  pending: "Approval overdue",
  mismatch: "Truck mismatch",
  gps: "GPS far from customer",
};

export function computeAlerts(db: DB, stock: StockMap, balances: Record<string, CustomerBalance>, now = Date.now()): Alert[] {
  const a: Alert[] = [];
  const s = db.settings;
  for (const size of s.sizes.filter((x) => x.active)) {
    const q = locQty(stock, WH, size.id, "full");
    if (q < size.lowStockThreshold) {
      a.push({ id: `low-${size.id}`, kind: "lowStock", severity: "high", title: `${size.label} full stock low`, detail: `${q} full at warehouse, threshold ${size.lowStockThreshold}`, href: "/stock" });
    }
  }
  for (const c of db.customers) {
    const b = balances[c.id];
    if (b.excessEmpties > s.emptiesTolerance) {
      a.push({ id: `emp-${c.id}`, kind: "empties", severity: "medium", title: `${custName(c)} owes ${b.excessEmpties} empties`, detail: `Holding more cylinders than security deposit`, href: `/customers/${c.id}` });
    }
    if (b.outstanding > c.creditLimit && c.creditLimit > 0) {
      a.push({ id: `cr-${c.id}`, kind: "credit", severity: "high", title: `${custName(c)} over credit limit`, detail: `Outstanding ₹${Math.round(b.outstanding).toLocaleString("en-IN")} vs limit ₹${c.creditLimit.toLocaleString("en-IN")}`, href: `/customers/${c.id}` });
    }
  }
  for (const d of db.deliveries) {
    if (d.status === "pending" && hoursSince(d.ts, now) > s.pendingApprovalHours) {
      const drv = db.drivers.find((x) => x.id === d.driverId);
      a.push({ id: `pend-${d.id}`, kind: "pending", severity: "medium", title: `${d.no} waiting ${Math.floor(hoursSince(d.ts, now))} h for approval`, detail: `Driver ${drv?.name ?? ""}`, href: "/approvals" });
    }
  }
  const today = dayKey(new Date(now));
  for (const r of db.reconciliations) {
    if (r.date === today && r.mismatch) {
      const t = db.trucks.find((x) => x.id === r.truckId);
      const drv = db.drivers.find((x) => x.id === r.driverId);
      a.push({ id: `mm-${r.id}`, kind: "mismatch", severity: "high", title: `Mismatch on ${t?.regNo}`, detail: `Driver ${drv?.name}: returned count differs from expected`, href: "/reconciliation" });
    }
  }
  for (const d of recentDeliveries(db, 7, now)) {
    if (d.status === "rejected") continue;
    const c = db.customers.find((x) => x.id === d.customerId);
    if (!c) continue;
    const km = distanceKm(d.gps, c);
    if (km > s.gpsMaxDistanceKm) {
      a.push({ id: `gps-${d.id}`, kind: "gps", severity: "medium", title: `${d.no} logged ${km.toFixed(1)} km from ${custName(c)}`, detail: `Delivery GPS is far from the customer's saved location`, href: "/approvals" });
    }
  }
  return a;
}

export function recentDeliveries(db: DB, days: number, now = Date.now()): Delivery[] {
  const cutoff = new Date(now - days * 864e5).toISOString();
  return db.deliveries.filter((d) => d.ts >= cutoff);
}

export function stockTotals(db: DB, stock: StockMap) {
  // per size + state, grouped as warehouse / trucks / customers
  const out: Record<"warehouse" | "trucks" | "customers" | "plant", Record<string, Record<CylState, number>>> = { warehouse: {}, trucks: {}, customers: {}, plant: {} };
  for (const size of db.settings.sizes) {
    for (const k of Object.keys(out) as (keyof typeof out)[]) out[k][size.id] = { full: 0, empty: 0, defective: 0, testing: 0 };
  }
  for (const [loc, bySize] of Object.entries(stock)) {
    const group = loc === WH ? "warehouse" : loc.startsWith("TRUCK:") ? "trucks" : loc.startsWith("CUST:") ? "customers" : loc === "PLANT" ? "plant" : null;
    if (!group) continue;
    for (const [size, st] of Object.entries(bySize)) {
      const tgt = out[group][size];
      if (!tgt) continue;
      for (const k of Object.keys(st) as CylState[]) tgt[k] += st[k];
    }
  }
  return out;
}

export function customerHeld(stock: StockMap, c: Customer, size: string) {
  const s = stock[custLoc(c.id)]?.[size];
  return s ? s.full + s.empty + s.defective + s.testing : 0;
}

export function truckStock(stock: StockMap, truckId: string, size: string) {
  return { full: locQty(stock, truckLoc(truckId), size, "full"), empty: locQty(stock, truckLoc(truckId), size, "empty") };
}

export function salesByDay(db: DB, days: number, now = Date.now()) {
  const map = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) map.set(dayKey(new Date(now - i * 864e5)), 0);
  for (const inv of db.invoices) if (inv.kind === "sale" && map.has(inv.date)) map.set(inv.date, map.get(inv.date)! + inv.total);
  return [...map.entries()].map(([date, total]) => ({ date, total: Math.round(total) }));
}

export function salesTotals(db: DB, now = Date.now()) {
  const today = dayKey(new Date(now));
  const month = monthKey(new Date(now));
  let t = 0, m = 0;
  for (const inv of db.invoices) {
    if (inv.kind !== "sale") continue;
    if (inv.date === today) t += inv.total;
    if (inv.date.startsWith(month)) m += inv.total;
  }
  return { today: t, month: m };
}

export { computeStock };

export function driverPerformance(db: DB, from: string, to: string) {
  return db.drivers.map((drv) => {
    const ds = db.deliveries.filter((d) => d.driverId === drv.id && d.date >= from && d.date <= to);
    const approved = ds.filter((d) => d.status === "approved");
    const rejected = ds.filter((d) => d.status === "rejected").length;
    const cylinders = approved.reduce((s, d) => s + Object.values(d.full).reduce((a, b) => a + b, 0), 0);
    const collected = approved.reduce((s, d) => s + (d.payment?.amount ?? 0), 0);
    const recs = db.reconciliations.filter((r) => r.driverId === drv.id && r.date >= from && r.date <= to);
    const mismatches = recs.filter((r) => r.mismatch).length;
    const gpsFar = ds.filter((d) => {
      const c = db.customers.find((x) => x.id === d.customerId);
      return c && distanceKm(d.gps, c) > db.settings.gpsMaxDistanceKm;
    }).length;
    const days = new Set(ds.map((d) => d.date)).size;
    return { driver: drv, deliveries: ds.length, approved: approved.length, rejected, cylinders, collected, trips: recs.length, mismatches, gpsFar, days, rejectRate: ds.length ? rejected / ds.length : 0 };
  });
}

export function stockFlowByDay(db: DB, days: number, now = Date.now()) {
  const map = new Map<string, { date: string; received: number; delivered: number }>();
  for (let i = days - 1; i >= 0; i--) { const k = dayKey(new Date(now - i * 864e5)); map.set(k, { date: k, received: 0, delivered: 0 }); }
  for (const m of db.movements) {
    const k = dayKey(m.ts);
    const row = map.get(k);
    if (!row || m.state !== "full") continue;
    if (m.from === "PLANT" && m.to === "WH") row.received += m.qty;
    if (m.to.startsWith("CUST:") && (m.from.startsWith("TRUCK:") || m.from === "WH")) row.delivered += m.qty;
    if (m.from.startsWith("CUST:") && m.refType === "reversal") row.delivered -= m.qty;
  }
  return [...map.values()];
}

// ---------- profit & loss (accrual basis, GST excluded) ----------
//
// Revenue from operations = sales invoices before GST (GST collected belongs to the government).
// Cost of cylinders sold   = opening stock + purchases before GST (GST paid is claimed back as
//                            input tax credit) − closing stock.
// Stock = full cylinders at the warehouse and on trucks, valued at the weighted average purchase
// cost (before GST) up to that day. Empty cylinders are returnable containers, not stock for sale.
// Gross profit − expenses = net profit / (loss) before tax. No depreciation or income tax.

export interface DayPL {
  date: string;
  revenue: number; // sales before GST
  qtySold: number;
  purchases: number; // before GST
  openingValue: number;
  closingValue: number;
  cogs: number; // opening + purchases − closing
  gross: number;
  expenses: number;
  net: number;
}

export interface PLStatement {
  from: string; to: string;
  days: DayPL[]; // newest first
  revenue: number;
  revenueBySize: { size: string; qty: number; amount: number }[];
  gstOnSales: number; // shown as a note only
  openingQty: number; openingValue: number;
  purchases: number; purchaseQty: number; gstOnPurchases: number;
  closingQty: number; closingValue: number;
  cogs: number; gross: number;
  expensesByCategory: { category: string; amount: number }[];
  expenses: number;
  net: number;
  pendingSales: number; // deliveries awaiting approval (not invoiced yet), incl GST
}

const istStart = (d: string) => new Date(`${d}T00:00:00+05:30`).toISOString();
const istEnd = (d: string) => new Date(`${d}T23:59:59.999+05:30`).toISOString();
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
const isStockLoc = (loc: string) => loc === WH || loc.startsWith("TRUCK:");

export function profitAndLoss(db: DB, from: string, to: string): PLStatement {
  const sizes = db.settings.sizes;
  // Weighted average purchase cost (before GST) per size, growing with each purchase
  const fallback: Record<string, number> = Object.fromEntries(sizes.map((z) => [z.id, z.purchasePrice / (1 + z.purchaseGst / 100)]));
  const buys = db.invoices.filter((i) => i.kind === "purchase").sort((a, b) => a.date.localeCompare(b.date) || a.ts.localeCompare(b.ts));
  const cum: Record<string, { qty: number; amt: number }> = {};
  let bi = 0;
  const avgUpTo = (date: string) => {
    while (bi < buys.length && buys[bi].date <= date) {
      for (const l of buys[bi].lines) {
        if (!l.qty) continue;
        const c = (cum[l.size] ??= { qty: 0, amt: 0 });
        c.qty += l.qty; c.amt += (l.qty * l.rate) / (1 + l.gstRate / 100);
      }
      bi++;
    }
    return (size: string) => (cum[size]?.qty ? cum[size].amt / cum[size].qty : fallback[size] ?? 0);
  };
  // Full cylinders in stock, swept through the movement log in time order
  // Opening stock entered in the app is stock the business already had, so it counts from the very start
  const at = (m: (typeof db.movements)[number]) => (m.refType === "opening" ? "" : m.ts);
  const moves = db.movements.slice().sort((a, b) => (at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : 0));
  const qty: Record<string, number> = {};
  let mi = 0;
  // Cylinders handed over on deliveries still waiting for approval are not billed yet,
  // so they stay in our stock until the delivery is approved (or come back if rejected).
  const pendingIds = new Set(db.deliveries.filter((d) => d.status === "pending").map((d) => d.id));
  const qtyUpTo = (iso: string, inclusive: boolean) => {
    while (mi < moves.length && (inclusive ? at(moves[mi]) <= iso : at(moves[mi]) < iso)) {
      const m = moves[mi++];
      if (m.refType === "delivery" && m.refId && pendingIds.has(m.refId)) continue;
      if (m.state === "full" && isStockLoc(m.from)) qty[m.size] = (qty[m.size] ?? 0) - m.qty;
      if ((m.toState ?? m.state) === "full" && isStockLoc(m.to)) qty[m.size] = (qty[m.size] ?? 0) + m.qty;
    }
    return { ...qty };
  };
  const value = (q: Record<string, number>, cost: (s: string) => number) => Object.entries(q).reduce((s, [size, n]) => s + Math.max(0, n) * cost(size), 0);
  const count = (q: Record<string, number>) => Object.values(q).reduce((s, n) => s + Math.max(0, n), 0);

  const dayBefore = new Date(Date.parse(`${from}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
  const openQ = qtyUpTo(istStart(from), false);
  const openCost = avgUpTo(dayBefore);
  let prevValue = value(openQ, openCost);
  const openingValue = prevValue, openingQty = count(openQ);

  const salesByDate = new Map<string, { amt: number; qty: number }>();
  const buysByDate = new Map<string, number>();
  const bySize = new Map<string, { qty: number; amount: number }>();
  let gstOnSales = 0, gstOnPurchases = 0, purchaseQty = 0;
  for (const inv of db.invoices) {
    if (inv.date < from || inv.date > to) continue;
    if (inv.kind === "sale") {
      const r = salesByDate.get(inv.date) ?? { amt: 0, qty: 0 };
      r.amt += inv.taxable; r.qty += inv.lines.reduce((n, l) => n + l.qty, 0);
      salesByDate.set(inv.date, r);
      gstOnSales += inv.cgst + inv.sgst + inv.igst;
      for (const l of inv.lines) {
        if (!l.qty) continue;
        const z = bySize.get(l.size) ?? { qty: 0, amount: 0 };
        z.qty += l.qty; z.amount += (l.qty * l.rate) / (1 + l.gstRate / 100);
        bySize.set(l.size, z);
      }
    } else {
      buysByDate.set(inv.date, (buysByDate.get(inv.date) ?? 0) + inv.taxable);
      gstOnPurchases += inv.cgst + inv.sgst + inv.igst;
      purchaseQty += inv.lines.reduce((n, l) => n + l.qty, 0);
    }
  }
  const expByDate = new Map<string, number>();
  const byCat = new Map<string, number>();
  for (const e of db.expenses ?? []) {
    if (e.date < from || e.date > to) continue;
    expByDate.set(e.date, (expByDate.get(e.date) ?? 0) + e.amount);
    byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount);
  }

  const days: DayPL[] = [];
  let closeQ = openQ;
  for (let d = from, n = 0; d <= to && n < 400; d = nextDay(d), n++) {
    closeQ = qtyUpTo(istEnd(d), true);
    const closingValue = value(closeQ, avgUpTo(d));
    const revenue = salesByDate.get(d)?.amt ?? 0;
    const purchases = buysByDate.get(d) ?? 0;
    const cogs = prevValue + purchases - closingValue;
    const expenses = expByDate.get(d) ?? 0;
    days.push({ date: d, revenue, qtySold: salesByDate.get(d)?.qty ?? 0, purchases, openingValue: prevValue, closingValue, cogs, gross: revenue - cogs, expenses, net: revenue - cogs - expenses });
    prevValue = closingValue;
  }
  const sum = (k: keyof DayPL) => days.reduce((s, x) => s + (x[k] as number), 0);
  const revenue = sum("revenue"), purchases = sum("purchases"), expenses = sum("expenses");
  const closingValue = prevValue;
  const cogs = openingValue + purchases - closingValue;
  let pendingSales = 0;
  for (const d of db.deliveries) if (d.status === "pending" && d.date >= from && d.date <= to) pendingSales += deliveryBill(db, d);
  return {
    from, to, days: days.reverse(), revenue,
    revenueBySize: sizes.filter((z) => bySize.has(z.id)).map((z) => ({ size: z.id, ...bySize.get(z.id)! })),
    gstOnSales, openingQty, openingValue, purchases, purchaseQty, gstOnPurchases,
    closingQty: count(closeQ), closingValue, cogs, gross: revenue - cogs,
    expensesByCategory: [...byCat.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    expenses, net: revenue - cogs - expenses, pendingSales,
  };
}
