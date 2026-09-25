"use client";

import * as React from "react";
import { Camera, CheckCircle2, ChevronRight, ImageIcon, IndianRupee, Loader2, MapPin, PackagePlus, Search, Truck, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AckPhoto, ackPlaceholder, EmptyState, StatusBadge, Stepper, qtySummary } from "@/components/app/common";
import { locQty, priceFor, submitDelivery, truckLoc } from "@/lib/engine";
import { custName, dayKey, distanceKm, fmtDate, fmtTime, rupees } from "@/lib/format";
import { useActorId, useSizes } from "@/lib/hooks";
import { Link, navigate } from "@/lib/router";
import { useLookups, useStore } from "@/lib/store";
import type { Customer, GeoPoint, SizeQty } from "@/lib/types";
import { cn } from "@/lib/utils";

function useDriver() {
  const { db, user } = useStore();
  const driver = db.drivers.find((d) => d.id === user?.driverId)!;
  const today = dayKey();
  const load = db.loadSheets.filter((l) => l.driverId === driver.id && l.date === today);
  const truckId = load.at(-1)?.truckId ?? driver.truckId;
  return { driver, truckId, load, today };
}

export function DriverHome() {
  const { db, stock } = useStore();
  const L = useLookups();
  const sizes = useSizes();
  const { driver, truckId, load, today } = useDriver();
  const mine = db.deliveries.filter((d) => d.driverId === driver.id && d.date === today).sort((a, b) => b.ts.localeCompare(a.ts));
  const cash = mine.filter((d) => d.status !== "rejected" && d.payment?.mode === "cash").reduce((s, d) => s + d.payment!.amount, 0);
  const upi = mine.filter((d) => d.status !== "rejected" && d.payment?.mode === "upi").reduce((s, d) => s + d.payment!.amount, 0);
  const returned = db.reconciliations.some((r) => r.truckId === truckId && r.date === today);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">{fmtDate(today)}</p>
        <h1 className="text-2xl font-semibold">Hi {driver.name.split(" ")[0]} 👋</h1>
        <p className="mt-1 flex items-center gap-1.5 text-sm"><Truck className="size-4" /> {L.truck.get(truckId)?.regNo} · {L.truck.get(truckId)?.model}</p>
      </div>

      <Button size="xl" className="h-16 w-full text-lg" onClick={() => navigate("/driver/new")} disabled={returned}>
        <PackagePlus className="size-6" /> New delivery
      </Button>
      {returned && <p className="-mt-3 text-center text-sm text-muted-foreground">Your truck has been returned and counted for today.</p>}

      <Card className="gap-3 py-4">
        <CardContent className="px-4">
          <p className="mb-3 font-semibold">On my truck now</p>
          <div className="grid grid-cols-2 gap-2">
            {sizes.map((s) => (
              <div key={s.id} className="rounded-lg bg-muted/60 p-3">
                <p className="text-sm font-medium">{s.label}</p>
                <p className="mt-1 text-sm"><span className="text-2xl font-semibold tabular-nums">{locQty(stock, truckLoc(truckId), s.id, "full")}</span> full</p>
                <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground tabular-nums">{locQty(stock, truckLoc(truckId), s.id, "empty")}</span> empty</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Loaded today: {load.length ? qtySummary(load.reduce<SizeQty>((a, l) => { for (const [k, v] of Object.entries(l.lines)) a[k] = (a[k] ?? 0) + v; return a; }, {}), sizes) : "no load sheet yet"}</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-2">
        <Card className="gap-0 py-3"><CardContent className="px-3"><p className="text-xs text-muted-foreground">Deliveries</p><p className="text-xl font-semibold">{mine.filter((d) => d.status !== "rejected").length}</p></CardContent></Card>
        <Card className="gap-0 py-3"><CardContent className="px-3"><p className="text-xs text-muted-foreground">Cash</p><p className="text-xl font-semibold tabular-nums">{rupees(cash)}</p></CardContent></Card>
        <Card className="gap-0 py-3"><CardContent className="px-3"><p className="text-xs text-muted-foreground">UPI</p><p className="text-xl font-semibold tabular-nums">{rupees(upi)}</p></CardContent></Card>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between"><p className="font-semibold">Today&apos;s deliveries</p><Link href="/driver/history" className="text-sm text-primary">See all</Link></div>
        {mine.length === 0 ? <EmptyState title="No deliveries yet today" /> : (
          <div className="grid gap-2">
            {mine.map((d) => {
              const c = L.customer.get(d.customerId)!;
              return (
                <Card key={d.id} className="min-w-0 gap-0 py-3">
                  <CardContent className="flex items-center gap-3 px-3">
                    <AckPhoto delivery={d} customer={c} className="size-14 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{custName(c)}</p>
                      <p className="text-xs text-muted-foreground">{fmtTime(d.ts)} · {qtySummary(d.full, sizes)}</p>
                      {d.status === "rejected" && <p className="text-xs text-destructive">{d.rejectReason}</p>}
                    </div>
                    <StatusBadge status={d.status} />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- new delivery ----------

async function compressImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, 900 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.6);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function CustomerPicker({ onPick }: { onPick: (c: Customer) => void }) {
  const { db, balances } = useStore();
  const [q, setQ] = React.useState("");
  const list = db.customers.filter((c) => {
    const s = `${c.businessName} ${c.name} ${c.area} ${c.phone} ${c.code}`.toLowerCase();
    return q.trim().split(/\s+/).every((w) => s.includes(w.toLowerCase()));
  });
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, area or phone" className="h-14 pl-11 text-base" />
      </div>
      <div className="grid gap-2">
        {list.map((c) => (
          <button key={c.id} type="button" onClick={() => onPick(c)} className="flex min-h-16 items-center gap-3 rounded-lg border bg-card p-3 text-left active:bg-accent">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{custName(c)}</p>
              <p className="truncate text-sm text-muted-foreground">{c.area} · {c.type === "domestic" ? "Domestic" : "Commercial"} · {c.paymentMode === "cod" ? "Cash" : "Credit"}</p>
              {balances[c.id].excessEmpties > 0 && <p className="text-xs text-warning-foreground">Owes {balances[c.id].excessEmpties} empties</p>}
            </div>
            <ChevronRight className="size-5 text-muted-foreground" />
          </button>
        ))}
        {!list.length && <EmptyState title="No customer found" />}
      </div>
    </div>
  );
}

export function NewDeliveryView() {
  const { db, stock, act, balances } = useStore();
  const sizes = useSizes();
  const actor = useActorId();
  const { driver, truckId } = useDriver();
  const [customer, setCustomer] = React.useState<Customer | null>(null);
  const [full, setFull] = React.useState<SizeQty>({});
  const [empty, setEmpty] = React.useState<SizeQty>({});
  const [amount, setAmount] = React.useState("");
  const [mode, setMode] = React.useState<"cash" | "upi">("cash");
  const [photo, setPhoto] = React.useState<string | null>(null);
  const [busyPhoto, setBusyPhoto] = React.useState(false);
  const [gps, setGps] = React.useState<GeoPoint | null>(null);
  const [gpsState, setGpsState] = React.useState<"idle" | "locating" | "ok" | "mock">("idle");
  const fileRef = React.useRef<HTMLInputElement>(null);
  const camRef = React.useRef<HTMLInputElement>(null);

  // Capture GPS once a customer is chosen; fall back to a mock point near them.
  React.useEffect(() => {
    if (!customer) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- start locating when a customer is picked
    setGpsState("locating");
    const mock = () => {
      setGps({ lat: +(customer.lat + (Math.random() - 0.5) * 0.0006).toFixed(6), lng: +(customer.lng + (Math.random() - 0.5) * 0.0006).toFixed(6), mocked: true });
      setGpsState("mock");
    };
    if (!("geolocation" in navigator)) return mock();
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; mock(); } }, 6000);
    navigator.geolocation.getCurrentPosition(
      (p) => { if (done) return; done = true; clearTimeout(timer); setGps({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), mocked: false }); setGpsState("ok"); },
      () => { if (done) return; done = true; clearTimeout(timer); mock(); },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 },
    );
    return () => { done = true; clearTimeout(timer); };
  }, [customer]);

  const pick = (c: Customer) => {
    setCustomer(c);
    const f: SizeQty = {};
    // Suggest the sizes this customer usually takes
    const last = db.deliveries.filter((d) => d.customerId === c.id && d.status === "approved").at(-1);
    if (last) Object.assign(f, last.full);
    setFull(f);
    setEmpty({ ...f });
    setAmount("");
    setMode("cash");
  };

  const value = customer ? Object.entries(full).reduce((s, [size, q]) => s + q * priceFor(db, size, customer.type), 0) : 0;
  const totalFull = Object.values(full).reduce((a, b) => a + b, 0);
  const totalEmpty = Object.values(empty).reduce((a, b) => a + b, 0);
  const short = sizes.filter((s) => (full[s.id] ?? 0) > locQty(stock, truckLoc(truckId), s.id, "full"));
  const km = customer && gps ? distanceKm(customer, gps) : 0;
  const canSubmit = customer && (totalFull > 0 || totalEmpty > 0) && photo && gps && short.length === 0;

  const onFile = async (f?: File) => {
    if (!f) return;
    setBusyPhoto(true);
    try { setPhoto(await compressImage(f)); } finally { setBusyPhoto(false); }
  };

  const submit = () => {
    if (!customer || !gps || !photo) return;
    const clean = (q: SizeQty) => Object.fromEntries(Object.entries(q).filter(([, n]) => n > 0));
    const amt = Math.max(0, Math.round(Number(amount) || 0));
    const ok = act((d) => {
      submitDelivery(d, { ts: new Date().toISOString(), truckId, driverId: driver.id, customerId: customer.id, full: clean(full), empty: clean(empty), payment: amt > 0 ? { amount: amt, mode } : null, photo, gps, userId: actor });
    }, "Delivery saved. Waiting for warehouse approval.");
    if (ok) navigate("/");
  };

  if (!customer) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">New delivery</h1>
        <p className="text-sm text-muted-foreground">Step 1 of 2: choose the customer</p>
        <CustomerPicker onPick={pick} />
      </div>
    );
  }

  const bal = balances[customer.id];
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">New delivery to</p>
          <h1 className="truncate text-xl font-semibold">{custName(customer)}</h1>
          <p className="text-sm text-muted-foreground">{customer.address}</p>
          <p className="mt-1 text-xs text-muted-foreground">Holding {Object.entries(bal.empties).filter(([, n]) => n).map(([s, n]) => `${n}×${s} kg`).join(", ") || "no cylinders"} · Outstanding {rupees(bal.outstanding)}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setCustomer(null)} aria-label="Change customer"><X /></Button>
      </div>

      <section className="space-y-2">
        <h2 className="font-semibold">Cylinders</h2>
        {sizes.map((s) => {
          const onTruck = locQty(stock, truckLoc(truckId), s.id, "full");
          const over = (full[s.id] ?? 0) > onTruck;
          return (
            <Card key={s.id} className={cn("gap-2 py-3", over && "border-destructive")}>
              <CardContent className="space-y-2 px-3">
                <div className="flex items-center justify-between"><p className="font-semibold">{s.label}</p><p className={cn("text-xs", over ? "text-destructive" : "text-muted-foreground")}>{onTruck} full on truck</p></div>
                <div className="flex items-center justify-between gap-2"><span className="text-sm">Full given</span><Stepper large value={full[s.id] ?? 0} onChange={(n) => setFull({ ...full, [s.id]: n })} label={`${s.label} full given`} /></div>
                <div className="flex items-center justify-between gap-2"><span className="text-sm">Empties back</span><Stepper large value={empty[s.id] ?? 0} onChange={(n) => setEmpty({ ...empty, [s.id]: n })} label={`${s.label} empties back`} /></div>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Payment collected <span className="font-normal text-muted-foreground">(optional)</span></h2>
        <p className="text-sm text-muted-foreground">Bill value {rupees(value)} · {customer.paymentMode === "cod" ? "Cash on delivery customer" : "Credit customer"}</p>
        <div className="relative">
          <IndianRupee className="absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} placeholder="0" className="h-14 pl-10 text-xl font-semibold" aria-label="Amount collected" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Button type="button" size="xl" variant="outline" onClick={() => setAmount(String(value))} disabled={!value}>Full amount</Button>
          <Button type="button" size="xl" variant={mode === "cash" ? "default" : "outline"} onClick={() => setMode("cash")}>Cash</Button>
          <Button type="button" size="xl" variant={mode === "upi" ? "default" : "outline"} onClick={() => setMode("upi")}>UPI</Button>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Signed & stamped acknowledgement</h2>
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        {photo ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt="Acknowledgement preview" className="max-h-80 w-full rounded-lg border object-contain" />
            <Button variant="secondary" size="sm" className="absolute top-2 right-2" onClick={() => setPhoto(null)}>Retake</Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" size="xl" className="h-20 flex-col gap-1" onClick={() => camRef.current?.click()} disabled={busyPhoto}>{busyPhoto ? <Loader2 className="animate-spin" /> : <Camera className="size-6" />} Take photo</Button>
            <Button type="button" size="xl" variant="outline" className="h-20 flex-col gap-1" onClick={() => fileRef.current?.click()} disabled={busyPhoto}><ImageIcon className="size-6" /> From gallery</Button>
            <Button type="button" variant="link" className="col-span-2" onClick={() => setPhoto(ackPlaceholder(Math.ceil(Math.random() * 6), { no: "DL/NEW", ts: new Date().toISOString(), full, empty }, custName(customer)))}>No camera? Use a sample photo for the demo</Button>
          </div>
        )}
      </section>

      <section className={cn("flex items-start gap-3 rounded-lg border p-3 text-sm", gps && km > db.settings.gpsMaxDistanceKm && "border-warning bg-warning/10")}>
        <MapPin className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          {gpsState === "locating" && <p className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Getting your location…</p>}
          {gps && <>
            <p className="font-medium">{gpsState === "mock" ? "Location (demo fallback)" : "Location captured"} · {km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`} from customer</p>
            <p className="font-mono text-xs text-muted-foreground">{gps.lat}, {gps.lng} · {fmtTime(new Date())}</p>
            {km > db.settings.gpsMaxDistanceKm && <p className="text-xs text-warning-foreground">You seem far from the customer&apos;s saved location. The warehouse will see this.</p>}
          </>}
        </div>
      </section>

      {short.length > 0 && <p className="text-sm font-medium text-destructive">Not enough full cylinders on your truck for {short.map((s) => s.label).join(", ")}.</p>}
      <div className="sticky bottom-20 z-10">
        <Button size="xl" variant="success" className="h-16 w-full text-lg shadow-lg" disabled={!canSubmit} onClick={submit}><CheckCircle2 className="size-6" /> Submit delivery</Button>
        {!photo && <p className="mt-1 text-center text-xs text-muted-foreground">Add the acknowledgement photo to submit</p>}
      </div>
    </div>
  );
}

export function DriverHistoryView() {
  const { db } = useStore();
  const L = useLookups();
  const sizes = useSizes();
  const { driver } = useDriver();
  const list = db.deliveries.filter((d) => d.driverId === driver.id).sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 80);
  const groups = new Map<string, typeof list>();
  for (const d of list) groups.set(d.date, [...(groups.get(d.date) ?? []), d]);
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">My deliveries</h1>
      {[...groups.entries()].map(([date, items]) => (
        <div key={date}>
          <p className="mb-2 text-sm font-medium text-muted-foreground">{fmtDate(date)} · {items.length}</p>
          <div className="grid gap-2">
            {items.map((d) => {
              const c = L.customer.get(d.customerId)!;
              return (
                <Card key={d.id} className="min-w-0 gap-0 py-3">
                  <CardContent className="flex items-center gap-3 px-3">
                    <AckPhoto delivery={d} customer={c} className="size-14 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{custName(c)}</p>
                      <p className="text-xs text-muted-foreground">{fmtTime(d.ts)} · {qtySummary(d.full, sizes)}{d.payment && <> · {rupees(d.payment.amount)} {d.payment.mode.toUpperCase()}</>}</p>
                      {d.status === "rejected" && <p className="text-xs text-destructive">{d.rejectReason}</p>}
                    </div>
                    <StatusBadge status={d.status} />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ))}
      {!list.length && <EmptyState title="No deliveries yet" />}
    </div>
  );
}
