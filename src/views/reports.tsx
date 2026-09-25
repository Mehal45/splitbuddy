"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateRange, downloadCSV, EmptyState, ExportButton, PageHeader, useDateRange } from "@/components/app/common";
import { computeStock, locQty, WH } from "@/lib/engine";
import { custName, fmtDate, fmtMonth, rupees } from "@/lib/format";
import { lineBreakup, round2 } from "@/lib/gst";
import { useSizes } from "@/lib/hooks";
import { driverPerformance } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { CYL_STATES, STATE_LABEL, type Invoice } from "@/lib/types";
import { cn } from "@/lib/utils";

const dayStart = (d: string) => new Date(`${d}T00:00:00+05:30`).toISOString();
const dayEnd = (d: string) => new Date(`${d}T23:59:59.999+05:30`).toISOString();
const R = (n: number) => rupees(n, true);

function ReportCard({ title, description, onExport, children, range, extra }: {
  title: string; description: string; onExport: () => void; children: React.ReactNode; range: ReturnType<typeof useDateRange>; extra?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><CardTitle>{title}</CardTitle><CardDescription className="mt-1">{description}</CardDescription></div>
          <ExportButton onClick={onExport} />
        </div>
        <div className="flex flex-wrap items-end gap-3"><DateRange from={range.from} to={range.to} onChange={range.set} />{extra}</div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function StockReport() {
  const { db } = useStore();
  const sizes = useSizes();
  const r = useDateRange(30);
  const open = React.useMemo(() => computeStock(db.movements.filter((m) => m.ts < dayStart(r.from))), [db.movements, r.from]);
  const close = React.useMemo(() => computeStock(db.movements, dayEnd(r.to)), [db.movements, r.to]);
  const inRange = db.movements.filter((m) => m.ts >= dayStart(r.from) && m.ts <= dayEnd(r.to));
  const sum = (size: string, f: (m: (typeof inRange)[number]) => boolean) => inRange.filter((m) => m.size === size && f(m)).reduce((s, m) => s + m.qty, 0);
  const rows = sizes.map((s) => ({
    s,
    openFull: locQty(open, WH, s.id, "full"), openEmpty: locQty(open, WH, s.id, "empty"),
    received: sum(s.id, (m) => m.from === "PLANT" && m.to === WH),
    loaded: sum(s.id, (m) => m.refType === "load"),
    delivered: sum(s.id, (m) => m.state === "full" && m.to.startsWith("CUST:")) - sum(s.id, (m) => m.refType === "reversal" && m.state === "full"),
    collected: sum(s.id, (m) => m.state === "empty" && m.from.startsWith("CUST:")) - sum(s.id, (m) => m.refType === "reversal" && m.state === "empty"),
    toPlant: sum(s.id, (m) => m.from === WH && m.to === "PLANT"),
    close: CYL_STATES.map((st) => locQty(close, WH, s.id, st)),
  }));
  const exportCsv = () => downloadCSV(`stock_report_${r.from}_${r.to}.csv`, [
    ["Size", "Opening full (WH)", "Opening empty (WH)", "Received from plant", "Loaded on trucks", "Delivered to customers", "Empties collected", "Sent to plant", ...CYL_STATES.map((st) => `Closing ${STATE_LABEL[st]} (WH)`)],
    ...rows.map((x) => [x.s.label, x.openFull, x.openEmpty, x.received, x.loaded, x.delivered, x.collected, x.toPlant, ...x.close]),
  ]);
  return (
    <ReportCard title="Stock report" description="Warehouse opening and closing balance with movements in the period. Closing columns: Full / Empty / Defective / Due for testing." onExport={exportCsv} range={r}>
      <Table>
        <TableHeader><TableRow>
          <TableHead>Size</TableHead><TableHead className="text-right">Opening full / empty</TableHead><TableHead className="text-right">Received from plant</TableHead><TableHead className="text-right">Loaded on trucks</TableHead>
          <TableHead className="text-right">Delivered</TableHead><TableHead className="text-right">Empties collected</TableHead><TableHead className="text-right">Sent to plant</TableHead><TableHead className="text-right">Closing F / E / D / T</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {rows.map((x) => (
            <TableRow key={x.s.id}>
              <TableCell className="font-medium">{x.s.label}</TableCell>
              <TableCell className="text-right tabular-nums">{x.openFull} / {x.openEmpty}</TableCell>
              <TableCell className="text-right tabular-nums">{x.received}</TableCell>
              <TableCell className="text-right tabular-nums">{x.loaded}</TableCell>
              <TableCell className="text-right tabular-nums">{x.delivered}</TableCell>
              <TableCell className="text-right tabular-nums">{x.collected}</TableCell>
              <TableCell className="text-right tabular-nums">{x.toPlant}</TableCell>
              <TableCell className="text-right tabular-nums">{x.close.join(" / ")}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ReportCard>
  );
}

function bySize(invoices: Invoice[], sizes: { id: string; label: string }[]) {
  return sizes.map((s) => {
    let qty = 0, empties = 0, taxable = 0, tax = 0, total = 0;
    for (const i of invoices) for (const l of i.lines) {
      if (l.size !== s.id) continue;
      const b = lineBreakup(l, i.interstate);
      qty += l.qty; empties += l.emptiesReturned; taxable += b.taxable; tax += b.cgst + b.sgst + b.igst; total += b.total;
    }
    return { s, qty, empties, taxable, tax, total };
  }).filter((x) => x.qty || x.empties);
}

function InvoiceSummary({ kind }: { kind: "sale" | "purchase" }) {
  const { db } = useStore();
  const sizes = useSizes();
  const r = useDateRange(30);
  const invoices = db.invoices.filter((i) => i.kind === kind && r.inRange(i.date));
  const rows = bySize(invoices, sizes);
  const t = rows.reduce((a, x) => ({ qty: a.qty + x.qty, empties: a.empties + x.empties, taxable: a.taxable + x.taxable, tax: a.tax + x.tax, total: a.total + x.total }), { qty: 0, empties: 0, taxable: 0, tax: 0, total: 0 });
  const byType = kind === "sale" ? (["domestic", "commercial"] as const).map((type) => {
    const inv = invoices.filter((i) => db.customers.find((c) => c.id === i.partyId)?.type === type);
    return { type, count: inv.length, taxable: inv.reduce((s, i) => s + i.taxable, 0), tax: inv.reduce((s, i) => s + i.cgst + i.sgst + i.igst, 0), total: inv.reduce((s, i) => s + i.total, 0) };
  }) : [];
  const exportCsv = () => downloadCSV(`${kind === "sale" ? "sales" : "purchase"}_report_${r.from}_${r.to}.csv`, [
    ["Invoice no", "Date", "Party", "GSTIN", "Interstate", "Size", "Qty", kind === "sale" ? "Empties returned" : "Empties sent", "Rate (incl GST)", "GST %", "Taxable", "CGST", "SGST", "IGST", "Total"],
    ...invoices.flatMap((i) => i.lines.map((l) => { const b = lineBreakup(l, i.interstate); return [i.no, i.date, i.partyName, i.partyGstin, i.interstate ? "Yes" : "No", l.size, l.qty, l.emptiesReturned, l.rate, l.gstRate, b.taxable, b.cgst, b.sgst, b.igst, b.total]; })),
  ]);
  return (
    <ReportCard title={kind === "sale" ? "Sales report" : "Purchase report"} description={`${invoices.length} invoices · ${kind === "sale" ? "deliveries to customers" : "cylinders received from Bharat Gas plant"}`} onExport={exportCsv} range={r}>
      {!rows.length ? <EmptyState title="No invoices in this period" /> : (
        <div className="space-y-6">
          <Table>
            <TableHeader><TableRow><TableHead>Size</TableHead><TableHead className="text-right">Cylinders</TableHead><TableHead className="text-right">{kind === "sale" ? "Empties returned" : "Empties sent"}</TableHead><TableHead className="text-right">Taxable</TableHead><TableHead className="text-right">GST</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
            <TableBody>{rows.map((x) => (
              <TableRow key={x.s.id}><TableCell className="font-medium">{x.s.label}</TableCell><TableCell className="text-right tabular-nums">{x.qty}</TableCell><TableCell className="text-right tabular-nums">{x.empties}</TableCell><TableCell className="text-right tabular-nums">{R(x.taxable)}</TableCell><TableCell className="text-right tabular-nums">{R(x.tax)}</TableCell><TableCell className="text-right tabular-nums">{R(x.total)}</TableCell></TableRow>
            ))}</TableBody>
            <TableFooter><TableRow><TableCell>Total</TableCell><TableCell className="text-right tabular-nums">{t.qty}</TableCell><TableCell className="text-right tabular-nums">{t.empties}</TableCell><TableCell className="text-right tabular-nums">{R(t.taxable)}</TableCell><TableCell className="text-right tabular-nums">{R(t.tax)}</TableCell><TableCell className="text-right tabular-nums">{R(t.total)}</TableCell></TableRow></TableFooter>
          </Table>
          {kind === "sale" && (
            <Table>
              <TableHeader><TableRow><TableHead>Customer type</TableHead><TableHead className="text-right">Invoices</TableHead><TableHead className="text-right">Taxable</TableHead><TableHead className="text-right">GST</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>{byType.map((x) => (
                <TableRow key={x.type}><TableCell>{x.type === "domestic" ? "Domestic (5%)" : "Commercial (18%)"}</TableCell><TableCell className="text-right tabular-nums">{x.count}</TableCell><TableCell className="text-right tabular-nums">{R(x.taxable)}</TableCell><TableCell className="text-right tabular-nums">{R(x.tax)}</TableCell><TableCell className="text-right tabular-nums">{R(x.total)}</TableCell></TableRow>
              ))}</TableBody>
            </Table>
          )}
        </div>
      )}
    </ReportCard>
  );
}

function GstSummary() {
  const { db } = useStore();
  const r = useDateRange(60);
  const months = new Map<string, { out: number[]; inp: number[] }>();
  for (const i of db.invoices) {
    if (!r.inRange(i.date)) continue;
    const m = i.date.slice(0, 7);
    const row = months.get(m) ?? { out: [0, 0, 0, 0], inp: [0, 0, 0, 0] };
    const arr = i.kind === "sale" ? row.out : row.inp;
    arr[0] += i.taxable; arr[1] += i.cgst; arr[2] += i.sgst; arr[3] += i.igst;
    months.set(m, row);
  }
  const rows = [...months.entries()].sort(([a], [b]) => a.localeCompare(b));
  const exportCsv = () => downloadCSV(`gst_summary_${r.from}_${r.to}.csv`, [
    ["Month", "Output taxable", "Output CGST", "Output SGST", "Output IGST", "Input taxable", "Input CGST", "Input SGST", "Input IGST", "Net GST payable"],
    ...rows.map(([m, x]) => [fmtMonth(m), ...x.out.map(round2), ...x.inp.map(round2), round2(x.out[1] + x.out[2] + x.out[3] - x.inp[1] - x.inp[2] - x.inp[3])]),
  ]);
  return (
    <ReportCard title="GST summary" description={`HSN ${db.settings.hsnCode} · output tax on sales vs input tax credit on purchases, by month`} onExport={exportCsv} range={r}>
      <Table>
        <TableHeader>
          <TableRow><TableHead rowSpan={2}>Month</TableHead><TableHead colSpan={4} className="text-center">Output (sales)</TableHead><TableHead colSpan={4} className="text-center">Input (purchases)</TableHead><TableHead rowSpan={2} className="text-right">Net payable</TableHead></TableRow>
          <TableRow>{["Taxable", "CGST", "SGST", "IGST", "Taxable", "CGST", "SGST", "IGST"].map((h, i) => <TableHead key={i} className="text-right">{h}</TableHead>)}</TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(([m, x]) => {
            const net = x.out[1] + x.out[2] + x.out[3] - x.inp[1] - x.inp[2] - x.inp[3];
            return (
              <TableRow key={m}>
                <TableCell className="font-medium">{fmtMonth(m)}</TableCell>
                {[...x.out, ...x.inp].map((v, i) => <TableCell key={i} className="text-right tabular-nums">{R(v)}</TableCell>)}
                <TableCell className={cn("text-right font-semibold tabular-nums", net < 0 && "text-success")}>{R(net)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="mt-3 text-xs text-muted-foreground">Negative net means input credit exceeds output tax for that month (carried forward).</p>
    </ReportCard>
  );
}

function CustomerLedger() {
  const { db } = useStore();
  const r = useDateRange(60);
  const [cid, setCid] = React.useState(db.customers[0].id);
  const c = db.customers.find((x) => x.id === cid)!;
  const sales = db.invoices.filter((i) => i.kind === "sale" && i.partyId === cid);
  const pays = db.payments.filter((p) => p.customerId === cid);
  const opening = c.openingOutstanding + sales.filter((i) => i.date < r.from).reduce((s, i) => s + i.total, 0) - pays.filter((p) => p.date < r.from).reduce((s, p) => s + p.amount, 0);
  const entries = [
    ...sales.filter((i) => r.inRange(i.date)).map((i) => ({ ts: i.ts, date: i.date, particulars: `Sales invoice ${i.no}`, debit: i.total, credit: 0 })),
    ...pays.filter((p) => r.inRange(p.date)).map((p) => ({ ts: p.ts, date: p.date, particulars: `Payment ${p.mode.toUpperCase()}${p.ref ? ` · ${p.ref}` : ""}`, debit: 0, credit: p.amount })),
  ].sort((a, b) => a.ts.localeCompare(b.ts));
  const rows = entries.reduce<((typeof entries)[number] & { balance: number })[]>((acc, e) => {
    const prev = acc.length ? acc[acc.length - 1].balance : opening;
    acc.push({ ...e, balance: prev + e.debit - e.credit });
    return acc;
  }, []);
  const bal = rows.length ? rows[rows.length - 1].balance : opening;
  const exportCsv = () => downloadCSV(`ledger_${c.code}_${r.from}_${r.to}.csv`, [
    ["Date", "Particulars", "Debit", "Credit", "Balance"], [r.from, "Opening balance", "", "", round2(opening)],
    ...rows.map((e) => [e.date, e.particulars, e.debit || "", e.credit || "", round2(e.balance)]), [r.to, "Closing balance", "", "", round2(bal)],
  ]);
  return (
    <ReportCard title="Customer ledger" description="Invoices (debit) and payments (credit) with running balance." onExport={exportCsv} range={r}
      extra={<div className="grid gap-1"><Label className="text-xs text-muted-foreground">Customer</Label>
        <Select value={cid} onValueChange={setCid}><SelectTrigger size="sm" className="w-64"><SelectValue /></SelectTrigger><SelectContent>{db.customers.map((x) => <SelectItem key={x.id} value={x.id}>{custName(x)}</SelectItem>)}</SelectContent></Select></div>}>
      <Table>
        <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Particulars</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader>
        <TableBody>
          <TableRow className="bg-muted/40"><TableCell>{fmtDate(r.from)}</TableCell><TableCell className="font-medium">Opening balance</TableCell><TableCell /><TableCell /><TableCell className="text-right font-medium tabular-nums">{R(opening)}</TableCell></TableRow>
          {rows.map((e, k) => (
            <TableRow key={k}><TableCell>{fmtDate(e.date)}</TableCell><TableCell>{e.particulars}</TableCell><TableCell className="text-right tabular-nums">{e.debit ? R(e.debit) : ""}</TableCell><TableCell className="text-right tabular-nums text-success">{e.credit ? R(e.credit) : ""}</TableCell><TableCell className="text-right tabular-nums">{R(e.balance)}</TableCell></TableRow>
          ))}
        </TableBody>
        <TableFooter><TableRow><TableCell colSpan={4}>Closing balance</TableCell><TableCell className="text-right tabular-nums">{R(bal)}</TableCell></TableRow></TableFooter>
      </Table>
    </ReportCard>
  );
}

function DriverReport() {
  const { db } = useStore();
  const r = useDateRange(30);
  const perf = driverPerformance(db, r.from, r.to).sort((a, b) => b.cylinders - a.cylinders);
  const exportCsv = () => downloadCSV(`driver_performance_${r.from}_${r.to}.csv`, [
    ["Driver", "Truck", "Days out", "Deliveries", "Approved", "Rejected", "Cylinders delivered", "EOD mismatches", "GPS far", "Collected"],
    ...perf.map((p) => [p.driver.name, db.trucks.find((t) => t.id === p.driver.truckId)?.regNo, p.days, p.deliveries, p.approved, p.rejected, p.cylinders, p.mismatches, p.gpsFar, p.collected]),
  ]);
  return (
    <ReportCard title="Driver performance" description="Deliveries, rejections, end-of-day mismatches and collections." onExport={exportCsv} range={r}>
      <Table>
        <TableHeader><TableRow><TableHead>Driver</TableHead><TableHead className="text-right">Days</TableHead><TableHead className="text-right">Deliveries</TableHead><TableHead className="text-right">Cylinders</TableHead><TableHead className="text-right">Rejection rate</TableHead><TableHead className="text-right">Mismatches</TableHead><TableHead className="text-right">GPS far</TableHead><TableHead className="text-right">Collected</TableHead></TableRow></TableHeader>
        <TableBody>{perf.map((p) => (
          <TableRow key={p.driver.id}>
            <TableCell className="font-medium">{p.driver.name}</TableCell>
            <TableCell className="text-right tabular-nums">{p.days}</TableCell>
            <TableCell className="text-right tabular-nums">{p.deliveries}</TableCell>
            <TableCell className="text-right tabular-nums">{p.cylinders}</TableCell>
            <TableCell className="text-right tabular-nums">{(p.rejectRate * 100).toFixed(1)}%</TableCell>
            <TableCell className={cn("text-right tabular-nums", p.mismatches > 0 && "font-semibold text-destructive")}>{p.mismatches}</TableCell>
            <TableCell className="text-right tabular-nums">{p.gpsFar}</TableCell>
            <TableCell className="text-right tabular-nums">{rupees(p.collected)}</TableCell>
          </TableRow>
        ))}</TableBody>
      </Table>
    </ReportCard>
  );
}

export function ReportsView() {
  return (
    <>
      <PageHeader title="Reports" description="Every report has a date filter and CSV export (opens in Excel)." />
      <Tabs defaultValue="stock">
        <TabsList className="w-full justify-start sm:w-fit">
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="sales">Sales</TabsTrigger>
          <TabsTrigger value="purchase">Purchases</TabsTrigger>
          <TabsTrigger value="gst">GST summary</TabsTrigger>
          <TabsTrigger value="ledger">Customer ledger</TabsTrigger>
          <TabsTrigger value="drivers">Drivers</TabsTrigger>
        </TabsList>
        <TabsContent value="stock"><StockReport /></TabsContent>
        <TabsContent value="sales"><InvoiceSummary kind="sale" /></TabsContent>
        <TabsContent value="purchase"><InvoiceSummary kind="purchase" /></TabsContent>
        <TabsContent value="gst"><GstSummary /></TabsContent>
        <TabsContent value="ledger"><CustomerLedger /></TabsContent>
        <TabsContent value="drivers"><DriverReport /></TabsContent>
      </Tabs>
    </>
  );
}
