"use client";

import * as React from "react";
import { Plus, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageHeader, Stepper } from "@/components/app/common";
import { createLoadSheet, locQty, logAudit, truckLoc, WH } from "@/lib/engine";
import { dayKey, fmtDate, fmtTime } from "@/lib/format";
import { useActorId, useSizes } from "@/lib/hooks";
import { useLookups, useStore } from "@/lib/store";
import type { SizeQty } from "@/lib/types";

export function LoadSheetsView() {
  const { db, stock } = useStore();
  const L = useLookups();
  const sizes = useSizes();
  const [date, setDate] = React.useState(dayKey());
  const [open, setOpen] = React.useState(false);
  const sheets = db.loadSheets.filter((l) => l.date === date).sort((a, b) => b.ts.localeCompare(a.ts));
  const isToday = date === dayKey();

  return (
    <>
      <PageHeader
        title="Load sheets"
        description="Assign full cylinders to a truck and driver for the day. Warehouse stock goes down, truck stock goes up."
        actions={
          <>
            <Input type="date" value={date} max={dayKey()} onChange={(e) => setDate(e.target.value || dayKey())} className="h-9 w-40" aria-label="Date" />
            <Button onClick={() => setOpen(true)}><Plus /> New load sheet</Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {sizes.map((s) => {
          const q = locQty(stock, WH, s.id, "full");
          const low = q < s.lowStockThreshold;
          return (
            <Card key={s.id} className="gap-1 py-3">
              <CardContent className="px-4">
                <p className="text-sm text-muted-foreground">{s.label} full at warehouse</p>
                <p className={`text-2xl font-semibold tabular-nums ${low ? "text-destructive" : ""}`}>{q}</p>
                {low && <p className="text-xs text-destructive">Below threshold of {s.lowStockThreshold}</p>}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{isToday ? "Today's" : fmtDate(date)} load sheets</CardTitle>
          <CardDescription>{sheets.length} trucks loaded · {sheets.reduce((n, s) => n + Object.values(s.lines).reduce((a, b) => a + b, 0), 0)} full cylinders</CardDescription>
        </CardHeader>
        <CardContent>
          {sheets.length === 0 ? <EmptyState title="No load sheets for this day" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Load sheet</TableHead>
                  <TableHead>Truck</TableHead>
                  <TableHead>Driver</TableHead>
                  {sizes.map((s) => <TableHead key={s.id} className="text-right">{s.label}</TableHead>)}
                  <TableHead className="text-right">Total</TableHead>
                  {isToday && <TableHead className="text-right">Now on truck (full / empty)</TableHead>}
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sheets.map((ls) => (
                  <TableRow key={ls.id}>
                    <TableCell><div className="font-medium">{ls.no}</div><div className="text-xs text-muted-foreground">{fmtTime(ls.ts)}</div></TableCell>
                    <TableCell>{L.truck.get(ls.truckId)?.regNo}</TableCell>
                    <TableCell>{L.driver.get(ls.driverId)?.name}</TableCell>
                    {sizes.map((s) => <TableCell key={s.id} className="text-right tabular-nums">{ls.lines[s.id] ?? "–"}</TableCell>)}
                    <TableCell className="text-right font-medium tabular-nums">{Object.values(ls.lines).reduce((a, b) => a + b, 0)}</TableCell>
                    {isToday && (
                      <TableCell className="text-right text-xs tabular-nums">
                        {sizes.map((s) => {
                          const f = locQty(stock, truckLoc(ls.truckId), s.id, "full"), e = locQty(stock, truckLoc(ls.truckId), s.id, "empty");
                          return f || e ? <div key={s.id}>{s.label}: {f} / {e}</div> : null;
                        })}
                      </TableCell>
                    )}
                    <TableCell className="text-muted-foreground">{L.user.get(ls.createdBy)?.name}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <NewLoadSheetDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function NewLoadSheetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { db, stock, act } = useStore();
  const sizes = useSizes();
  const actor = useActorId();
  const [truckId, setTruckId] = React.useState("");
  const [driverId, setDriverId] = React.useState("");
  const [lines, setLines] = React.useState<SizeQty>({});

  React.useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset form when dialog opens
      setTruckId(""); setDriverId(""); setLines({});
    }
  }, [open]);

  const total = Object.values(lines).reduce((a, b) => a + b, 0);
  const over = sizes.filter((s) => (lines[s.id] ?? 0) > locQty(stock, WH, s.id, "full"));
  const truck = db.trucks.find((t) => t.id === truckId);

  const save = () => {
    const clean = Object.fromEntries(Object.entries(lines).filter(([, q]) => q > 0));
    const ok = act((d) => {
      createLoadSheet(d, { date: dayKey(), ts: new Date().toISOString(), truckId, driverId, lines: clean, userId: actor });
      logAudit(d, actor, "load_sheet", `Loaded ${total} full cylinders on ${truck?.regNo} for ${d.drivers.find((x) => x.id === driverId)?.name}`);
    }, `Loaded ${total} cylinders on ${truck?.regNo}`);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New load sheet</DialogTitle>
          <DialogDescription>Full cylinders move from the Main Warehouse to the truck.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Truck</Label>
              <Select value={truckId} onValueChange={(v) => { setTruckId(v); setDriverId(db.drivers.find((d) => d.truckId === v)?.id ?? ""); }}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose truck" /></SelectTrigger>
                <SelectContent>{db.trucks.map((t) => <SelectItem key={t.id} value={t.id}>{t.regNo} · {t.model}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Driver</Label>
              <Select value={driverId} onValueChange={setDriverId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose driver" /></SelectTrigger>
                <SelectContent>{db.drivers.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            {sizes.map((s) => {
              const avail = locQty(stock, WH, s.id, "full");
              const bad = (lines[s.id] ?? 0) > avail;
              return (
                <div key={s.id} className="flex items-center justify-between gap-3 rounded-md border p-2.5">
                  <div>
                    <p className="font-medium">{s.label}</p>
                    <p className={`text-xs ${bad ? "text-destructive" : "text-muted-foreground"}`}>{avail} full available</p>
                  </div>
                  <Stepper value={lines[s.id] ?? 0} onChange={(n) => setLines({ ...lines, [s.id]: n })} label={s.label} />
                </div>
              );
            })}
          </div>
          {truck && total > truck.capacity && <p className="text-sm text-warning-foreground">Above this truck&apos;s usual capacity of {truck.capacity} cylinders.</p>}
          {over.length > 0 && <p className="text-sm text-destructive">Not enough full stock for {over.map((s) => s.label).join(", ")}.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={!truckId || !driverId || total === 0 || over.length > 0}><Truck /> Load {total || ""} cylinders</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TruckChip({ truckId }: { truckId: string }) {
  const L = useLookups();
  return <Badge variant="outline">{L.truck.get(truckId)?.regNo}</Badge>;
}
