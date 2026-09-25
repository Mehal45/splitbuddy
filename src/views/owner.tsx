"use client";

import * as React from "react";
import { AlertTriangle, ClipboardCheck, CreditCard, IndianRupee, MapPinOff, PackageX, Scale, TrendingUp, Truck } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateRange, EmptyState, PageHeader, SectionTitle, StatCard, useDateRange } from "@/components/app/common";
import { custName, dayKey, fmtDateShort, rupees, rupeesShort } from "@/lib/format";
import { Link, navigate } from "@/lib/router";
import { ALERT_LABEL, driverPerformance, salesByDay, salesTotals, stockFlowByDay, type Alert, type AlertKind } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { useUiStyle } from "@/lib/ui-style";
import { cn } from "@/lib/utils";
import { StockGrid } from "./stock";

const ALERT_ICON: Record<AlertKind, React.ElementType> = { lowStock: PackageX, empties: AlertTriangle, credit: CreditCard, pending: ClipboardCheck, mismatch: Scale, gps: MapPinOff };

export function AlertRow({ a }: { a: Alert }) {
  const Icon = ALERT_ICON[a.kind];
  return (
    <Link href={a.href} className="flex items-start gap-3 rounded-md border p-3 transition-colors hover:bg-accent/50">
      <div className={cn("rounded-md p-1.5", a.severity === "high" ? "bg-destructive/10 text-destructive" : "bg-warning/15 text-warning-foreground")}><Icon className="size-4" /></div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{a.title}</p>
        <p className="text-xs text-muted-foreground">{a.detail}</p>
      </div>
      <Badge variant={a.severity === "high" ? "destructive" : "warning"} className="shrink-0">{ALERT_LABEL[a.kind]}</Badge>
    </Link>
  );
}

function ChartTooltip({ active, payload, label, money }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; money?: boolean }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{label ? fmtDateShort(label) : ""}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2"><span className="inline-block size-2.5 rounded-sm" style={{ background: p.color }} />{p.name}: <b className="tabular-nums">{money ? rupees(p.value) : p.value}</b></p>
      ))}
    </div>
  );
}

const axisProps = { stroke: "var(--muted-foreground)", fontSize: 11, tickLine: false, axisLine: false } as const;

export function OwnerDashboard() {
  const { db, balances, alerts, now, user } = useStore();
  const studio = useUiStyle() === "studio";
  const today = dayKey();
  const todays = db.deliveries.filter((d) => d.date === today && d.status !== "rejected");
  const pending = db.deliveries.filter((d) => d.status === "pending").length;
  const sales = salesTotals(db, now);
  const outstanding = Object.values(balances).reduce((s, b) => s + Math.max(0, b.outstanding), 0);
  const sales30 = React.useMemo(() => salesByDay(db, 30, now), [db, now]);
  const flow = React.useMemo(() => {
    // 7-day rolling average: plant trips run every other day, raw daily values zigzag
    const raw = stockFlowByDay(db, 36, now);
    return raw.slice(6).map((row, i) => {
      const win = raw.slice(i, i + 7);
      return { date: row.date, received: Math.round(win.reduce((s, x) => s + x.received, 0) / 7), delivered: Math.round(win.reduce((s, x) => s + x.delivered, 0) / 7) };
    });
  }, [db, now]);
  const topDues = db.customers.map((c) => ({ c, b: balances[c.id] })).filter((x) => x.b.outstanding > 0).sort((a, b) => b.b.outstanding - a.b.outstanding).slice(0, 6);
  const topEmpties = db.customers.map((c) => ({ c, b: balances[c.id] })).filter((x) => x.b.excessEmpties > 0).sort((a, b) => b.b.excessEmpties - a.b.excessEmpties).slice(0, 6);

  return (
    <>
      <PageHeader title={`Good day, ${user?.name.split(" ")[0]}`} description={`Business overview · ${new Date(now).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" })}`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Today's deliveries" value={todays.length} hint={`${todays.reduce((s, d) => s + Object.values(d.full).reduce((a, b) => a + b, 0), 0)} cylinders`} icon={Truck} onClick={() => navigate("/approvals")} />
        <StatCard label="Pending approvals" value={pending} icon={ClipboardCheck} tone={pending ? "warning" : "success"} onClick={() => navigate("/approvals")} />
        <StatCard label="Sales today" value={rupeesShort(sales.today)} icon={IndianRupee} onClick={() => navigate("/sales")} highlight />
        <StatCard label="Sales this month" value={rupeesShort(sales.month)} icon={TrendingUp} onClick={() => navigate("/reports")} />
        <StatCard label="Outstanding credit" value={rupeesShort(outstanding)} hint={`${db.customers.filter((c) => c.creditLimit > 0 && balances[c.id].outstanding > c.creditLimit).length} over limit`} icon={CreditCard} tone="danger" onClick={() => navigate("/customers")} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="min-w-0 xl:col-span-2">
          <CardHeader className="flex items-center justify-between"><div><CardTitle>Alerts</CardTitle><CardDescription className="mt-1">{alerts.length} things need attention</CardDescription></div><Button variant="outline" size="sm" asChild><Link href="/alerts">View all</Link></Button></CardHeader>
          <CardContent className="grid max-h-[360px] gap-2 overflow-y-auto">
            {alerts.length === 0 ? <EmptyState title="No alerts" /> : alerts.map((a) => <AlertRow key={a.id} a={a} />)}
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader><CardTitle>Top dues</CardTitle><CardDescription>Highest outstanding amounts</CardDescription></CardHeader>
          <CardContent className="grid gap-2">
            {topDues.map(({ c, b }) => {
              const over = c.creditLimit > 0 && b.outstanding > c.creditLimit;
              return (
                <Link key={c.id} href={`/customers/${c.id}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50">
                  <span className="min-w-0 truncate">{custName(c)}{over && <Badge variant="destructive" className="ml-1.5">Over limit</Badge>}</span>
                  <span className={cn("shrink-0 font-medium tabular-nums", over && "text-destructive")}>{rupees(b.outstanding)}</span>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <SectionTitle className="mt-8">Stock across locations</SectionTitle>
      <StockGrid />

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Sales, last 30 days</CardTitle><CardDescription>Invoice value per day (GST inclusive)</CardDescription></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sales30} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="date" {...axisProps} tickFormatter={(d) => fmtDateShort(d)} minTickGap={24} />
                <YAxis {...axisProps} width={48} tickFormatter={(v: number) => (v >= 1e5 ? `₹${+(v / 1e5).toFixed(1)}L` : v >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`)} />
                <Tooltip content={<ChartTooltip money />} cursor={{ fill: "var(--muted)" }} />
                <Bar dataKey="total" name="Sales" fill="var(--chart-1)" radius={studio ? [8, 8, 8, 8] : [4, 4, 0, 0]} maxBarSize={studio ? 22 : 18} background={studio ? { fill: "var(--bar-track)", radius: 8 } : undefined} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Stock movement, last 30 days</CardTitle><CardDescription>Full cylinders per day, 7-day average: received from plant vs delivered to customers</CardDescription></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={flow} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="date" {...axisProps} tickFormatter={(d) => fmtDateShort(d)} minTickGap={24} />
                <YAxis {...axisProps} width={40} />
                <Tooltip content={<ChartTooltip />} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="received" name="Received from plant" stroke="var(--chart-1)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="delivered" name="Delivered to customers" stroke="var(--chart-2)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Top customers by unreturned empties</CardTitle><CardDescription>Cylinders held above security deposit</CardDescription></CardHeader>
          <CardContent>
            {topEmpties.length === 0 ? <EmptyState title="Everyone is within deposit" /> : (
              <Table>
                <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Area</TableHead><TableHead className="text-right">Excess empties</TableHead></TableRow></TableHeader>
                <TableBody>
                  {topEmpties.map(({ c, b }) => (
                    <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate(`/customers/${c.id}`)}>
                      <TableCell className="font-medium">{custName(c)}</TableCell>
                      <TableCell>{c.area}</TableCell>
                      <TableCell className={cn("text-right font-semibold tabular-nums", b.excessEmpties > db.settings.emptiesTolerance && "text-destructive")}>{b.excessEmpties}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Today by truck</CardTitle><CardDescription>Deliveries and collections</CardDescription></CardHeader>
          <CardContent>
            <TodayByTruck />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function TodayByTruck() {
  const { db } = useStore();
  const today = dayKey();
  const trucks = [...new Set(db.loadSheets.filter((l) => l.date === today).map((l) => l.truckId))];
  if (!trucks.length) return <EmptyState title="No trucks out today" />;
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Truck</TableHead><TableHead>Driver</TableHead><TableHead className="text-right">Deliveries</TableHead><TableHead className="text-right">Collected</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
      <TableBody>
        {trucks.map((t) => {
          const ds = db.deliveries.filter((d) => d.truckId === t && d.date === today && d.status !== "rejected");
          const rec = db.reconciliations.find((r) => r.truckId === t && r.date === today);
          return (
            <TableRow key={t}>
              <TableCell className="font-medium">{db.trucks.find((x) => x.id === t)?.regNo}</TableCell>
              <TableCell>{db.drivers.find((d) => d.truckId === t)?.name}</TableCell>
              <TableCell className="text-right tabular-nums">{ds.length}</TableCell>
              <TableCell className="text-right tabular-nums">{rupees(ds.reduce((s, d) => s + (d.payment?.amount ?? 0), 0))}</TableCell>
              <TableCell>{rec ? (rec.mismatch ? <Badge variant="destructive">Mismatch</Badge> : <Badge variant="success">Returned</Badge>) : <Badge variant="outline">On road</Badge>}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function AlertsView() {
  const { alerts, db } = useStore();
  const [kind, setKind] = React.useState<AlertKind | "all">("all");
  const kinds = Object.keys(ALERT_LABEL) as AlertKind[];
  const list = alerts.filter((a) => kind === "all" || a.kind === kind);
  const s = db.settings;
  return (
    <>
      <PageHeader title="Alerts" description="Thresholds can be changed in Settings." actions={<Button variant="outline" asChild><Link href="/settings">Alert settings</Link></Button>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Button size="sm" variant={kind === "all" ? "default" : "outline"} onClick={() => setKind("all")}>All ({alerts.length})</Button>
        {kinds.map((k) => <Button key={k} size="sm" variant={kind === k ? "default" : "outline"} onClick={() => setKind(k)}>{ALERT_LABEL[k]} ({alerts.filter((a) => a.kind === k).length})</Button>)}
      </div>
      <div className="grid gap-2">{list.length ? list.map((a) => <AlertRow key={a.id} a={a} />) : <EmptyState title="No alerts of this type" />}</div>
      <Card className="mt-6">
        <CardHeader><CardTitle>Current rules</CardTitle></CardHeader>
        <CardContent className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
          <p>Low stock: {s.sizes.filter((x) => x.active).map((x) => `${x.label} < ${x.lowStockThreshold}`).join(", ")}</p>
          <p>Unreturned empties: more than {s.emptiesTolerance} above security deposit</p>
          <p>Over credit limit: outstanding above the customer&apos;s limit</p>
          <p>Approval overdue: pending more than {s.pendingApprovalHours} hours</p>
          <p>Truck mismatch: end-of-day count differs from expected (today)</p>
          <p>GPS: delivery logged more than {s.gpsMaxDistanceKm * 1000} m from customer (last 7 days)</p>
        </CardContent>
      </Card>
    </>
  );
}

export function FleetView() {
  const { db } = useStore();
  const r = useDateRange(30);
  const perf = driverPerformance(db, r.from, r.to);
  return (
    <>
      <PageHeader title="Trucks & drivers" description="12 trucks and drivers, with performance for the selected period." />
      <Card>
        <CardHeader><DateRange from={r.from} to={r.to} onChange={r.set} /></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Driver</TableHead><TableHead>Truck</TableHead>
                <TableHead className="text-right">Days out</TableHead><TableHead className="text-right">Deliveries</TableHead><TableHead className="text-right">Cylinders</TableHead>
                <TableHead className="text-right">Rejected</TableHead><TableHead className="text-right">EOD mismatches</TableHead><TableHead className="text-right">GPS far</TableHead><TableHead className="text-right">Collected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {perf.map((p) => {
                const t = db.trucks.find((x) => x.id === p.driver.truckId)!;
                return (
                  <TableRow key={p.driver.id}>
                    <TableCell><p className="font-medium">{p.driver.name}</p><p className="text-xs text-muted-foreground">{p.driver.phone} · DL {p.driver.licenseNo}</p></TableCell>
                    <TableCell><p>{t.regNo}</p><p className="text-xs text-muted-foreground">{t.model} · {t.capacity} cyl.</p></TableCell>
                    <TableCell className="text-right tabular-nums">{p.days}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.deliveries}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.cylinders}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", p.rejected > 1 && "text-warning-foreground font-medium")}>{p.rejected}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", p.mismatches > 0 && "font-semibold text-destructive")}>{p.mismatches}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", p.gpsFar > 0 && "text-warning-foreground font-medium")}>{p.gpsFar}</TableCell>
                    <TableCell className="text-right tabular-nums">{rupees(p.collected)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
