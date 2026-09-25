"use client";

import * as React from "react";
import { ArrowRightLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateRange, downloadCSV, ExportButton, PageHeader, Stepper, useDateRange } from "@/components/app/common";
import { changeState, locQty, logAudit, truckLoc, WH } from "@/lib/engine";
import { custName, dayKey, fmtDate, fmtTime } from "@/lib/format";
import { locLabel, useActorId, useSizes } from "@/lib/hooks";
import { Link } from "@/lib/router";
import { customerHeld, stockTotals } from "@/lib/selectors";
import { useLookups, useStore } from "@/lib/store";
import { CYL_STATES, STATE_LABEL, type CylState } from "@/lib/types";
import { cn } from "@/lib/utils";

export function StockGrid() {
  const { db, stock } = useStore();
  const sizes = useSizes();
  const t = stockTotals(db, stock);
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {sizes.map((s) => {
        const wh = t.warehouse[s.id], tr = t.trucks[s.id], cu = t.customers[s.id];
        const low = wh.full < s.lowStockThreshold;
        return (
          <Card key={s.id} className={cn("gap-3", low && "border-destructive/60")}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">{s.label}{low && <Badge variant="destructive">Low stock</Badge>}</CardTitle>
              <CardDescription>Total tracked: {wh.full + wh.empty + wh.defective + wh.testing + tr.full + tr.empty + cu.full + cu.empty + cu.defective + cu.testing}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground uppercase">Warehouse</p>
                <div className="grid grid-cols-4 gap-1 text-center">
                  {CYL_STATES.map((st) => (
                    <div key={st} className={cn("rounded-md bg-muted/60 px-1 py-1.5", st === "full" && low && "bg-destructive/10 text-destructive")}>
                      <p className="text-lg font-semibold tabular-nums">{wh[st]}</p>
                      <p className="text-[10px] leading-tight text-muted-foreground">{st === "defective" ? "Defective" : st === "testing" ? "Testing due" : STATE_LABEL[st]}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex justify-between border-t pt-2"><span className="text-muted-foreground">On trucks</span><span className="tabular-nums">{tr.full} full · {tr.empty} empty</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">With customers</span><span className="tabular-nums">{cu.full + cu.empty + cu.defective + cu.testing}</span></div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export function StockView() {
  const { db, stock, role } = useStore();
  const sizes = useSizes();
  const [changeOpen, setChangeOpen] = React.useState(false);
  const activeTrucks = db.trucks.filter((t) => sizes.some((s) => locQty(stock, truckLoc(t.id), s.id, "full") || locQty(stock, truckLoc(t.id), s.id, "empty")));
  const topHolders = db.customers.map((c) => ({ c, held: sizes.map((s) => customerHeld(stock, c, s.id)) })).filter((x) => x.held.some((h) => h)).sort((a, b) => b.held.reduce((p, q) => p + q, 0) - a.held.reduce((p, q) => p + q, 0));

  return (
    <>
      <PageHeader title="Stock" description="Live cylinder count per size and state at every location. Every change is logged in the movement log."
        actions={<>
          <Button variant="outline" asChild><Link href="/movements">Movement log</Link></Button>
          {(role === "warehouse" || role === "owner") && <Button onClick={() => setChangeOpen(true)}><ArrowRightLeft /> Change state</Button>}
        </>} />
      <StockGrid />

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>On trucks now</CardTitle><CardDescription>Full / empty per size</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Truck</TableHead><TableHead>Driver</TableHead>{sizes.map((s) => <TableHead key={s.id} className="text-right">{s.label}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {activeTrucks.length === 0 && <TableRow><TableCell colSpan={2 + sizes.length} className="text-center text-muted-foreground">All trucks are empty</TableCell></TableRow>}
                {activeTrucks.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.regNo}</TableCell>
                    <TableCell>{db.drivers.find((d) => d.truckId === t.id)?.name}</TableCell>
                    {sizes.map((s) => <TableCell key={s.id} className="text-right tabular-nums">{locQty(stock, truckLoc(t.id), s.id, "full")} / {locQty(stock, truckLoc(t.id), s.id, "empty")}</TableCell>)}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>With customers</CardTitle><CardDescription>Cylinders at customer sites, including pending deliveries</CardDescription></CardHeader>
          <CardContent className="max-h-[420px] overflow-y-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Customer</TableHead>{sizes.map((s) => <TableHead key={s.id} className="text-right">{s.label}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {topHolders.map(({ c, held }) => (
                  <TableRow key={c.id}>
                    <TableCell><Link href={`/customers/${c.id}`} className="hover:underline">{custName(c)}</Link></TableCell>
                    {held.map((h, i) => <TableCell key={i} className="text-right tabular-nums">{h || "–"}</TableCell>)}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      <ChangeStateDialog open={changeOpen} onOpenChange={setChangeOpen} />
    </>
  );
}

function ChangeStateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { stock, act } = useStore();
  const sizes = useSizes();
  const actor = useActorId();
  const [size, setSize] = React.useState("19");
  const [from, setFrom] = React.useState<CylState>("empty");
  const [to, setTo] = React.useState<CylState>("testing");
  const [qty, setQty] = React.useState(1);
  const [note, setNote] = React.useState("");
  const avail = locQty(stock, WH, size, from);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change cylinder state</DialogTitle>
          <DialogDescription>For example, mark underweight cylinders as defective, or empties as due for testing.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-2"><Label>Size</Label>
            <Select value={size} onValueChange={setSize}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{sizes.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="grid gap-2"><Label>From</Label>
            <Select value={from} onValueChange={(v) => setFrom(v as CylState)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{CYL_STATES.map((s) => <SelectItem key={s} value={s}>{STATE_LABEL[s]}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="grid gap-2"><Label>To</Label>
            <Select value={to} onValueChange={(v) => setTo(v as CylState)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{CYL_STATES.filter((s) => s !== from).map((s) => <SelectItem key={s} value={s}>{STATE_LABEL[s]}</SelectItem>)}</SelectContent></Select>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div><Label>Quantity</Label><p className="text-xs text-muted-foreground">{avail} available at warehouse</p></div>
          <Stepper value={qty} min={1} max={Math.max(1, avail)} onChange={setQty} label="Quantity" />
        </div>
        <div className="grid gap-2"><Label htmlFor="note">Note</Label><Input id="note" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Underweight on scale" /></div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={qty > avail || from === to} onClick={() => {
            const ok = act((d) => {
              changeState(d, { ts: new Date().toISOString(), size, from, to, qty, userId: actor, note: note.trim().slice(0, 120) || undefined });
              logAudit(d, actor, "stock_state_change", `${qty} × ${size} kg: ${STATE_LABEL[from]} → ${STATE_LABEL[to]}${note.trim() ? ` (${note.trim().slice(0, 120)})` : ""}`);
            }, `Moved ${qty} × ${size} kg from ${STATE_LABEL[from]} to ${STATE_LABEL[to]}`);
            if (ok) { onOpenChange(false); setNote(""); setQty(1); }
          }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const REF_LABEL: Record<string, string> = { opening: "Opening", purchase: "Plant receipt", load: "Load sheet", delivery: "Delivery", reversal: "Rejected delivery", return: "End of day return", tally: "Tally import", adjust: "State change" };

export function MovementsView() {
  const { db } = useStore();
  const L = useLookups();
  const sizes = useSizes();
  const r = useDateRange(7);
  const [size, setSize] = React.useState("all");
  const [type, setType] = React.useState("all");
  const [loc, setLoc] = React.useState("all");
  const [limit, setLimit] = React.useState(150);

  const rows = React.useMemo(() => db.movements.filter((m) => {
    const day = dayKey(m.ts);
    if (day < r.from || day > r.to) return false;
    if (size !== "all" && m.size !== size) return false;
    if (type !== "all" && m.refType !== type) return false;
    if (loc !== "all" && !(m.from.startsWith(loc) || m.to.startsWith(loc))) return false;
    return true;
  }).sort((a, b) => b.ts.localeCompare(a.ts)), [db.movements, r.from, r.to, size, type, loc]);

  const exportCsv = () => downloadCSV(`movements_${r.from}_${r.to}.csv`, [
    ["Date", "Time", "User", "From", "To", "Size (kg)", "State", "To state", "Qty", "Type", "Note"],
    ...rows.map((m) => [fmtDate(m.ts), fmtTime(m.ts), L.user.get(m.userId)?.name ?? m.userId, locLabel(db, m.from), locLabel(db, m.to), m.size, STATE_LABEL[m.state], m.toState ? STATE_LABEL[m.toState] : "", m.qty, REF_LABEL[m.refType], m.note ?? ""]),
  ]);

  return (
    <>
      <PageHeader title="Movement log" description="Every stock movement with date, time, user, from, to, size, state and quantity." actions={<ExportButton onClick={exportCsv} />} />
      <Card>
        <CardHeader className="gap-3">
          <DateRange from={r.from} to={r.to} onChange={r.set} />
          <div className="flex flex-wrap gap-2">
            <Select value={size} onValueChange={setSize}><SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All sizes</SelectItem>{sizes.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent></Select>
            <Select value={type} onValueChange={setType}><SelectTrigger size="sm" className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All types</SelectItem>{Object.entries(REF_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
            <Select value={loc} onValueChange={setLoc}><SelectTrigger size="sm" className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All locations</SelectItem><SelectItem value="WH">Main Warehouse</SelectItem><SelectItem value="PLANT">Bharat Gas Plant</SelectItem><SelectItem value="TRUCK:">Trucks</SelectItem><SelectItem value="CUST:">Customers</SelectItem></SelectContent></Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Date & time</TableHead><TableHead>User</TableHead><TableHead>From</TableHead><TableHead>To</TableHead><TableHead>Size</TableHead><TableHead>State</TableHead><TableHead className="text-right">Qty</TableHead><TableHead>Type</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.slice(0, limit).map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="tabular-nums">{fmtDate(m.ts)} <span className="text-muted-foreground">{fmtTime(m.ts)}</span></TableCell>
                  <TableCell>{L.user.get(m.userId)?.name ?? m.userId}</TableCell>
                  <TableCell>{locLabel(db, m.from)}</TableCell>
                  <TableCell>{locLabel(db, m.to)}</TableCell>
                  <TableCell>{L.size.get(m.size)?.label ?? m.size}</TableCell>
                  <TableCell>{STATE_LABEL[m.state]}{m.toState && m.toState !== m.state && <> → {STATE_LABEL[m.toState]}</>}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{m.qty}</TableCell>
                  <TableCell><span className="text-muted-foreground">{REF_LABEL[m.refType]}</span>{m.note && <span className="block max-w-[220px] truncate text-xs text-muted-foreground">{m.note}</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter><TableRow><TableCell colSpan={8}>{rows.length} movements{rows.length > limit && <Button variant="link" size="sm" onClick={() => setLimit(limit + 300)}>Show more</Button>}</TableCell></TableRow></TableFooter>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
