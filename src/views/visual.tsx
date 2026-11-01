"use client";

// "3D view": an eagle-eye, animated picture of the business right now.
// Everything comes from the same data as the rest of the app, so the scene
// changes as soon as a load sheet, delivery, approval or count is saved.

import * as React from "react";
import { Box, Factory, MapPin, Truck as TruckIcon, Warehouse, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, qtySummary, StatCard } from "@/components/app/common";
import type { LiveScene, Pick, SceneModel, VizArea, VizTruck } from "@/components/visual/scene";
import { locQty, PLANT, truckLoc, WH } from "@/lib/engine";
import { custName, dayKey, fmtTime, rupees } from "@/lib/format";
import { useSizes } from "@/lib/hooks";
import { Link } from "@/lib/router";
import { AREAS } from "@/lib/seed";
import { useLookups, useStore } from "@/lib/store";
import { CYL_STATES, STATE_LABEL, type DB } from "@/lib/types";
import { cn } from "@/lib/utils";

const BASE = { lat: 13.0285, lng: 77.5197 }; // the warehouse (Peenya)

/** Map position for an area: true direction from the warehouse, distance squeezed so far places still fit. */
function areaXY(lat: number, lng: number) {
  const kmE = (lng - BASE.lng) * 111 * Math.cos((BASE.lat * Math.PI) / 180);
  const kmN = (lat - BASE.lat) * 111;
  const km = Math.hypot(kmE, kmN) || 1;
  const r = 7 + Math.sqrt(km) * 1.9;
  return { x: (kmE / km) * r, z: (-kmN / km) * r };
}

function buildModel(db: DB, stock: ReturnType<typeof useStore>["stock"], today: string): SceneModel {
  const sizes = db.settings.sizes.filter((s) => s.active);
  const isCommercial = (id: string) => (db.settings.sizes.find((s) => s.id === id)?.domesticPrice ?? null) == null;
  // Areas from the customer list
  const byArea = new Map<string, { lat: number; lng: number; n: number }>();
  for (const c of db.customers) {
    const a = byArea.get(c.area) ?? { lat: 0, lng: 0, n: 0 };
    a.lat += c.lat; a.lng += c.lng; a.n++;
    byArea.set(c.area, a);
  }
  const todays = db.deliveries.filter((d) => d.date === today && d.status !== "rejected");
  const cust = new Map(db.customers.map((c) => [c.id, c]));
  const newOrders = (db.orders ?? []).filter((o) => o.status === "new");
  const areas: VizArea[] = [...byArea.entries()].map(([name, a]) => {
    const known = AREAS[name];
    const { x, z } = areaXY(known?.lat ?? a.lat / a.n, known?.lng ?? a.lng / a.n);
    const inArea = (cid: string) => cust.get(cid)?.area === name;
    return {
      name, x, z, customers: a.n,
      delivered: todays.filter((d) => d.status === "approved" && inArea(d.customerId)).length,
      pending: todays.filter((d) => d.status === "pending" && inArea(d.customerId)).length,
      orders: newOrders.filter((o) => inArea(o.customerId)).length,
    };
  });
  // Push apart areas that would overlap
  for (let it = 0; it < 40; it++) {
    for (const a of areas) for (const b of areas) {
      if (a === b) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 0.01;
      if (d < 5) { const k = (5 - d) / 2 / d; a.x -= dx * k; a.z -= dz * k; b.x += dx * k; b.z += dz * k; }
    }
  }
  const trucks: VizTruck[] = db.trucks.map((t) => {
    const loaded = db.loadSheets.some((l) => l.truckId === t.id && l.date === today);
    const counted = db.reconciliations.some((r) => r.truckId === t.id && r.date === today);
    const mine = todays.filter((d) => d.truckId === t.id).sort((a, b) => a.ts.localeCompare(b.ts));
    const last = mine.at(-1);
    const sum = (st: "full" | "empty") => sizes.reduce((n, s) => n + Math.max(0, locQty(stock, truckLoc(t.id), s.id, st)), 0);
    return {
      id: t.id, reg: t.regNo, driver: db.drivers.find((d) => d.truckId === t.id)?.name ?? "",
      status: counted ? "back" : loaded ? "out" : "home",
      full: sum("full"), empty: sum("empty"), delivered: mine.length,
      at: !counted && last ? cust.get(last.customerId)?.area : undefined,
    };
  });
  const plantXY = areaXY(13.29, 77.54); // Doddaballapur, north
  return {
    warehouse: {
      full: sizes.map((s) => ({ label: s.label, n: Math.max(0, locQty(stock, WH, s.id, "full")), commercial: isCommercial(s.id) })),
      empty: sizes.reduce((n, s) => n + Math.max(0, locQty(stock, WH, s.id, "empty")), 0),
      total: sizes.reduce((n, s) => n + Math.max(0, locQty(stock, WH, s.id, "full")), 0),
    },
    plant: { x: plantXY.x * 0.8, z: Math.min(plantXY.z, -12), name: "Bharat Gas plant" },
    areas, trucks,
  };
}

// ---------- details panel ----------

function Row({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-3 py-1 text-sm"><span className="text-muted-foreground">{k}</span><span className="text-right font-medium tabular-nums">{v}</span></div>;
}

function Details({ pick, onClose }: { pick: Pick; onClose: () => void }) {
  const { db, stock } = useStore();
  const L = useLookups();
  const sizes = useSizes();
  const today = dayKey();
  const head = (icon: React.ReactNode, title: string, sub: string) => (
    <CardHeader className="flex flex-row items-start justify-between gap-2">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">{icon}</div>
        <div><CardTitle>{title}</CardTitle><CardDescription className="mt-1">{sub}</CardDescription></div>
      </div>
      <Button variant="ghost" size="icon" className="size-8" onClick={onClose} aria-label="Close details"><X /></Button>
    </CardHeader>
  );

  if (pick.kind === "warehouse") {
    const loadsToday = db.loadSheets.filter((l) => l.date === today);
    const received = db.invoices.filter((i) => i.kind === "purchase" && i.date === today);
    return (
      <Card className="gap-3">
        {head(<Warehouse className="size-5" />, "Main warehouse", "Stock right now")}
        <CardContent>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground"><tr><th className="px-2 py-1.5 text-left font-medium">Size</th>{CYL_STATES.map((st) => <th key={st} className="px-2 py-1.5 text-right font-medium">{st === "defective" ? "Defect." : st === "testing" ? "Test" : STATE_LABEL[st]}</th>)}</tr></thead>
              <tbody>{sizes.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="px-2 py-1.5 font-medium">{s.label}</td>
                  {CYL_STATES.map((st) => <td key={st} className={cn("px-2 py-1.5 text-right tabular-nums", st === "full" && locQty(stock, WH, s.id, "full") < s.lowStockThreshold && "font-semibold text-destructive")}>{locQty(stock, WH, s.id, st)}</td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="mt-3">
            <Row k="Loaded on trucks today" v={`${loadsToday.reduce((n, l) => n + Object.values(l.lines).reduce((a, b) => a + b, 0), 0)} cyl. · ${loadsToday.length} sheets`} />
            <Row k="Received from plant today" v={`${received.reduce((n, i) => n + i.lines.reduce((a, l) => a + l.qty, 0), 0)} cyl.`} />
            <Row k="New customer orders" v={(db.orders ?? []).filter((o) => o.status === "new").length} />
          </div>
          <div className="mt-3 flex gap-2"><Button size="sm" variant="outline" asChild><Link href="/stock">Stock</Link></Button><Button size="sm" variant="outline" asChild><Link href="/loads">Load sheets</Link></Button></div>
        </CardContent>
      </Card>
    );
  }

  if (pick.kind === "plant") {
    const recent = db.invoices.filter((i) => i.kind === "purchase").slice(-5).reverse();
    return (
      <Card className="gap-3">
        {head(<Factory className="size-5" />, "Bharat Gas plant", "Where full cylinders come from")}
        <CardContent>
          {recent.length === 0 && <p className="text-sm text-muted-foreground">No stock receipts yet.</p>}
          {recent.map((i) => <Row key={i.id} k={<Link href={`/invoices/${i.id}`} className="hover:underline">{i.no}</Link>} v={`${i.lines.reduce((a, l) => a + l.qty, 0)} cyl. · ${i.date}`} />)}
          <Row k="Empties waiting at warehouse" v={sizes.reduce((n, s) => n + locQty(stock, WH, s.id, "empty"), 0)} />
          <Row k="Cylinders sent to plant (all time)" v={db.movements.filter((m) => m.to === PLANT).reduce((n, m) => n + m.qty, 0)} />
        </CardContent>
      </Card>
    );
  }

  if (pick.kind === "truck") {
    const t = L.truck.get(pick.id);
    if (!t) return null;
    const drv = db.drivers.find((d) => d.truckId === t.id);
    const mine = db.deliveries.filter((d) => d.truckId === t.id && d.date === today && d.status !== "rejected").sort((a, b) => b.ts.localeCompare(a.ts));
    const loads = db.loadSheets.filter((l) => l.truckId === t.id && l.date === today);
    const counted = db.reconciliations.find((r) => r.truckId === t.id && r.date === today);
    const status = counted ? (counted.mismatch ? "Returned · count mismatch" : "Returned and counted") : loads.length ? "Out for delivery" : "At warehouse";
    const collected = mine.reduce((n, d) => n + (d.payment?.amount ?? 0), 0);
    const fullBySize = Object.fromEntries(sizes.map((s) => [s.id, locQty(stock, truckLoc(t.id), s.id, "full")]));
    const emptyBySize = Object.fromEntries(sizes.map((s) => [s.id, locQty(stock, truckLoc(t.id), s.id, "empty")]));
    return (
      <Card className="gap-3">
        {head(<TruckIcon className="size-5" />, t.regNo, `${drv?.name ?? "No driver"} · ${t.model}`)}
        <CardContent>
          <Badge variant={counted ? (counted.mismatch ? "destructive" : "success") : loads.length ? "info" : "secondary"}>{status}</Badge>
          <div className="mt-3">
            <Row k="Full on truck" v={qtySummary(fullBySize, sizes)} />
            <Row k="Empties on truck" v={qtySummary(emptyBySize, sizes)} />
            <Row k="Loaded today" v={qtySummary(loads.reduce<Record<string, number>>((a, l) => { for (const [k, n] of Object.entries(l.lines)) a[k] = (a[k] ?? 0) + n; return a; }, {}), sizes)} />
            <Row k="Deliveries today" v={`${mine.length} (${mine.filter((d) => d.status === "pending").length} awaiting approval)`} />
            <Row k="Collected today" v={rupees(collected)} />
          </div>
          {mine.length > 0 && (
            <div className="mt-3 grid gap-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase">Today&apos;s stops</p>
              {mine.slice(0, 6).map((d) => {
                const c = L.customer.get(d.customerId);
                return <div key={d.id} className="flex justify-between gap-2 rounded-md border px-2 py-1.5 text-xs"><span className="truncate">{fmtTime(d.ts)} · {c ? custName(c) : ""} <span className="text-muted-foreground">({c?.area})</span></span><span className="shrink-0">{qtySummary(d.full, sizes)}</span></div>;
              })}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // area
  const custs = db.customers.filter((c) => c.area === pick.id);
  const ids = new Set(custs.map((c) => c.id));
  const todays = db.deliveries.filter((d) => d.date === today && ids.has(d.customerId) && d.status !== "rejected");
  const orders = (db.orders ?? []).filter((o) => ids.has(o.customerId) && (o.status === "new" || o.status === "accepted"));
  return (
    <Card className="gap-3">
      {head(<MapPin className="size-5" />, pick.id, `${custs.length} customers`)}
      <CardContent>
        <Row k="Delivered today" v={`${todays.filter((d) => d.status === "approved").length} (${todays.filter((d) => d.status === "pending").length} awaiting approval)`} />
        <Row k="Cylinders delivered today" v={qtySummary(todays.reduce<Record<string, number>>((a, d) => { for (const [k, n] of Object.entries(d.full)) a[k] = (a[k] ?? 0) + n; return a; }, {}), sizes)} />
        <Row k="Open orders" v={orders.length} />
        <div className="mt-3 grid gap-1.5">
          {custs.slice(0, 8).map((c) => <Link key={c.id} href={`/customers/${c.id}`} className="flex justify-between gap-2 rounded-md border px-2 py-1.5 text-xs hover:bg-accent/50"><span className="truncate">{custName(c)}</span><span className="shrink-0 text-muted-foreground">{c.type === "domestic" ? "Domestic" : "Commercial"}</span></Link>)}
          {custs.length > 8 && <p className="text-xs text-muted-foreground">+ {custs.length - 8} more</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- page ----------

export function VisualView() {
  const { db, stock } = useStore();
  const today = dayKey();
  const host = React.useRef<HTMLDivElement>(null);
  const sceneRef = React.useRef<LiveScene | null>(null);
  const [pick, setPick] = React.useState<Pick | null>(null);
  const [failed, setFailed] = React.useState(false);
  const model = React.useMemo(() => buildModel(db, stock, today), [db, stock, today]);
  const modelRef = React.useRef(model);
  React.useEffect(() => { modelRef.current = model; sceneRef.current?.update(model); }, [model]);

  React.useEffect(() => {
    let alive = true;
    const el = host.current;
    if (!el) return;
    // three.js only loads on this page, so the rest of the app stays light
    import("@/components/visual/scene").then(({ LiveScene }) => {
      if (!alive) return;
      try {
        const s = new LiveScene(el, setPick);
        sceneRef.current = s;
        s.update(modelRef.current);
      } catch { setFailed(true); }
    }).catch(() => setFailed(true));
    return () => { alive = false; sceneRef.current?.dispose(); sceneRef.current = null; };
  }, []);

  const choose = (p: Pick | null) => { setPick(p); sceneRef.current?.select(p); if (p) sceneRef.current?.focus(p); };
  const out = model.trucks.filter((t) => t.status === "out").length;

  return (
    <>
      <PageHeader title="3D view" description="Live picture of the warehouse, trucks and customer areas. Drag to rotate, scroll or pinch to zoom, tap anything for details." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Full at warehouse" value={model.warehouse.total} icon={Box} onClick={() => choose({ kind: "warehouse", id: "WH" })} />
        <StatCard label="Trucks out" value={`${out} / ${model.trucks.length}`} icon={TruckIcon} highlight />
        <StatCard label="Delivered today" value={model.trucks.reduce((n, t) => n + t.delivered, 0)} icon={MapPin} />
        <StatCard label="Areas served" value={model.areas.length} icon={Warehouse} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="relative h-[62dvh] min-h-[420px] overflow-hidden rounded-2xl border bg-[#f5f6f8] shadow-sm" data-testid="viz-canvas">
          <div ref={host} className="absolute inset-0" />
          {failed && <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">3D isn&apos;t available in this browser. Try Chrome or Edge with hardware acceleration on.</div>}
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-2 text-[11px] text-slate-600">
            <span className="rounded-full bg-white/85 px-2 py-1 shadow-sm"><i className="mr-1 inline-block size-2 rounded-full bg-[#c8302c]" />Domestic full</span>
            <span className="rounded-full bg-white/85 px-2 py-1 shadow-sm"><i className="mr-1 inline-block size-2 rounded-full bg-[#2d5fb5]" />Commercial full</span>
            <span className="rounded-full bg-white/85 px-2 py-1 shadow-sm"><i className="mr-1 inline-block size-2 rounded-full bg-[#a9afba]" />Empty</span>
          </div>
        </div>
        <div className="grid content-start gap-3">
          {pick ? <Details pick={pick} onClose={() => choose(null)} /> : (
            <Card className="gap-3">
              <CardHeader><CardTitle>Tap something</CardTitle><CardDescription className="mt-1">Select the warehouse, a truck, an area or the plant to see its details.</CardDescription></CardHeader>
              <CardContent className="grid gap-1.5">
                {model.trucks.map((t) => (
                  <button key={t.id} type="button" onClick={() => choose({ kind: "truck", id: t.id })} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent/50">
                    <span className="min-w-0"><span className="block font-medium">{t.reg}</span><span className="block truncate text-xs text-muted-foreground">{t.driver}</span></span>
                    <Badge variant={t.status === "out" ? "info" : t.status === "back" ? "success" : "secondary"}>{t.status === "out" ? (t.at ? `At ${t.at}` : "Leaving") : t.status === "back" ? "Returned" : "At warehouse"}</Badge>
                  </button>
                ))}
                {model.trucks.length === 0 && <p className="text-sm text-muted-foreground">No trucks yet. Add them under Trucks &amp; drivers.</p>}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
