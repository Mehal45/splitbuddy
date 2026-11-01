"use client";

// Customer refill orders: the customer places them in the app, warehouse staff
// get a pop-up and accept or reject them. Approving a delivery for that
// customer closes their oldest accepted order automatically.

import * as React from "react";
import { BellRing, CalendarDays, Check, PackagePlus, Phone, ShoppingCart, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageHeader, Stepper, qtySummary } from "@/components/app/common";
import {
  acceptOrder, cancelOrder, logAudit, markOrderDelivered, MAX_OPEN_ORDERS, MAX_ORDER_QTY, ORDER_DAYS_AHEAD, orderableSizes, placeOrder, priceFor, rejectOrder,
} from "@/lib/engine";
import { custName, dayKey, fmtDate, fmtDateTime, rupees, timeAgo } from "@/lib/format";
import { useActorId, useSizes } from "@/lib/hooks";
import { Link, navigate } from "@/lib/router";
import { useLookups, rpc, useStore } from "@/lib/store";
import { SLOT_LABEL, type Order, type OrderSlot, type OrderStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS: Record<OrderStatus, { label: string; variant: "warning" | "info" | "success" | "destructive" | "outline" }> = {
  new: { label: "Waiting for agency", variant: "warning" },
  accepted: { label: "Accepted · on the way", variant: "info" },
  delivered: { label: "Delivered", variant: "success" },
  rejected: { label: "Not accepted", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "outline" },
};
const STAFF_STATUS: Partial<Record<OrderStatus, string>> = { new: "New", accepted: "Accepted" };

export function OrderStatusBadge({ status, staff }: { status: OrderStatus; staff?: boolean }) {
  const s = STATUS[status];
  return <Badge variant={s.variant}>{(staff && STAFF_STATUS[status]) || s.label}</Badge>;
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const orderValue = (db: Parameters<typeof priceFor>[0], o: Pick<Order, "lines">, type: "domestic" | "commercial") =>
  Object.entries(o.lines).reduce((s, [size, q]) => s + (priceFor(db, size, type) ?? 0) * q, 0);
const wantedText = (o: Order, today: string) =>
  `${o.wantedDate === today ? "Today" : o.wantedDate === addDays(today, 1) ? "Tomorrow" : fmtDate(o.wantedDate)} · ${SLOT_LABEL[o.slot]}`;

// ---------- customer: place an order ----------

export function OrderCylindersView() {
  const { db, user, act } = useStore();
  const actor = useActorId();
  const today = dayKey();
  const c = db.customers.find((x) => x.id === user?.customerId);
  const [qty, setQty] = React.useState<Record<string, number>>({});
  const [date, setDate] = React.useState(today);
  const [slot, setSlot] = React.useState<OrderSlot>("morning");
  const [note, setNote] = React.useState("");
  if (!c) return <EmptyState title="Customer not found" />;
  const sizes = orderableSizes(db, c);
  const total = sizes.reduce((s, z) => s + (priceFor(db, z.id, c.type) ?? 0) * (qty[z.id] ?? 0), 0);
  const count = Object.values(qty).reduce((a, b) => a + b, 0);
  const open = (db.orders ?? []).filter((o) => o.customerId === c.id && (o.status === "new" || o.status === "accepted")).length;
  const bad = sizes.some((z) => (qty[z.id] ?? 0) > MAX_ORDER_QTY);
  const missing = open >= MAX_OPEN_ORDERS ? `You have ${open} orders on the way` : !count ? "Add cylinders" : bad ? `Max ${MAX_ORDER_QTY} per size` : "";

  const submit = async () => {
    const ok = await act((d) => {
      const o = placeOrder(d, { customerId: c.id, lines: qty, wantedDate: date, slot, note, userId: actor, ts: new Date().toISOString(), today });
      logAudit(d, actor, "order_placed", `${o.no} · ${custName(c)} · ${Object.entries(o.lines).map(([s, q]) => `${q} × ${s} kg`).join(", ")} for ${o.wantedDate} ${o.slot}`);
    }, "Order placed. The agency has been notified.", rpc("place_order", { p_customer: c.id, p_lines: Object.fromEntries(Object.entries(qty).filter(([, n]) => n > 0)), p_wanted: date, p_slot: slot, p_note: note }));
    if (ok) { setQty({}); setNote(""); setDate(today); navigate("/me/orders"); }
  };

  return (
    <>
      <PageHeader title="Order cylinders" description={`${custName(c)} · refills are delivered by the agency truck`} />
      <div className="grid gap-4">
        <Card>
          <CardHeader><CardTitle>How many?</CardTitle><CardDescription>Full cylinders you need. Keep your empties ready for the driver.</CardDescription></CardHeader>
          <CardContent className="grid gap-3">
            {sizes.length === 0 && <EmptyState title="No sizes available for your account" hint="Please call the agency." />}
            {sizes.map((z) => (
              <div key={z.id} className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{z.label}</p>
                  <p className="text-xs text-muted-foreground">{rupees(priceFor(db, z.id, c.type) ?? 0)} each, incl. GST</p>
                </div>
                <Stepper value={qty[z.id] ?? 0} max={MAX_ORDER_QTY} large label={`${z.label} quantity`} onChange={(n) => setQty((q) => ({ ...q, [z.id]: n }))} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>When?</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid grid-cols-3 gap-2">
              <Button type="button" variant={date === today ? "default" : "outline"} onClick={() => setDate(today)}>Today</Button>
              <Button type="button" variant={date === addDays(today, 1) ? "default" : "outline"} onClick={() => setDate(addDays(today, 1))}>Tomorrow</Button>
              <div className="relative">
                <Label htmlFor="or-date" className="sr-only">Delivery date</Label>
                <Input id="or-date" type="date" className="h-9" value={date} min={today} max={addDays(today, ORDER_DAYS_AHEAD)} onChange={(e) => setDate(e.target.value || today)} />
              </div>
            </div>
            <div className="grid gap-2" role="radiogroup" aria-label="Delivery time">
              {(Object.keys(SLOT_LABEL) as OrderSlot[]).map((s) => (
                <Button key={s} type="button" role="radio" aria-checked={slot === s} variant={slot === s ? "default" : "outline"} className="justify-start" onClick={() => setSlot(s)}>
                  <CalendarDays /> {SLOT_LABEL[s]}
                </Button>
              ))}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="or-note">Note for the agency <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Textarea id="or-note" rows={2} maxLength={200} placeholder="e.g. Use the back gate, call before coming" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{count ? `${count} cylinder${count > 1 ? "s" : ""}` : "Nothing added yet"}</span>
              <span className="text-lg font-semibold tabular-nums">{rupees(total)}</span>
            </div>
            <p className="text-xs text-muted-foreground">Approximate amount at today&apos;s prices. The final bill is made at delivery. Pay the driver by cash or UPI{c.paymentMode === "credit" ? ", or it goes on your credit account" : ""}.</p>
            {missing && <p className="text-sm text-muted-foreground">{missing}</p>}
            <Button size="xl" onClick={submit} disabled={!!missing}><ShoppingCart /> Place order</Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

// ---------- customer: my orders ----------

export function MyOrdersView() {
  const { db, user, act } = useStore();
  const actor = useActorId();
  const sizes = useSizes();
  const today = dayKey();
  const [cancelling, setCancelling] = React.useState<Order | null>(null);
  const list = (db.orders ?? []).filter((o) => o.customerId === user?.customerId).sort((a, b) => b.ts.localeCompare(a.ts));
  return (
    <>
      <PageHeader title="My orders" actions={<Button asChild><Link href="/me/order"><PackagePlus /> New order</Link></Button>} />
      {list.length === 0 ? <Card><CardContent><EmptyState title="No orders yet" hint="Tap 'New order' to order cylinders." /></CardContent></Card> : (
        <div className="grid gap-3">
          {list.map((o) => (
            <Card key={o.id} className="gap-2 py-4">
              <CardContent className="grid gap-1.5 px-4">
                <div className="flex items-start justify-between gap-2">
                  <div><p className="font-medium">{qtySummary(o.lines, sizes)}</p><p className="text-xs text-muted-foreground">{o.no} · placed {fmtDateTime(o.ts)}</p></div>
                  <OrderStatusBadge status={o.status} />
                </div>
                <p className="text-sm">Delivery: {wantedText(o, today)}</p>
                {o.note && <p className="text-sm text-muted-foreground">Note: {o.note}</p>}
                {o.status === "rejected" && <p className="text-sm text-destructive">Reason: {o.reason}</p>}
                {o.status === "new" && <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setCancelling(o)}><X /> Cancel order</Button>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={!!cancelling} onOpenChange={(v) => !v && setCancelling(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cancel this order?</DialogTitle><DialogDescription>{cancelling && qtySummary(cancelling.lines, sizes)} for {cancelling && wantedText(cancelling, today)}</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(null)}>Keep it</Button>
            <Button variant="destructive" onClick={() => {
              const o = cancelling!;
              act((d) => { cancelOrder(d, o.id, actor, new Date().toISOString()); logAudit(d, actor, "order_cancelled", `${o.no} cancelled by customer`); }, "Order cancelled", rpc("handle_order", { p_id: o.id, p_action: "cancel" }));
              setCancelling(null);
            }}>Cancel order</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Open orders block on the customer's home screen. */
export function CustomerOrdersCard({ customerId }: { customerId: string }) {
  const { db } = useStore();
  const sizes = useSizes();
  const today = dayKey();
  const open = (db.orders ?? []).filter((o) => o.customerId === customerId && (o.status === "new" || o.status === "accepted")).sort((a, b) => b.ts.localeCompare(a.ts));
  return (
    <Card>
      <CardHeader><CardTitle>Need cylinders?</CardTitle><CardDescription>Order here and the agency is told at once.</CardDescription></CardHeader>
      <CardContent className="grid gap-3">
        <Button size="xl" asChild><Link href="/me/order"><ShoppingCart /> Order cylinders</Link></Button>
        {open.map((o) => (
          <Link key={o.id} href="/me/orders" className="flex items-start justify-between gap-2 rounded-md border p-3 text-sm hover:bg-accent/50">
            <span><span className="font-medium">{qtySummary(o.lines, sizes)}</span><span className="block text-xs text-muted-foreground">{wantedText(o, today)}</span></span>
            <OrderStatusBadge status={o.status} />
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

// ---------- staff: order inbox ----------

function OrderCard({ o, onReject }: { o: Order; onReject: (o: Order) => void }) {
  const { db, act, balances } = useStore();
  const L = useLookups();
  const sizes = useSizes();
  const actor = useActorId();
  const today = dayKey();
  const c = L.customer.get(o.customerId);
  const b = c ? balances[c.id] : undefined;
  const over = c && b && c.creditLimit > 0 && b.outstanding > c.creditLimit;
  const accept = () => act((d) => { acceptOrder(d, o.id, actor, new Date().toISOString()); logAudit(d, actor, "order_accepted", `${o.no} · ${c ? custName(c) : ""}`); }, `Order accepted. ${c ? custName(c) : "The customer"} can see it's on the way.`, rpc("handle_order", { p_id: o.id, p_action: "accept" }));
  const done = () => act((d) => { markOrderDelivered(d, o.id, actor, new Date().toISOString()); logAudit(d, actor, "order_delivered", `${o.no} marked delivered by hand`); }, "Order marked delivered", rpc("handle_order", { p_id: o.id, p_action: "delivered" }));
  return (
    <Card className={cn("gap-2 py-4", o.status === "new" && "border-warning")}>
      <CardContent className="grid gap-2 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold">{c ? custName(c) : "Unknown customer"}</p>
            <p className="text-xs text-muted-foreground">{o.no} · {c?.area} · placed {timeAgo(o.ts)}</p>
          </div>
          <OrderStatusBadge status={o.status} staff />
        </div>
        <p className="text-base font-medium">{qtySummary(o.lines, sizes)} <span className="text-sm font-normal text-muted-foreground">· ≈ {rupees(c ? orderValue(db, o, c.type) : 0)}</span></p>
        <p className="text-sm"><CalendarDays className="mr-1 inline size-4 text-muted-foreground" />{wantedText(o, today)}</p>
        {o.note && <p className="rounded-md bg-muted px-3 py-2 text-sm">“{o.note}”</p>}
        {c && <p className="text-xs text-muted-foreground"><Phone className="mr-1 inline size-3" />{c.phone} · {c.paymentMode === "cod" ? "Cash on delivery" : "Credit"}{b && b.outstanding > 0 ? ` · dues ${rupees(b.outstanding)}` : ""}</p>}
        {over && <p className="text-xs font-medium text-destructive">Over credit limit ({rupees(c!.creditLimit)}). Check with the owner before sending.</p>}
        {o.status !== "new" && o.handledBy && <p className="text-xs text-muted-foreground">{STATUS[o.status].label} by {L.user.get(o.handledBy)?.name ?? "—"} · {fmtDateTime(o.handledAt!)}{o.reason ? ` · ${o.reason}` : ""}</p>}
        {o.status === "new" && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button variant="outline" onClick={() => onReject(o)}><X /> Reject</Button>
            <Button onClick={accept}><Check /> Accept</Button>
          </div>
        )}
        {o.status === "accepted" && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button variant="outline" asChild><Link href="/loads"><PackagePlus /> Load sheet</Link></Button>
            <Button variant="outline" onClick={done}><Check /> Mark delivered</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RejectDialog({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const { act } = useStore();
  const actor = useActorId();
  const [reason, setReason] = React.useState("");
  const quick = ["Out of stock for this size", "Over credit limit, please clear dues", "Can't deliver on that day", "Area not served"];
  return (
    <Dialog open={!!order} onOpenChange={(v) => { if (!v) { onClose(); setReason(""); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Reject order {order?.no}?</DialogTitle><DialogDescription>The customer sees this reason in the app.</DialogDescription></DialogHeader>
        <div className="flex flex-wrap gap-1.5">{quick.map((q) => <Button key={q} size="sm" variant={reason === q ? "default" : "outline"} onClick={() => setReason(q)}>{q}</Button>)}</div>
        <Textarea aria-label="Reason" rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Or type a reason" />
        <DialogFooter>
          <Button variant="outline" onClick={() => { onClose(); setReason(""); }}>Back</Button>
          <Button variant="destructive" disabled={!reason.trim()} onClick={async () => {
            const o = order!;
            const ok = await act((d) => { rejectOrder(d, o.id, actor, reason, new Date().toISOString()); logAudit(d, actor, "order_rejected", `${o.no}: ${reason.trim()}`); }, "Order rejected", rpc("handle_order", { p_id: o.id, p_action: "reject", p_reason: reason }));
            if (ok) { onClose(); setReason(""); }
          }}>Reject order</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OrdersView() {
  const { db } = useStore();
  const [rejecting, setRejecting] = React.useState<Order | null>(null);
  const all = (db.orders ?? []).slice().sort((a, b) => b.ts.localeCompare(a.ts));
  const fresh = all.filter((o) => o.status === "new").reverse(); // oldest first: serve in order
  const accepted = all.filter((o) => o.status === "accepted").sort((a, b) => (a.wantedDate + a.slot).localeCompare(b.wantedDate + b.slot));
  const closed = all.filter((o) => o.status !== "new" && o.status !== "accepted").slice(0, 60);
  const list = (items: Order[], empty: string) => items.length === 0
    ? <Card><CardContent><EmptyState title={empty} /></CardContent></Card>
    : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{items.map((o) => <OrderCard key={o.id} o={o} onReject={setRejecting} />)}</div>;
  return (
    <>
      <PageHeader title="Customer orders" description="Orders placed by customers in the app. Accept them, then load them on a truck." />
      <Tabs defaultValue={fresh.length || !accepted.length ? "new" : "accepted"}>
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="new">New {fresh.length > 0 && <Badge variant="warning" className="ml-1">{fresh.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="accepted">Accepted ({accepted.length})</TabsTrigger>
          <TabsTrigger value="closed">Closed</TabsTrigger>
        </TabsList>
        <TabsContent value="new">{list(fresh, "No new orders")}</TabsContent>
        <TabsContent value="accepted">{list(accepted, "Nothing accepted and waiting")}</TabsContent>
        <TabsContent value="closed">{list(closed, "No closed orders yet")}</TabsContent>
      </Tabs>
      <RejectDialog order={rejecting} onClose={() => setRejecting(null)} />
    </>
  );
}

// ---------- staff: pop-up when a new order arrives ----------

const seenKey = (uid: string) => `anmol-orders-seen:${uid}`;
function readSeen(uid: string): string[] {
  try { const v = JSON.parse(localStorage.getItem(seenKey(uid)) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(-300) : []; } catch { return []; }
}

/** Shows new customer orders the moment they arrive (also from another tab or device sync). */
export function NewOrderPopup() {
  const { db, user } = useStore();
  const L = useLookups();
  const sizes = useSizes();
  const today = dayKey();
  const uid = user?.id ?? "";
  const [seen, setSeen] = React.useState<string[] | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- read this person's "already seen" list from storage once
  React.useEffect(() => { if (uid) setSeen(readSeen(uid)); }, [uid]);
  if (!uid || !seen) return null;
  const unseen = (db.orders ?? []).filter((o) => o.status === "new" && !seen.includes(o.id)).sort((a, b) => a.ts.localeCompare(b.ts));
  const markSeen = () => {
    const next = [...seen, ...unseen.map((o) => o.id)].slice(-300);
    setSeen(next);
    try { localStorage.setItem(seenKey(uid), JSON.stringify(next)); } catch { /* private mode */ }
  };
  const first = unseen[0];
  const c = first ? L.customer.get(first.customerId) : undefined;
  return (
    <Dialog open={unseen.length > 0} onOpenChange={(v) => !v && markSeen()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><BellRing className="size-5 text-primary" /> {unseen.length > 1 ? `${unseen.length} new orders` : "New order"}</DialogTitle>
          <DialogDescription>{unseen.length > 1 ? "Customers have placed orders in the app." : "A customer just placed an order in the app."}</DialogDescription>
        </DialogHeader>
        {first && (
          <div className="grid gap-1 rounded-lg border p-3 text-sm">
            <p className="font-semibold">{c ? custName(c) : "Customer"}</p>
            <p className="text-base font-medium">{qtySummary(first.lines, sizes)}</p>
            <p className="text-muted-foreground">{wantedText(first, today)}{c ? ` · ${c.area}` : ""}</p>
            {first.note && <p className="text-muted-foreground">“{first.note}”</p>}
            {unseen.length > 1 && <p className="pt-1 text-xs text-muted-foreground">+ {unseen.length - 1} more</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={markSeen}>Later</Button>
          <Button onClick={() => { markSeen(); navigate("/orders"); }}>Open orders</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
