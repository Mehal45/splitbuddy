"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageHeader, Stepper } from "@/components/app/common";
import { reconcileTruck, truckExpected } from "@/lib/engine";
import { dayKey, fmtDate, fmtTime } from "@/lib/format";
import { useActorId, useSizes } from "@/lib/hooks";
import { Link } from "@/lib/router";
import { useLookups, useStore } from "@/lib/store";
import type { Reconciliation } from "@/lib/types";
import { cn } from "@/lib/utils";

type Counts = Record<string, { full: number; empty: number }>;

export function ReconciliationView() {
  const { db, stock } = useStore();
  const L = useLookups();
  const sizes = useSizes();
  const today = dayKey();
  const [entering, setEntering] = React.useState<string | null>(null);

  const loadedToday = [...new Set(db.loadSheets.filter((l) => l.date === today).map((l) => l.truckId))];
  const recToday = new Map(db.reconciliations.filter((r) => r.date === today).map((r) => [r.truckId, r]));
  const recent = db.reconciliations.filter((r) => r.mismatch && r.date !== today).sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 15);

  return (
    <>
      <PageHeader title="End of day reconciliation" description="When a truck comes back, count what's on it. Expected counts come from the load sheet minus deliveries. Mismatches are flagged against the driver." />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card className="gap-1 py-4"><CardContent className="px-4"><p className="text-sm text-muted-foreground">Trucks out today</p><p className="text-2xl font-semibold">{loadedToday.length}</p></CardContent></Card>
        <Card className="gap-1 py-4"><CardContent className="px-4"><p className="text-sm text-muted-foreground">Returned & counted</p><p className="text-2xl font-semibold">{recToday.size}</p></CardContent></Card>
        <Card className="gap-1 py-4"><CardContent className="px-4"><p className="text-sm text-muted-foreground">Mismatches today</p><p className={cn("text-2xl font-semibold", [...recToday.values()].some((r) => r.mismatch) && "text-destructive")}>{[...recToday.values()].filter((r) => r.mismatch).length}</p></CardContent></Card>
      </div>

      <div className="grid gap-4">
        {loadedToday.length === 0 && <EmptyState title="No trucks loaded today" />}
        {loadedToday.map((truckId) => {
          const rec = recToday.get(truckId);
          const truck = L.truck.get(truckId)!;
          const driverId = rec?.driverId ?? db.loadSheets.find((l) => l.date === today && l.truckId === truckId)!.driverId;
          const drv = L.driver.get(driverId)!;
          const expected: Counts = rec ? rec.expected : truckExpected(db, stock, truckId);
          const actual: Counts | null = rec ? rec.actual : null;
          const pendingCount = db.deliveries.filter((d) => d.truckId === truckId && d.date === today && d.status === "pending").length;
          return (
            <Card key={truckId} className={cn("gap-3", rec?.mismatch && "border-destructive/60")}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {truck.regNo}
                  {rec ? (rec.mismatch ? <Badge variant="destructive"><AlertTriangle /> Mismatch</Badge> : <Badge variant="success"><CheckCircle2 /> Matched</Badge>) : <Badge variant="outline">On the road</Badge>}
                </CardTitle>
                <CardDescription>
                  Driver <Link href="/fleet" className={cn("font-medium hover:underline", rec?.mismatch ? "text-destructive" : "text-foreground")}>{drv.name}</Link> · {drv.phone}
                  {rec && <> · counted at {fmtTime(rec.ts)} by {L.user.get(rec.by)?.name}</>}
                  {!rec && pendingCount > 0 && <> · {pendingCount} deliveries still pending approval (already counted as delivered)</>}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 lg:flex-row lg:items-end">
                <div className="flex-1 overflow-x-auto">
                  <CountTable sizes={sizes} expected={expected} actual={actual} />
                </div>
                {!rec && <Button onClick={() => setEntering(truckId)}><Scale /> Enter returned counts</Button>}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Recent mismatches</CardTitle>
          <CardDescription>Previous days where the returned count didn&apos;t match.</CardDescription>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? <EmptyState title="No mismatches recently" /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Truck</TableHead><TableHead>Driver</TableHead><TableHead>Difference</TableHead></TableRow></TableHeader>
              <TableBody>
                {recent.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{fmtDate(r.date)}</TableCell>
                    <TableCell>{L.truck.get(r.truckId)?.regNo}</TableCell>
                    <TableCell className="font-medium text-destructive">{L.driver.get(r.driverId)?.name}</TableCell>
                    <TableCell>{diffText(r, sizes)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {entering && <EnterCountsDialog truckId={entering} onClose={() => setEntering(null)} />}
    </>
  );
}

export function diffText(r: Reconciliation, sizes: { id: string; label: string }[]) {
  const parts: string[] = [];
  for (const s of sizes) {
    const e = r.expected[s.id], a = r.actual[s.id];
    if (!e || !a) continue;
    if (a.full !== e.full) parts.push(`${s.label} full ${a.full - e.full > 0 ? "+" : ""}${a.full - e.full}`);
    if (a.empty !== e.empty) parts.push(`${s.label} empty ${a.empty - e.empty > 0 ? "+" : ""}${a.empty - e.empty}`);
  }
  return parts.join(", ") || "–";
}

function CountTable({ sizes, expected, actual }: { sizes: { id: string; label: string }[]; expected: Counts; actual: Counts | null }) {
  const shown = sizes.filter((s) => expected[s.id] && (expected[s.id].full || expected[s.id].empty || actual?.[s.id]?.full || actual?.[s.id]?.empty));
  if (!shown.length) return <p className="text-sm text-muted-foreground">Truck is empty.</p>;
  return (
    <table className="w-full min-w-[420px] text-sm">
      <thead className="text-muted-foreground">
        <tr className="border-b">
          <th className="py-1.5 pr-3 text-left font-medium">Size</th>
          <th className="px-3 py-1.5 text-right font-medium">Expected full</th>
          <th className="px-3 py-1.5 text-right font-medium">Actual full</th>
          <th className="px-3 py-1.5 text-right font-medium">Expected empty</th>
          <th className="px-3 py-1.5 text-right font-medium">Actual empty</th>
        </tr>
      </thead>
      <tbody>
        {shown.map((s) => {
          const e = expected[s.id], a = actual?.[s.id];
          const badF = a && a.full !== e.full, badE = a && a.empty !== e.empty;
          return (
            <tr key={s.id} className="border-b last:border-0">
              <td className="py-1.5 pr-3">{s.label}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{e.full}</td>
              <td className={cn("px-3 py-1.5 text-right tabular-nums", badF && "bg-destructive/10 font-semibold text-destructive")}>{a ? a.full : "–"}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{e.empty}</td>
              <td className={cn("px-3 py-1.5 text-right tabular-nums", badE && "bg-destructive/10 font-semibold text-destructive")}>{a ? a.empty : "–"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function EnterCountsDialog({ truckId, onClose }: { truckId: string; onClose: () => void }) {
  const { db, stock, act } = useStore();
  const L = useLookups();
  const sizes = useSizes();
  const actor = useActorId();
  const expected = React.useMemo(() => truckExpected(db, stock, truckId), [db, stock, truckId]);
  const [actual, setActual] = React.useState<Counts>(() => structuredClone(expected));
  const today = dayKey();
  const driverId = db.loadSheets.filter((l) => l.date === today && l.truckId === truckId).at(-1)?.driverId ?? db.drivers.find((d) => d.truckId === truckId)!.id;
  const mismatch = sizes.some((s) => actual[s.id]?.full !== expected[s.id]?.full || actual[s.id]?.empty !== expected[s.id]?.empty);

  const save = () => {
    act((d) => reconcileTruck(d, { date: today, ts: new Date().toISOString(), truckId, driverId, actual, userId: actor }),
      mismatch ? `Saved with a mismatch against ${L.driver.get(driverId)?.name}` : "Truck returned. Counts match.");
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Returned counts · {L.truck.get(truckId)?.regNo}</DialogTitle>
          <DialogDescription>Count the cylinders physically on the truck. Values start at the expected count.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {sizes.map((s) => {
            const e = expected[s.id] ?? { full: 0, empty: 0 };
            const a = actual[s.id] ?? { full: 0, empty: 0 };
            return (
              <div key={s.id} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[80px_1fr_1fr] sm:items-center">
                <p className="font-medium">{s.label}</p>
                {(["full", "empty"] as const).map((st) => (
                  <div key={st} className={cn("flex items-center justify-between gap-2 rounded-md p-1", a[st] !== e[st] && "bg-destructive/10")}>
                    <span className="text-xs text-muted-foreground">{st === "full" ? "Full" : "Empty"} (exp. {e[st]})</span>
                    <Stepper value={a[st]} onChange={(n) => setActual({ ...actual, [s.id]: { ...a, [st]: n } })} label={`${s.label} ${st}`} />
                  </div>
                ))}
              </div>
            );
          })}
          {mismatch && <p className="flex items-center gap-2 text-sm font-medium text-destructive"><AlertTriangle className="size-4" />Counts differ from expected. This will be recorded against the driver.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant={mismatch ? "destructive" : "default"} onClick={save}>Save counts</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
