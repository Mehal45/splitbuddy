"use client";

import * as React from "react";
import { Check, Clock, IndianRupee, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AckPhoto, EmptyState, MiniMap, PageHeader, StatusBadge } from "@/components/app/common";
import { approveDelivery, logAudit, priceFor, rejectDelivery } from "@/lib/engine";
import { custName, dayKey, distanceKm, fmtDateTime, hoursSince, rupees, timeAgo } from "@/lib/format";
import { useActorId, useSizes } from "@/lib/hooks";
import { Link } from "@/lib/router";
import { useLookups, useStore } from "@/lib/store";
import type { Delivery } from "@/lib/types";
import { cn } from "@/lib/utils";

const REASONS = ["Stamp missing on acknowledgement", "Photo not clear, please retake", "Quantity on slip does not match entry", "Wrong customer selected", "GPS location far from customer"];

export function ApprovalsView() {
  const { db } = useStore();
  const today = dayKey();
  const pending = db.deliveries.filter((d) => d.status === "pending").sort((a, b) => a.ts.localeCompare(b.ts));
  const approved = db.deliveries.filter((d) => d.status === "approved" && d.reviewedAt && dayKey(d.reviewedAt) === today).sort((a, b) => b.reviewedAt!.localeCompare(a.reviewedAt!));
  const rejected = db.deliveries.filter((d) => d.status === "rejected").sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 30);

  return (
    <>
      <PageHeader title="Delivery approvals" description="Check each signed acknowledgement before it counts. Only approved deliveries update the customer's empty balance and outstanding amount." />
      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">Pending <Badge variant="warning" className="ml-1">{pending.length}</Badge></TabsTrigger>
          <TabsTrigger value="approved">Approved today ({approved.length})</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="grid gap-4">
          {pending.length === 0 ? <EmptyState title="All caught up" hint="No acknowledgements waiting for approval." /> : pending.map((d) => <ApprovalCard key={d.id} d={d} />)}
        </TabsContent>
        <TabsContent value="approved" className="grid gap-4">
          {approved.length === 0 ? <EmptyState title="Nothing approved yet today" /> : approved.map((d) => <ApprovalCard key={d.id} d={d} readOnly />)}
        </TabsContent>
        <TabsContent value="rejected" className="grid gap-4">
          {rejected.length === 0 ? <EmptyState title="No rejected deliveries" /> : rejected.map((d) => <ApprovalCard key={d.id} d={d} readOnly />)}
        </TabsContent>
      </Tabs>
    </>
  );
}

export function ApprovalCard({ d, readOnly = false }: { d: Delivery; readOnly?: boolean }) {
  const { db, act, now } = useStore();
  const L = useLookups();
  const sizes = useSizes();
  const actor = useActorId();
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const c = L.customer.get(d.customerId)!;
  const drv = L.driver.get(d.driverId);
  const age = hoursSince(d.ts, now);
  const overdue = d.status === "pending" && age > db.settings.pendingApprovalHours;
  const far = distanceKm(d.gps, c) > db.settings.gpsMaxDistanceKm;
  const amount = Object.entries(d.full).reduce((s, [size, q]) => s + q * priceFor(db, size, c.type), 0);
  const rows = sizes.filter((s) => (d.full[s.id] ?? 0) > 0 || (d.empty[s.id] ?? 0) > 0);

  return (
    <Card className={cn("gap-0 py-0", overdue && "border-warning")}>
      <CardContent className="grid gap-4 p-4 md:grid-cols-[180px_1fr_260px]">
        <AckPhoto delivery={d} customer={c} className="aspect-[4/5] w-full max-w-[220px]" />
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <Link href={`/customers/${c.id}`} className="text-lg font-semibold hover:underline">{custName(c)}</Link>
              <p className="text-sm text-muted-foreground">{c.area} · {c.type === "domestic" ? "Domestic" : "Commercial"} · {c.paymentMode === "cod" ? "Cash on delivery" : "Credit"}</p>
            </div>
            <StatusBadge status={d.status} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className="text-muted-foreground">{d.no}</span>
            <span>Driver <b>{drv?.name}</b> · {L.truck.get(d.truckId)?.regNo}</span>
            <span className={cn("flex items-center gap-1", overdue && "font-medium text-warning-foreground")}><Clock className="size-3.5" />{fmtDateTime(d.ts)} ({timeAgo(d.ts, now)})</span>
          </div>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr><th className="px-3 py-1.5 text-left font-medium">Size</th><th className="px-3 py-1.5 text-right font-medium">Full given</th><th className="px-3 py-1.5 text-right font-medium">Empties taken</th><th className="px-3 py-1.5 text-right font-medium">Difference</th></tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const f = d.full[s.id] ?? 0, e = d.empty[s.id] ?? 0;
                  return (
                    <tr key={s.id} className="border-t">
                      <td className="px-3 py-1.5">{s.label}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{f}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{e}</td>
                      <td className={cn("px-3 py-1.5 text-right tabular-nums", f !== e && "font-medium text-warning-foreground")}>{f - e > 0 ? `+${f - e}` : f - e}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <span>Invoice value <b className="tabular-nums">{rupees(amount)}</b></span>
            <span className="flex items-center gap-1"><IndianRupee className="size-3.5" />Collected: {d.payment ? <b>{rupees(d.payment.amount)} {d.payment.mode.toUpperCase()}</b> : <span className="text-muted-foreground">none</span>}</span>
          </div>
          {d.status === "rejected" && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">Rejected: {d.rejectReason}</p>}
          {d.status !== "pending" && d.reviewedBy && <p className="text-xs text-muted-foreground">Reviewed by {L.user.get(d.reviewedBy)?.name} on {fmtDateTime(d.reviewedAt!)}</p>}
          {!readOnly && d.status === "pending" && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="success" size="lg" onClick={() => act((db2) => { approveDelivery(db2, d.id, actor, new Date().toISOString()); logAudit(db2, actor, "delivery_approved", `${d.no} for ${custName(c)}`); }, `Approved ${d.no}: invoice created and balances updated`)}><Check /> Approve</Button>
              <Button variant="outline" size="lg" className="text-destructive" onClick={() => setRejectOpen(true)}><X /> Reject</Button>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <MiniMap customer={c} gps={d.gps} maxKm={db.settings.gpsMaxDistanceKm} />
          {far && <p className="text-xs font-medium text-destructive">Logged outside the {db.settings.gpsMaxDistanceKm * 1000} m radius of the customer&apos;s saved location.</p>}
          {overdue && <p className="text-xs font-medium text-warning-foreground">Waiting longer than {db.settings.pendingApprovalHours} hours.</p>}
        </div>
      </CardContent>
      <RejectDialog open={rejectOpen} onOpenChange={setRejectOpen} onConfirm={(reason) => act((db2) => { rejectDelivery(db2, d.id, actor, reason, new Date().toISOString()); logAudit(db2, actor, "delivery_rejected", `${d.no} for ${custName(c)}: ${reason}`); }, `Rejected ${d.no}. Stock moved back to the truck.`)} />
    </Card>
  );
}

function RejectDialog({ open, onOpenChange, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = React.useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setReason(""); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject acknowledgement</DialogTitle>
          <DialogDescription>The driver will see this reason. Cylinders go back onto the truck&apos;s stock.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {REASONS.map((r) => <Button key={r} size="sm" variant={reason === r ? "default" : "outline"} onClick={() => setReason(r)}>{r}</Button>)}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="reason">Reason</Label>
          <Textarea id="reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Type or pick a reason" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" disabled={!reason.trim()} onClick={() => { onConfirm(reason.trim()); onOpenChange(false); setReason(""); }}>Reject delivery</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
