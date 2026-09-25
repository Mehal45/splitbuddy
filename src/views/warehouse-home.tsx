"use client";

import { AlertTriangle, ClipboardCheck, PackagePlus, Scale, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, SectionTitle, StatCard } from "@/components/app/common";
import { dayKey, fmtDate } from "@/lib/format";
import { Link, navigate } from "@/lib/router";
import { useStore } from "@/lib/store";
import { StockGrid } from "./stock";

export function WarehouseHome() {
  const { db, alerts, user } = useStore();
  const today = dayKey();
  const pending = db.deliveries.filter((d) => d.status === "pending").length;
  const trucksOut = new Set(db.loadSheets.filter((l) => l.date === today).map((l) => l.truckId)).size;
  const returned = db.reconciliations.filter((r) => r.date === today).length;
  const mismatches = db.reconciliations.filter((r) => r.date === today && r.mismatch).length;
  const opsAlerts = alerts.filter((a) => a.kind === "lowStock" || a.kind === "mismatch" || a.kind === "pending");

  return (
    <>
      <PageHeader title={`Good day, ${user?.name.split(" ")[0]}`} description={`Warehouse overview for ${fmtDate(today)}`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Pending approvals" value={pending} icon={ClipboardCheck} tone={pending ? "warning" : "success"} onClick={() => navigate("/approvals")} />
        <StatCard label="Trucks loaded today" value={trucksOut} icon={Truck} onClick={() => navigate("/loads")} />
        <StatCard label="Trucks returned" value={`${returned} / ${trucksOut}`} icon={Scale} onClick={() => navigate("/reconciliation")} />
        <StatCard label="Mismatches today" value={mismatches} icon={AlertTriangle} tone={mismatches ? "danger" : "success"} onClick={() => navigate("/reconciliation")} />
      </div>

      <div className="my-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Button size="xl" asChild><Link href="/loads"><Truck /> New load sheet</Link></Button>
        <Button size="xl" variant="outline" asChild><Link href="/approvals"><ClipboardCheck /> Review acknowledgements</Link></Button>
        <Button size="xl" variant="outline" asChild><Link href="/purchases"><PackagePlus /> Record plant receipt</Link></Button>
        <Button size="xl" variant="outline" asChild><Link href="/reconciliation"><Scale /> End of day counts</Link></Button>
      </div>

      {opsAlerts.length > 0 && (
        <Card className="mb-6 gap-3">
          <CardHeader><CardTitle>Needs attention</CardTitle><CardDescription>Stock and approval alerts</CardDescription></CardHeader>
          <CardContent className="grid gap-2">
            {opsAlerts.map((a) => (
              <Link key={a.id} href={a.href} className="flex items-start gap-3 rounded-md border p-3 hover:bg-accent/50">
                <AlertTriangle className={a.severity === "high" ? "mt-0.5 size-4 text-destructive" : "mt-0.5 size-4 text-warning-foreground"} />
                <div><p className="text-sm font-medium">{a.title}</p><p className="text-xs text-muted-foreground">{a.detail}</p></div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <SectionTitle>Stock</SectionTitle>
      <StockGrid />
    </>
  );
}
