"use client";

import * as React from "react";
import { ArrowLeft, Pencil, Phone, Plus, Search, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AckPhoto, downloadCSV, EmptyState, ExportButton, PageHeader, StatCard, StatusBadge, qtySummary } from "@/components/app/common";
import { logAudit, nextId, recordPayment } from "@/lib/engine";
import { custName, dayKey, fmtDate, fmtDateTime, rupees } from "@/lib/format";
import { useActorId, useSizes } from "@/lib/hooks";
import { Link, navigate } from "@/lib/router";
import { useLookups, useStore } from "@/lib/store";
import type { Customer } from "@/lib/types";
import { customerErrors, paymentError } from "@/lib/validate";
import { cn } from "@/lib/utils";
import { CustomerInvoicesTable } from "./invoices";

export function CustomersView() {
  const { db, balances, role } = useStore();
  const sizes = useSizes();
  const [q, setQ] = React.useState("");
  const [type, setType] = React.useState("all");
  const [area, setArea] = React.useState("all");
  const [editing, setEditing] = React.useState<Customer | "new" | null>(null);
  const areas = [...new Set(db.customers.map((c) => c.area))].sort();
  const list = db.customers.filter((c) => {
    if (type !== "all" && c.type !== type) return false;
    if (area !== "all" && c.area !== area) return false;
    const s = `${c.businessName} ${c.name} ${c.phone} ${c.gstin} ${c.code}`.toLowerCase();
    return s.includes(q.toLowerCase());
  });

  const exportCsv = () => downloadCSV("customers.csv", [
    ["Code", "Name", "Business", "Type", "GSTIN", "Phone", "Address", "Area", "Credit limit", "Deposit cylinders", "Deposit amount", "Payment mode", "Outstanding", ...sizes.map((s) => `Held ${s.label}`), "Excess empties"],
    ...list.map((c) => [c.code, c.name, c.businessName, c.type, c.gstin, c.phone, c.address, c.area, c.creditLimit, Object.entries(c.depositCylinders).map(([k, v]) => `${v}x${k}kg`).join(" "), c.depositAmount, c.paymentMode, Math.round(balances[c.id].outstanding), ...sizes.map((s) => balances[c.id].empties[s.id] ?? 0), balances[c.id].excessEmpties]),
  ]);

  return (
    <>
      <PageHeader title="Customers" description={`${db.customers.length} customers · domestic (GST 5%) and commercial (GST 18%)`}
        actions={<><ExportButton onClick={exportCsv} />{role === "owner" && <Button onClick={() => setEditing("new")}><Plus /> Add customer</Button>}</>} />
      <Card>
        <CardHeader className="flex flex-wrap gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, GSTIN" className="pl-8" />
          </div>
          <Select value={type} onValueChange={setType}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All types</SelectItem><SelectItem value="domestic">Domestic</SelectItem><SelectItem value="commercial">Commercial</SelectItem></SelectContent></Select>
          <Select value={area} onValueChange={setArea}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All areas</SelectItem>{areas.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent></Select>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Area</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Cylinders held</TableHead>
                <TableHead className="text-right">Excess empties</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead className="text-right">Credit limit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((c) => {
                const b = balances[c.id];
                const over = c.creditLimit > 0 && b.outstanding > c.creditLimit;
                return (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate(`/customers/${c.id}`)}>
                    <TableCell><Link href={`/customers/${c.id}`} className="font-medium hover:underline">{custName(c)}</Link><div className="text-xs text-muted-foreground">{c.businessName ? c.name + " · " : ""}{c.category}</div></TableCell>
                    <TableCell>{c.area}</TableCell>
                    <TableCell><Badge variant={c.type === "domestic" ? "info" : "secondary"}>{c.type === "domestic" ? "Domestic" : "Commercial"}</Badge></TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{sizes.filter((s) => b.empties[s.id]).map((s) => `${b.empties[s.id]}×${s.label}`).join(", ") || "–"}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", b.excessEmpties > db.settings.emptiesTolerance && "font-semibold text-destructive")}>{b.excessEmpties || "–"}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", over && "font-semibold text-destructive")}>{rupees(b.outstanding)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{c.paymentMode === "cod" ? "COD" : rupees(c.creditLimit)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {!list.length && <EmptyState title="No customers match" />}
        </CardContent>
      </Card>
      {editing && <CustomerDialog customer={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

// Customer detail. In the customer portal (portal=true) the same screen is
// used but without staff actions.
export function CustomerDetail({ id, portal = false, tab }: { id: string; portal?: boolean; tab?: string }) {
  const { db, balances, role } = useStore();
  const L = useLookups();
  const sizes = useSizes();
  const [editing, setEditing] = React.useState(false);
  const [paying, setPaying] = React.useState(false);
  const c = L.customer.get(id);
  if (!c) return <EmptyState title="Customer not found" />;
  const b = balances[c.id];
  const over = c.creditLimit > 0 && b.outstanding > c.creditLimit;
  const deliveries = db.deliveries.filter((d) => d.customerId === c.id).sort((a, b2) => b2.ts.localeCompare(a.ts));
  const payments = db.payments.filter((p) => p.customerId === c.id).sort((a, b2) => b2.ts.localeCompare(a.ts));
  const lastDelivery = deliveries.find((d) => d.status === "approved");

  const balanceCards = (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard highlight label="Outstanding amount" value={rupees(b.outstanding)} hint={c.paymentMode === "cod" ? "Cash on delivery" : `Credit limit ${rupees(c.creditLimit)}`} tone={over ? "danger" : "default"} icon={Wallet} />
      <StatCard label="Excess empties owed" value={b.excessEmpties} hint="Above security deposit" tone={b.excessEmpties > db.settings.emptiesTolerance ? "danger" : "success"} />
      <StatCard label="Total billed (60 days)" value={rupees(b.totalBilled)} />
      <StatCard label="Last delivery" value={lastDelivery ? fmtDate(lastDelivery.ts) : "–"} hint={lastDelivery ? qtySummary(lastDelivery.full, sizes) : undefined} />
    </div>
  );

  const emptiesTable = (
    <Card>
      <CardHeader><CardTitle>Empty cylinder balance</CardTitle><CardDescription>Full cylinders given minus empties returned, compared with security deposit.</CardDescription></CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Size</TableHead><TableHead className="text-right">Cylinders with customer</TableHead><TableHead className="text-right">Security deposit</TableHead><TableHead className="text-right">To be returned</TableHead></TableRow></TableHeader>
          <TableBody>
            {sizes.filter((s) => b.empties[s.id] || c.depositCylinders[s.id]).map((s) => {
              const held = b.empties[s.id] ?? 0, dep = c.depositCylinders[s.id] ?? 0;
              return (
                <TableRow key={s.id}>
                  <TableCell>{s.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{held}</TableCell>
                  <TableCell className="text-right tabular-nums">{dep}</TableCell>
                  <TableCell className={cn("text-right font-medium tabular-nums", held > dep && "text-destructive")}>{Math.max(0, held - dep) || "–"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">Security deposit: {rupees(c.depositAmount)} for {Object.entries(c.depositCylinders).map(([k, v]) => `${v} × ${k} kg`).join(", ")}</p>
      </CardContent>
    </Card>
  );

  const deliveriesList = (
    <Card>
      <CardHeader><CardTitle>Delivery history</CardTitle><CardDescription>With signed acknowledgement photos</CardDescription></CardHeader>
      <CardContent className="grid gap-3">
        {deliveries.length === 0 && <EmptyState title="No deliveries yet" />}
        {deliveries.slice(0, 60).map((d) => (
          <div key={d.id} className="flex items-center gap-3 rounded-md border p-2.5">
            <AckPhoto delivery={d} customer={c} className="size-16 shrink-0" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">{fmtDateTime(d.ts)} <span className="font-normal text-muted-foreground">· {d.no}</span></p>
              <p className="text-muted-foreground">Full {qtySummary(d.full, sizes)} · Empties back {qtySummary(d.empty, sizes)}</p>
              <p className="text-xs text-muted-foreground">{L.driver.get(d.driverId)?.name} · {L.truck.get(d.truckId)?.regNo}{d.payment && <> · Paid {rupees(d.payment.amount)} {d.payment.mode.toUpperCase()}</>}</p>
              {d.status === "rejected" && !portal && <p className="text-xs text-destructive">{d.rejectReason}</p>}
            </div>
            <div className="flex flex-col items-end gap-1">
              <StatusBadge status={d.status} />
              {d.invoiceId && <Link href={`/invoices/${d.invoiceId}`} className="text-xs text-primary hover:underline">Invoice</Link>}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );

  const paymentsTable = (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <div><CardTitle>Payments</CardTitle><CardDescription className="mt-1">Total received {rupees(b.totalPaid)}</CardDescription></div>
        {!portal && <Button size="sm" onClick={() => setPaying(true)}><Plus /> Record payment</Button>}
      </CardHeader>
      <CardContent>
        {payments.length === 0 ? <EmptyState title="No payments yet" /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Mode</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>
              {payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{fmtDate(p.ts)}</TableCell>
                  <TableCell><Badge variant="outline">{p.mode.toUpperCase()}</Badge>{p.source === "tally" && <Badge variant="info" className="ml-1">Tally</Badge>}</TableCell>
                  <TableCell className="text-muted-foreground">{p.ref ?? (p.deliveryId ? "Collected on delivery" : "–")}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{rupees(p.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );

  if (portal) {
    if (tab === "deliveries") return <><PageHeader title="My deliveries" description="Every delivery with the signed acknowledgement" />{deliveriesList}</>;
    if (tab === "invoices") return <><PageHeader title="My invoices" description="GST tax invoices with CGST / SGST / IGST breakup" /><CustomerInvoicesTable customerId={c.id} /></>;
    if (tab === "payments") return <><PageHeader title="Payment history" />{paymentsTable}</>;
    return (
      <>
        <PageHeader title={`Welcome, ${c.name}`} description={`${custName(c)} · Customer code ${c.code}`} />
        <div className="space-y-6">
          {balanceCards}
          {over && <p className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">Your outstanding is above your credit limit. Please arrange a payment to avoid delivery holds.</p>}
          <div className="grid gap-6 xl:grid-cols-2">
            {emptiesTable}
            <Card>
              <CardHeader><CardTitle>Recent deliveries</CardTitle></CardHeader>
              <CardContent className="grid gap-3">
                {deliveries.slice(0, 4).map((d) => (
                  <div key={d.id} className="flex items-center gap-3 text-sm">
                    <AckPhoto delivery={d} customer={c} className="size-14 shrink-0" />
                    <div className="flex-1"><p className="font-medium">{fmtDate(d.ts)}</p><p className="text-muted-foreground">{qtySummary(d.full, sizes)}</p></div>
                    <StatusBadge status={d.status} />
                  </div>
                ))}
                <Button variant="outline" asChild><Link href="/me/deliveries">All deliveries</Link></Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="mb-3"><Button variant="ghost" size="sm" asChild><Link href="/customers"><ArrowLeft /> Customers</Link></Button></div>
      <PageHeader
        title={custName(c)}
        description={<span className="flex flex-wrap items-center gap-x-3 gap-y-1"><span>{c.code}</span><Badge variant={c.type === "domestic" ? "info" : "secondary"}>{c.type === "domestic" ? "Domestic · GST 5%" : "Commercial · GST 18%"}</Badge><span>{c.category}</span><span className="flex items-center gap-1"><Phone className="size-3.5" />{c.phone}</span></span>}
        actions={<>{role === "owner" && <Button variant="outline" onClick={() => setEditing(true)}><Pencil /> Edit</Button>}<Button onClick={() => setPaying(true)}><Wallet /> Record payment</Button></>}
      />
      <div className="space-y-6">
        {balanceCards}
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="deliveries">Deliveries ({deliveries.length})</TabsTrigger>
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="grid gap-6 xl:grid-cols-2">
            {emptiesTable}
            <Card>
              <CardHeader><CardTitle>Details</CardTitle></CardHeader>
              <CardContent>
                <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Contact</dt><dd>{c.name}</dd>
                  <dt className="text-muted-foreground">Business name</dt><dd>{c.businessName || "–"}</dd>
                  <dt className="text-muted-foreground">GSTIN</dt><dd className="font-mono">{c.gstin || "Unregistered"}</dd>
                  <dt className="text-muted-foreground">Address</dt><dd>{c.address}</dd>
                  <dt className="text-muted-foreground">State</dt><dd>{c.state}{c.state !== db.settings.homeState && <Badge variant="outline" className="ml-2">IGST</Badge>}</dd>
                  <dt className="text-muted-foreground">Location</dt><dd className="font-mono text-xs">{c.lat}, {c.lng}</dd>
                  <dt className="text-muted-foreground">Payment mode</dt><dd>{c.paymentMode === "cod" ? "Cash on delivery" : "Credit"}</dd>
                  <dt className="text-muted-foreground">Credit limit</dt><dd className={cn(over && "font-semibold text-destructive")}>{rupees(c.creditLimit)}{over && " (exceeded)"}</dd>
                </dl>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="deliveries">{deliveriesList}</TabsContent>
          <TabsContent value="invoices"><CustomerInvoicesTable customerId={c.id} /></TabsContent>
          <TabsContent value="payments">{paymentsTable}</TabsContent>
        </Tabs>
      </div>
      {editing && <CustomerDialog customer={c} onClose={() => setEditing(false)} />}
      <PaymentDialog customer={c} open={paying} onOpenChange={setPaying} />
    </>
  );
}

function PaymentDialog({ customer, open, onOpenChange }: { customer: Customer; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { act, balances } = useStore();
  const actor = useActorId();
  const [amount, setAmount] = React.useState("");
  const [mode, setMode] = React.useState<"cash" | "upi" | "cheque" | "neft">("neft");
  const [ref, setRef] = React.useState("");
  const due = balances[customer.id].outstanding;
  const amt = Number(amount);
  const err = amount ? paymentError(amt) : null;
  const save = () => {
    if (paymentError(amt)) return;
    act((d) => {
      recordPayment(d, { customerId: customer.id, date: dayKey(), ts: new Date().toISOString(), amount: amt, mode, ref: ref.trim() || undefined, source: "app" });
      logAudit(d, actor, "payment", `${rupees(amt)} ${mode.toUpperCase()} from ${custName(customer)}${ref.trim() ? ` (ref ${ref.trim()})` : ""}`);
    }, `Payment of ${rupees(amt)} recorded`);
    onOpenChange(false); setAmount(""); setRef("");
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Record payment</DialogTitle><DialogDescription>{custName(customer)} · outstanding {rupees(due)}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-2"><Label htmlFor="amt">Amount (₹)</Label><div className="flex gap-2"><Input id="amt" inputMode="numeric" maxLength={9} value={amount} aria-invalid={!!err} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, "").slice(0, 9))} /><Button variant="outline" onClick={() => setAmount(String(Math.max(0, Math.round(due))))}>Full due</Button></div>
            {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
            {!err && amt > Math.max(0, due) + 1 && <p className="text-sm text-warning-foreground">This is more than the outstanding amount. The extra will show as an advance.</p>}
          </div>
          <div className="grid gap-2"><Label>Mode</Label>
            <div className="grid grid-cols-4 gap-2">{(["cash", "upi", "cheque", "neft"] as const).map((m) => <Button key={m} variant={mode === m ? "default" : "outline"} onClick={() => setMode(m)}>{m.toUpperCase()}</Button>)}</div>
          </div>
          <div className="grid gap-2"><Label htmlFor="ref">Reference (UTR / cheque no.)</Label><Input id="ref" maxLength={40} value={ref} onChange={(e) => setRef(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={!!paymentError(amt)}>Save payment</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CustomerDialog({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  const { db, act } = useStore();
  const sizes = useSizes();
  const actor = useActorId();
  const [touched, setTouched] = React.useState(false);
  const [f, setF] = React.useState<Customer>(() => customer ? structuredClone(customer) : {
    id: "", code: "", name: "", businessName: "", type: "commercial", category: "Restaurant", gstin: "", phone: "", address: "", area: "Jayanagar", state: "Karnataka",
    lat: 12.925, lng: 77.5938, creditLimit: 50000, depositCylinders: { "19": 4 }, depositAmount: 14000, paymentMode: "credit", openingOutstanding: 0, openingEmpties: {},
  });
  const set = <K extends keyof Customer>(k: K, v: Customer[K]) => setF({ ...f, [k]: v });
  const areas = [...new Set(db.customers.map((c) => c.area))].sort();
  const clean: Customer = { ...f, name: f.name.trim(), businessName: f.businessName.trim(), address: f.address.trim(), gstin: f.gstin.trim().toUpperCase(), phone: f.phone.trim() };
  const errors = customerErrors(clean, db.users);
  const save = () => {
    if (errors.length) return;
    const f = clean;
    act((d) => {
      if (customer) {
        const i = d.customers.findIndex((c) => c.id === customer.id);
        d.customers[i] = { ...f };
        // keep the customer's login in step with their details
        const u = d.users.find((x) => x.customerId === customer.id);
        if (u) { u.name = f.name; u.phone = f.phone; }
        logAudit(d, actor, "customer_edited", `Edited ${custName(f)}${customer.phone !== f.phone ? " (phone changed)" : ""}${customer.creditLimit !== f.creditLimit ? ` (credit limit ${rupees(customer.creditLimit)} → ${rupees(f.creditLimit)})` : ""}`);
      } else {
        const id = nextId(d, "cnew");
        const ref = d.customers.find((c) => c.area === f.area);
        const c: Customer = { ...f, id, code: `AGA-C${String(d.customers.length + 1).padStart(3, "0")}`, lat: ref?.lat ?? f.lat, lng: ref?.lng ?? f.lng, openingEmpties: {} };
        d.customers.push(c);
        d.users.push({ id: `u-${id}`, name: c.name, role: "customer", phone: c.phone, customerId: id });
        logAudit(d, actor, "customer_added", `Added ${custName(c)} (${c.area})`);
      }
    }, customer ? "Customer updated" : "Customer added");
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>{customer ? "Edit customer" : "Add customer"}</DialogTitle><DialogDescription>GST rate follows the customer type: domestic 5%, commercial 18%.</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label htmlFor="c-name">Contact name</Label><Input id="c-name" maxLength={80} value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="c-biz">Business name</Label><Input id="c-biz" maxLength={80} value={f.businessName} onChange={(e) => set("businessName", e.target.value)} placeholder="Leave empty for households" /></div>
          <div className="grid gap-1.5"><Label>Type</Label>
            <Select value={f.type} onValueChange={(v) => set("type", v as Customer["type"])}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="domestic">Domestic (GST 5%)</SelectItem><SelectItem value="commercial">Commercial (GST 18%)</SelectItem></SelectContent></Select>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="c-gstin">GSTIN</Label><Input id="c-gstin" maxLength={15} value={f.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ""))} className="font-mono" /></div>
          <div className="grid gap-1.5"><Label htmlFor="c-phone">Phone</Label><Input id="c-phone" inputMode="tel" maxLength={14} value={f.phone} onChange={(e) => set("phone", e.target.value.replace(/[^\d\s+]/g, ""))} /></div>
          <div className="grid gap-1.5"><Label>Area</Label>
            <Select value={f.area} onValueChange={(v) => setF({ ...f, area: v, state: v === "Hosur" ? "Tamil Nadu" : "Karnataka" })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{areas.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="c-addr">Address</Label><Input id="c-addr" maxLength={200} value={f.address} onChange={(e) => set("address", e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="c-limit">Credit limit (₹)</Label><Input id="c-limit" inputMode="numeric" value={f.creditLimit} onChange={(e) => set("creditLimit", Number(e.target.value.replace(/\D/g, "")) || 0)} /></div>
          <div className="grid gap-1.5"><Label>Payment mode</Label>
            <Select value={f.paymentMode} onValueChange={(v) => set("paymentMode", v as Customer["paymentMode"])}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="credit">Credit</SelectItem><SelectItem value="cod">Cash on delivery</SelectItem></SelectContent></Select>
          </div>
          <div className="grid gap-1.5 sm:col-span-2"><Label>Security deposit (cylinders per size)</Label>
            <div className="flex flex-wrap gap-2">{sizes.map((s) => (
              <div key={s.id} className="flex items-center gap-1.5"><span className="text-sm text-muted-foreground">{s.label}</span><Input className="w-16" inputMode="numeric" value={f.depositCylinders[s.id] ?? 0} onChange={(e) => set("depositCylinders", { ...f.depositCylinders, [s.id]: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></div>
            ))}</div>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="c-dep">Deposit amount (₹)</Label><Input id="c-dep" inputMode="numeric" value={f.depositAmount} onChange={(e) => set("depositAmount", Number(e.target.value.replace(/\D/g, "")) || 0)} /></div>
        </div>
        {touched && errors.length > 0 && (
          <div role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"><ul className="list-disc pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul></div>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => { setTouched(true); save(); }} disabled={touched && errors.length > 0}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
