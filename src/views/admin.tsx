"use client";

import * as React from "react";
import { CheckCircle2, Info, Laptop, Loader2, Plus, RefreshCw, RotateCcw, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/app/common";
import { createPurchase, createSaleInvoice, custLoc, locQty, move, nextId, recordPayment, WH, computeStock } from "@/lib/engine";
import { custName, dayKey, fmtDateTime, rupees, timeAgo } from "@/lib/format";
import { useActorId } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import type { CylinderSize, DB, Settings, SyncLogEntry } from "@/lib/types";

// ---------- Tally sync (mock) ----------

const STEPS = ["Connecting to TallyPrime on office PC…", "Reading new vouchers…", "Updating stock and customer balances…"];

function runMockSync(db: DB, userId: string) {
  const ts = new Date().toISOString();
  const date = dayKey();
  const rand = (n: number) => Math.floor(Math.random() * n);
  const vouchers: SyncLogEntry["vouchers"] = [];
  const stock = computeStock(db.movements);
  // Counter sales entered in Tally (walk-in customers collecting from the godown)
  const commercial = db.customers.filter((c) => c.type === "commercial" && c.state === db.settings.homeState);
  const domestic = db.customers.filter((c) => c.type === "domestic");
  const picks = [commercial[rand(commercial.length)], domestic[rand(domestic.length)], commercial[rand(commercial.length)]];
  for (const c of picks) {
    const size = c.type === "domestic" ? "14.2" : "19";
    const qty = c.type === "domestic" ? 1 : 1 + rand(3);
    if (locQty(stock, WH, size, "full") < qty) continue;
    const inv = createSaleInvoice(db, { customerId: c.id, date, ts, full: { [size]: qty }, empty: { [size]: qty }, source: "tally" });
    move(db, { ts, userId, from: WH, to: custLoc(c.id), size, state: "full", qty, refType: "tally", refId: inv.id, note: `Tally ${inv.no}` });
    move(db, { ts, userId, from: custLoc(c.id), to: WH, size, state: "empty", qty, refType: "tally", refId: inv.id, note: `Tally ${inv.no}` });
    vouchers.push({ type: "Sales", no: inv.no, party: custName(c), amount: inv.total });
  }
  // A plant purchase bill booked by the accountant
  const pur = createPurchase(db, { date, ts, plantId: "pl1", full: { "19": 30, "47.5": 10 }, emptiesBack: { "19": Math.min(20, locQty(stock, WH, "19", "empty")) }, userId, source: "tally" });
  vouchers.push({ type: "Purchase", no: pur.no, party: pur.partyName, amount: pur.total });
  // Receipts (cheque / NEFT) entered in Tally
  const credit = db.customers.filter((c) => c.paymentMode === "credit");
  for (let k = 0; k < 2; k++) {
    const c = credit[rand(credit.length)];
    const amount = (5 + rand(20)) * 1000;
    recordPayment(db, { customerId: c.id, date, ts, amount, mode: k ? "cheque" : "neft", ref: k ? `CHQ ${100000 + rand(899999)}` : `UTR${300000000 + rand(699999999)}`, source: "tally" });
    vouchers.push({ type: "Receipt", no: `RCT/${1000 + rand(8999)}`, party: custName(c), amount });
  }
  db.syncLog.unshift({ id: nextId(db, "sync"), ts, vouchers });
  db.lastSyncedAt = ts;
  return vouchers.length;
}

export function TallyView() {
  const { db, act, now } = useStore();
  const actor = useActorId();
  const [step, setStep] = React.useState(-1);

  const sync = async () => {
    for (let i = 0; i < STEPS.length; i++) { setStep(i); await new Promise((r) => setTimeout(r, 800)); }
    let n = 0;
    act((d) => { n = runMockSync(d, actor); });
    setStep(-1);
    toast.success(`Imported ${n} vouchers from Tally. Stock and balances updated.`);
  };

  return (
    <>
      <PageHeader title="Tally sync" description="Bring sales, purchase and receipt vouchers from TallyPrime into this app." />
      <div className="mb-6 flex gap-3 rounded-lg border border-info/30 bg-info/10 p-4 text-sm">
        <Laptop className="mt-0.5 size-5 shrink-0 text-info" />
        <div>
          <p className="font-medium">Demo mode: vouchers here are sample data.</p>
          <p className="text-muted-foreground">In the real version, a small program on the office PC will pull data from TallyPrime automatically (for example every 15 minutes) and send it here. No manual export needed.</p>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card>
          <CardHeader><CardTitle>Status</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Last synced</p>
              <p className="text-lg font-semibold">{db.lastSyncedAt ? fmtDateTime(db.lastSyncedAt) : "Never"}</p>
              {db.lastSyncedAt && <p className="text-xs text-muted-foreground">{timeAgo(db.lastSyncedAt, now)}</p>}
            </div>
            <Button size="lg" className="w-full" onClick={sync} disabled={step >= 0}>
              {step >= 0 ? <Loader2 className="animate-spin" /> : <RefreshCw />} {step >= 0 ? "Syncing…" : "Sync now"}
            </Button>
            {step >= 0 && (
              <ol className="space-y-1.5 text-sm">
                {STEPS.map((s, i) => (
                  <li key={s} className={i <= step ? "flex items-center gap-2" : "flex items-center gap-2 text-muted-foreground"}>
                    {i < step ? <CheckCircle2 className="size-4 text-success" /> : i === step ? <Loader2 className="size-4 animate-spin" /> : <span className="size-4" />}{s}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Sync log</CardTitle><CardDescription>Vouchers imported in each run. Stock and customer balances update automatically.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {db.syncLog.length === 0 && <EmptyState title="No syncs yet" />}
            {db.syncLog.map((s) => (
              <div key={s.id} className="rounded-md border">
                <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 text-sm"><span className="font-medium">{fmtDateTime(s.ts)}</span><Badge variant="success">{s.vouchers.length} vouchers</Badge></div>
                <Table>
                  <TableBody>
                    {s.vouchers.map((v, k) => (
                      <TableRow key={k}>
                        <TableCell><Badge variant={v.type === "Sales" ? "info" : v.type === "Purchase" ? "secondary" : "success"}>{v.type}</Badge></TableCell>
                        <TableCell className="font-mono text-xs">{v.no}</TableCell>
                        <TableCell className="max-w-[240px] truncate">{v.party}</TableCell>
                        <TableCell className="text-right tabular-nums">{rupees(v.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

// ---------- settings ----------

export function SettingsView() {
  const { db, act, resetDemo } = useStore();
  const [s, setS] = React.useState<Settings>(() => structuredClone(db.settings));
  const [confirmReset, setConfirmReset] = React.useState(false);
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh form after a reset
    setS(structuredClone(db.settings));
  }, [db.settings]);
  const dirty = JSON.stringify(s) !== JSON.stringify(db.settings);
  const setSize = (i: number, patch: Partial<CylinderSize>) => setS({ ...s, sizes: s.sizes.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  const numIn = (v: number | null, on: (n: number | null) => void, allowNull = false) => (
    <Input inputMode="decimal" className="h-8 w-24 text-right" value={v ?? ""} placeholder={allowNull ? "–" : "0"} onChange={(e) => { const t = e.target.value.replace(/[^\d.]/g, ""); on(t === "" ? (allowNull ? null : 0) : Number(t)); }} />
  );

  return (
    <>
      <PageHeader title="Settings" description="Agency details, cylinder sizes and prices, alert thresholds." actions={<Button onClick={() => act((d) => { d.settings = s; }, "Settings saved")} disabled={!dirty}><Save /> Save changes</Button>} />
      <div className="grid gap-6">
        <Card>
          <CardHeader><CardTitle>Agency</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label>Agency name</Label><Input value={s.agencyName} onChange={(e) => setS({ ...s, agencyName: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Tagline</Label><Input value={s.agencyTagline} onChange={(e) => setS({ ...s, agencyTagline: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>GSTIN</Label><Input className="font-mono" value={s.agencyGstin} onChange={(e) => setS({ ...s, agencyGstin: e.target.value.toUpperCase() })} /></div>
            <div className="grid gap-1.5"><Label>Address</Label><Input value={s.agencyAddress} onChange={(e) => setS({ ...s, agencyAddress: e.target.value })} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <div><CardTitle>Cylinder sizes & prices</CardTitle><CardDescription className="mt-1">Prices are per refill, GST inclusive. Leave a price empty if that size isn&apos;t sold to that customer type.</CardDescription></div>
            <Button variant="outline" size="sm" onClick={() => setS({ ...s, sizes: [...s.sizes, { id: `new${s.sizes.length + 1}`, label: "New size", kg: 0, domesticPrice: null, commercialPrice: 0, purchasePrice: 0, purchaseGst: 18, lowStockThreshold: 10, active: true }] })}><Plus /> Add size</Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Label</TableHead><TableHead className="text-right">Kg</TableHead><TableHead className="text-right">Domestic ₹</TableHead><TableHead className="text-right">Commercial ₹</TableHead><TableHead className="text-right">Purchase ₹</TableHead><TableHead className="text-right">Purchase GST %</TableHead><TableHead className="text-right">Low stock below</TableHead><TableHead>Active</TableHead></TableRow></TableHeader>
              <TableBody>
                {s.sizes.map((z, i) => (
                  <TableRow key={z.id}>
                    <TableCell><Input className="h-8 w-28" value={z.label} onChange={(e) => setSize(i, { label: e.target.value })} /></TableCell>
                    <TableCell className="text-right">{numIn(z.kg, (n) => setSize(i, { kg: n ?? 0, id: z.id.startsWith("new") && n ? String(n) : z.id }))}</TableCell>
                    <TableCell className="text-right">{numIn(z.domesticPrice, (n) => setSize(i, { domesticPrice: n }), true)}</TableCell>
                    <TableCell className="text-right">{numIn(z.commercialPrice, (n) => setSize(i, { commercialPrice: n }), true)}</TableCell>
                    <TableCell className="text-right">{numIn(z.purchasePrice, (n) => setSize(i, { purchasePrice: n ?? 0 }))}</TableCell>
                    <TableCell className="text-right">{numIn(z.purchaseGst, (n) => setSize(i, { purchaseGst: n ?? 0 }))}</TableCell>
                    <TableCell className="text-right">{numIn(z.lowStockThreshold, (n) => setSize(i, { lowStockThreshold: n ?? 0 }))}</TableCell>
                    <TableCell><Switch checked={z.active} onCheckedChange={(v) => setSize(i, { active: v })} aria-label={`${z.label} active`} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Alert thresholds</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-1.5"><Label>Approval overdue after (hours)</Label><Input inputMode="numeric" value={s.pendingApprovalHours} onChange={(e) => setS({ ...s, pendingApprovalHours: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></div>
            <div className="grid gap-1.5"><Label>Allowed empties above deposit</Label><Input inputMode="numeric" value={s.emptiesTolerance} onChange={(e) => setS({ ...s, emptiesTolerance: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></div>
            <div className="grid gap-1.5"><Label>GPS distance limit (km)</Label><Input inputMode="decimal" value={s.gpsMaxDistanceKm} onChange={(e) => setS({ ...s, gpsMaxDistanceKm: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })} /></div>
          </CardContent>
        </Card>

        <Card className="border-destructive/40">
          <CardHeader><CardTitle>Demo data</CardTitle><CardDescription>Everything you add in this demo is saved in this browser only.</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Button variant="destructive" onClick={() => setConfirmReset(true)}><RotateCcw /> Reset demo data</Button>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Info className="size-4" />Rebuilds a fresh 60-day history ending today.</p>
          </CardContent>
        </Card>
      </div>

      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reset demo data?</DialogTitle><DialogDescription>All deliveries, approvals, receipts and settings you changed will be replaced with fresh sample data.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setConfirmReset(false)}>Cancel</Button><Button variant="destructive" onClick={() => { resetDemo(); setConfirmReset(false); }}>Reset</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
