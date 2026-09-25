"use client";

import * as React from "react";
import { ArrowLeft, Factory, Plus, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateRange, downloadCSV, EmptyState, ExportButton, PageHeader, Stepper, useDateRange } from "@/components/app/common";
import { createPurchase, locQty, WH } from "@/lib/engine";
import { custName, dayKey, fmtDate, fmtDateTime, rupees } from "@/lib/format";
import { computeTotals, lineBreakup } from "@/lib/gst";
import { amountInWords, useActorId, useSizes } from "@/lib/hooks";
import { Link, navigate } from "@/lib/router";
import { useLookups, useStore } from "@/lib/store";
import type { Invoice, InvoiceLine, SizeQty } from "@/lib/types";

export function sourceBadge(src: Invoice["source"]) {
  if (src === "tally") return <Badge variant="info">Tally</Badge>;
  if (src === "app") return <Badge variant="secondary">App</Badge>;
  return null;
}

function InvoiceTable({ invoices, kind }: { invoices: Invoice[]; kind: "sale" | "purchase" }) {
  const sizes = useSizes();
  const sum = (k: "taxable" | "cgst" | "sgst" | "igst" | "total") => invoices.reduce((s, i) => s + i[k], 0);
  if (!invoices.length) return <EmptyState title="No invoices in this period" />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Invoice</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>{kind === "sale" ? "Customer" : "Supplier"}</TableHead>
          <TableHead>Items</TableHead>
          <TableHead className="text-right">Taxable</TableHead>
          <TableHead className="text-right">CGST</TableHead>
          <TableHead className="text-right">SGST</TableHead>
          <TableHead className="text-right">IGST</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.slice(0, 300).map((i) => (
          <TableRow key={i.id} className="cursor-pointer" onClick={() => navigate(`/invoices/${i.id}`)}>
            <TableCell><Link href={`/invoices/${i.id}`} className="font-medium text-primary hover:underline">{i.no}</Link> {sourceBadge(i.source)}</TableCell>
            <TableCell>{fmtDate(i.date)}</TableCell>
            <TableCell className="max-w-[220px] truncate">{i.partyName}{i.interstate && <Badge variant="outline" className="ml-1.5">Interstate</Badge>}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{i.lines.filter((l) => l.qty).map((l) => `${l.qty}×${sizes.find((s) => s.id === l.size)?.label ?? l.size}`).join(", ")}</TableCell>
            <TableCell className="text-right tabular-nums">{rupees(i.taxable)}</TableCell>
            <TableCell className="text-right tabular-nums">{i.cgst ? rupees(i.cgst) : "–"}</TableCell>
            <TableCell className="text-right tabular-nums">{i.sgst ? rupees(i.sgst) : "–"}</TableCell>
            <TableCell className="text-right tabular-nums">{i.igst ? rupees(i.igst) : "–"}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">{rupees(i.total)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={4}>Total · {invoices.length} invoices{invoices.length > 300 && " (first 300 shown)"}</TableCell>
          <TableCell className="text-right tabular-nums">{rupees(sum("taxable"))}</TableCell>
          <TableCell className="text-right tabular-nums">{rupees(sum("cgst"))}</TableCell>
          <TableCell className="text-right tabular-nums">{rupees(sum("sgst"))}</TableCell>
          <TableCell className="text-right tabular-nums">{rupees(sum("igst"))}</TableCell>
          <TableCell className="text-right tabular-nums">{rupees(sum("total"))}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}

function exportInvoices(name: string, invoices: Invoice[]) {
  downloadCSV(name, [
    ["Invoice no", "Date", "Party", "GSTIN", "Place of supply", "HSN", "Items", "Taxable", "CGST", "SGST", "IGST", "Total", "Source"],
    ...invoices.map((i) => [i.no, i.date, i.partyName, i.partyGstin, i.placeOfSupply, "2711", i.lines.map((l) => `${l.qty}x${l.size}kg`).join(" "), i.taxable, i.cgst, i.sgst, i.igst, i.total, i.source]),
  ]);
}

export function SalesView() {
  const { db } = useStore();
  const r = useDateRange(30);
  const invoices = db.invoices.filter((i) => i.kind === "sale" && r.inRange(i.date)).sort((a, b) => b.ts.localeCompare(a.ts));
  return (
    <>
      <PageHeader title="Sales invoices" description="Created automatically when a delivery is approved, or imported from Tally. HSN 2711 · GST 5% domestic, 18% commercial."
        actions={<ExportButton onClick={() => exportInvoices(`sales_${r.from}_${r.to}.csv`, invoices)} />} />
      <Card>
        <CardHeader><DateRange from={r.from} to={r.to} onChange={r.set} /></CardHeader>
        <CardContent><InvoiceTable invoices={invoices} kind="sale" /></CardContent>
      </Card>
    </>
  );
}

export function PurchasesView() {
  const { db, stock } = useStore();
  const sizes = useSizes();
  const r = useDateRange(30);
  const [open, setOpen] = React.useState(false);
  const invoices = db.invoices.filter((i) => i.kind === "purchase" && r.inRange(i.date)).sort((a, b) => b.ts.localeCompare(a.ts));
  return (
    <>
      <PageHeader title="Stock receipts from plant" description="Full cylinders received from the Bharat Gas plant, and empties sent back. Each receipt is a purchase invoice with GST."
        actions={<><ExportButton onClick={() => exportInvoices(`purchases_${r.from}_${r.to}.csv`, invoices)} /><Button onClick={() => setOpen(true)}><Plus /> Record receipt</Button></>} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {sizes.map((s) => (
          <Card key={s.id} className="gap-1 py-3">
            <CardContent className="px-4">
              <p className="text-sm text-muted-foreground">{s.label} at warehouse</p>
              <p className="text-sm"><b className="text-lg tabular-nums">{locQty(stock, WH, s.id, "full")}</b> full · <b className="tabular-nums">{locQty(stock, WH, s.id, "empty")}</b> empty</p>
              <p className="text-xs text-muted-foreground">{locQty(stock, WH, s.id, "defective")} defective · {locQty(stock, WH, s.id, "testing")} due for testing</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader><DateRange from={r.from} to={r.to} onChange={r.set} /></CardHeader>
        <CardContent><InvoiceTable invoices={invoices} kind="purchase" /></CardContent>
      </Card>
      <NewPurchaseDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function NewPurchaseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { db, stock, act } = useStore();
  const sizes = useSizes();
  const actor = useActorId();
  const [plantId, setPlantId] = React.useState("pl1");
  const [full, setFull] = React.useState<SizeQty>({});
  const [empties, setEmpties] = React.useState<SizeQty>({});
  const [defective, setDefective] = React.useState<SizeQty>({});
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset form when dialog opens
    if (open) { setFull({}); setEmpties({}); setDefective({}); setPlantId("pl1"); }
  }, [open]);
  const plant = db.plants.find((p) => p.id === plantId)!;
  const interstate = plant.state !== db.settings.homeState;
  const lines: InvoiceLine[] = sizes.filter((s) => (full[s.id] ?? 0) > 0).map((s) => ({ size: s.id, qty: full[s.id], emptiesReturned: empties[s.id] ?? 0, rate: s.purchasePrice, gstRate: s.purchaseGst }));
  const totals = computeTotals(lines, interstate);
  const bad = sizes.some((s) => (empties[s.id] ?? 0) > locQty(stock, WH, s.id, "empty") || (defective[s.id] ?? 0) > locQty(stock, WH, s.id, "defective"));
  const any = Object.values(full).some((q) => q > 0) || Object.values(empties).some((q) => q > 0);

  const save = () => {
    const clean = (q: SizeQty) => Object.fromEntries(Object.entries(q).filter(([, n]) => n > 0));
    const ok = act((d) => { createPurchase(d, { date: dayKey(), ts: new Date().toISOString(), plantId, full: clean(full), emptiesBack: clean(empties), defectiveBack: clean(defective), userId: actor, source: "app" }); }, "Stock receipt saved. Warehouse stock updated.");
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Record stock receipt</DialogTitle>
          <DialogDescription>Full cylinders come in from the plant; empties and defective cylinders go back on the same trip.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Plant</Label>
            <Select value={plantId} onValueChange={setPlantId}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{db.plants.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.state})</SelectItem>)}</SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{interstate ? "Interstate supply: IGST applies." : "Within Karnataka: CGST + SGST (half each)."}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-muted-foreground"><tr><th className="py-1 text-left font-medium">Size</th><th className="py-1 text-left font-medium">Full received</th><th className="py-1 text-left font-medium">Empties sent back</th><th className="py-1 text-left font-medium">Defective sent back</th></tr></thead>
              <tbody>
                {sizes.map((s) => (
                  <tr key={s.id} className="border-t">
                    <td className="py-2 pr-2"><div className="font-medium">{s.label}</div><div className="text-xs text-muted-foreground">{rupees(s.purchasePrice)} · {s.purchaseGst}%</div></td>
                    <td className="py-2 pr-2"><Stepper value={full[s.id] ?? 0} onChange={(n) => setFull({ ...full, [s.id]: n })} label={`${s.label} full`} /></td>
                    <td className="py-2 pr-2"><Stepper value={empties[s.id] ?? 0} max={locQty(stock, WH, s.id, "empty")} onChange={(n) => setEmpties({ ...empties, [s.id]: n })} label={`${s.label} empties`} /><div className="text-xs text-muted-foreground">{locQty(stock, WH, s.id, "empty")} in stock</div></td>
                    <td className="py-2"><Stepper value={defective[s.id] ?? 0} max={locQty(stock, WH, s.id, "defective")} onChange={(n) => setDefective({ ...defective, [s.id]: n })} label={`${s.label} defective`} /><div className="text-xs text-muted-foreground">{locQty(stock, WH, s.id, "defective")} in stock</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/60 p-3 text-sm sm:grid-cols-5">
            <div><p className="text-muted-foreground">Taxable</p><p className="font-medium tabular-nums">{rupees(totals.taxable, true)}</p></div>
            <div><p className="text-muted-foreground">CGST</p><p className="font-medium tabular-nums">{rupees(totals.cgst, true)}</p></div>
            <div><p className="text-muted-foreground">SGST</p><p className="font-medium tabular-nums">{rupees(totals.sgst, true)}</p></div>
            <div><p className="text-muted-foreground">IGST</p><p className="font-medium tabular-nums">{rupees(totals.igst, true)}</p></div>
            <div><p className="text-muted-foreground">Total</p><p className="font-semibold tabular-nums">{rupees(totals.total, true)}</p></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={!any || bad}><Factory /> Save receipt</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- single invoice (printable) ----------

export function InvoiceView({ id }: { id: string }) {
  const { db, role, user } = useStore();
  const L = useLookups();
  const inv = db.invoices.find((i) => i.id === id);
  if (!inv || (role === "customer" && inv.partyId !== user?.customerId)) return <EmptyState title="Invoice not found" />;
  const s = db.settings;
  const c = inv.kind === "sale" ? L.customer.get(inv.partyId) : undefined;
  const seller = inv.kind === "sale" ? { name: s.agencyName, gstin: s.agencyGstin, address: s.agencyAddress, state: s.homeState } : (() => { const p = db.plants.find((x) => x.id === inv.partyId)!; return { name: p.name, gstin: p.gstin, address: p.state, state: p.state }; })();
  const buyer = inv.kind === "sale" ? { name: c ? custName(c) : inv.partyName, gstin: inv.partyGstin, address: c?.address ?? "", state: inv.placeOfSupply } : { name: s.agencyName, gstin: s.agencyGstin, address: s.agencyAddress, state: s.homeState };
  const delivery = inv.deliveryId ? db.deliveries.find((d) => d.id === inv.deliveryId) : undefined;
  const backHref = role === "customer" ? "/me/invoices" : inv.kind === "sale" ? "/sales" : "/purchases";

  return (
    <>
      <div className="no-print mb-4 flex items-center justify-between gap-2">
        <Button variant="ghost" asChild><Link href={backHref}><ArrowLeft /> Back</Link></Button>
        <Button variant="outline" onClick={() => window.print()}><Printer /> Print</Button>
      </div>
      <Card className="mx-auto max-w-4xl gap-0 py-0">
        <CardContent className="space-y-6 p-5 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
            <div>
              <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">Tax invoice · {inv.kind === "sale" ? "Sales" : "Purchase"}</p>
              <h1 className="mt-1 text-2xl font-semibold">{inv.no}</h1>
              <p className="text-sm text-muted-foreground">{fmtDate(inv.date)} {sourceBadge(inv.source)}</p>
            </div>
            <div className="text-right text-sm">
              <p className="font-semibold">{seller.name}</p>
              <p className="max-w-xs text-muted-foreground">{seller.address}</p>
              <p>GSTIN {seller.gstin}</p>
            </div>
          </div>
          <div className="grid gap-4 text-sm sm:grid-cols-3">
            <div><p className="text-muted-foreground">Billed to</p><p className="font-medium">{buyer.name}</p><p className="text-muted-foreground">{buyer.address}</p>{buyer.gstin ? <p>GSTIN {buyer.gstin}</p> : <p className="text-muted-foreground">Unregistered (B2C)</p>}</div>
            <div><p className="text-muted-foreground">Place of supply</p><p className="font-medium">{buyer.state}</p><p className="text-muted-foreground">{inv.interstate ? "Interstate: IGST" : "Intrastate: CGST + SGST"}</p></div>
            {delivery && <div><p className="text-muted-foreground">Against delivery</p><p className="font-medium">{delivery.no}</p><p className="text-muted-foreground">{fmtDateTime(delivery.ts)} · {L.driver.get(delivery.driverId)?.name}</p></div>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-y bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 text-left font-medium">Description</th>
                  <th className="px-2 py-2 text-left font-medium">HSN</th>
                  <th className="px-2 py-2 text-right font-medium">Qty</th>
                  <th className="px-2 py-2 text-right font-medium">Rate (excl. GST)</th>
                  <th className="px-2 py-2 text-right font-medium">Taxable</th>
                  {inv.interstate ? <th className="px-2 py-2 text-right font-medium">IGST</th> : <><th className="px-2 py-2 text-right font-medium">CGST</th><th className="px-2 py-2 text-right font-medium">SGST</th></>}
                  <th className="px-2 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {inv.lines.map((l, k) => {
                  const b = lineBreakup(l, inv.interstate);
                  const size = L.size.get(l.size);
                  return (
                    <tr key={k} className="border-b">
                      <td className="px-2 py-2"><p className="font-medium">LPG refill {size?.label ?? `${l.size} kg`}</p><p className="text-xs text-muted-foreground">{inv.kind === "sale" ? "Empties returned" : "Empties sent to plant"}: {l.emptiesReturned}</p></td>
                      <td className="px-2 py-2">{db.settings.hsnCode}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{l.qty}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{rupees(b.unitBase, true)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{rupees(b.taxable, true)}</td>
                      {inv.interstate ? <td className="px-2 py-2 text-right tabular-nums">{rupees(b.igst, true)}<span className="block text-xs text-muted-foreground">{l.gstRate}%</span></td> : <>
                        <td className="px-2 py-2 text-right tabular-nums">{rupees(b.cgst, true)}<span className="block text-xs text-muted-foreground">{l.gstRate / 2}%</span></td>
                        <td className="px-2 py-2 text-right tabular-nums">{rupees(b.sgst, true)}<span className="block text-xs text-muted-foreground">{l.gstRate / 2}%</span></td>
                      </>}
                      <td className="px-2 py-2 text-right font-medium tabular-nums">{rupees(b.total, true)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:justify-between">
            <p className="max-w-sm text-sm text-muted-foreground"><span className="font-medium text-foreground">Amount in words:</span> {amountInWords(inv.total)}</p>
            <dl className="grid min-w-[240px] grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Taxable value</dt><dd className="text-right tabular-nums">{rupees(inv.taxable, true)}</dd>
              {inv.interstate ? <><dt className="text-muted-foreground">IGST</dt><dd className="text-right tabular-nums">{rupees(inv.igst, true)}</dd></> : <>
                <dt className="text-muted-foreground">CGST</dt><dd className="text-right tabular-nums">{rupees(inv.cgst, true)}</dd>
                <dt className="text-muted-foreground">SGST</dt><dd className="text-right tabular-nums">{rupees(inv.sgst, true)}</dd>
              </>}
              <dt className="border-t pt-1 font-semibold">Total</dt><dd className="border-t pt-1 text-right font-semibold tabular-nums">{rupees(inv.total, true)}</dd>
            </dl>
          </div>
          <p className="border-t pt-4 text-xs text-muted-foreground">Demo invoice generated by {db.settings.agencyName} app. Prices are GST inclusive; tax shown is back-calculated.</p>
        </CardContent>
      </Card>
    </>
  );
}

export function CustomerInvoicesTable({ customerId }: { customerId: string }) {
  const { db } = useStore();
  const invoices = db.invoices.filter((i) => i.kind === "sale" && i.partyId === customerId).sort((a, b) => b.ts.localeCompare(a.ts));
  return (
    <Card>
      <CardHeader><CardTitle>Invoices</CardTitle><CardDescription>GST breakup per invoice. Tap to open.</CardDescription></CardHeader>
      <CardContent><InvoiceTable invoices={invoices} kind="sale" /></CardContent>
    </Card>
  );
}
