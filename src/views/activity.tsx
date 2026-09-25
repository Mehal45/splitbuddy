"use client";

import * as React from "react";
import { ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateRange, downloadCSV, EmptyState, ExportButton, PageHeader, useDateRange } from "@/components/app/common";
import { ROLE_LABEL } from "@/components/app/shell";
import { dayKey, fmtDate, fmtTime } from "@/lib/format";
import { useLookups, useStore } from "@/lib/store";
import type { AuditAction } from "@/lib/types";
import { cn } from "@/lib/utils";

export const ACTION_LABEL: Record<AuditAction, string> = {
  login: "Signed in", login_failed: "Failed sign-in", logout: "Signed out", view_as: "Viewed as another role",
  delivery_submitted: "Delivery recorded", delivery_approved: "Delivery approved", delivery_rejected: "Delivery rejected",
  load_sheet: "Load sheet", reconciliation: "End-of-day count", purchase: "Plant receipt", payment: "Payment recorded",
  stock_state_change: "Stock state change", customer_added: "Customer added", customer_edited: "Customer edited",
  settings_changed: "Settings changed", tally_sync: "Tally sync", demo_reset: "Demo data reset",
};
const SENSITIVE: AuditAction[] = ["login_failed", "settings_changed", "customer_edited", "demo_reset", "delivery_rejected", "view_as"];

export function ActivityView() {
  const { db, now } = useStore();
  const L = useLookups();
  const r = useDateRange(7);
  const [action, setAction] = React.useState<AuditAction | "all">("all");
  const [who, setWho] = React.useState("all");
  const log = db.audit ?? [];
  const people = [...new Set(log.map((e) => e.userId))];
  const rows = log.filter((e) => {
    const d = dayKey(e.ts);
    return d >= r.from && d <= r.to && (action === "all" || e.action === action) && (who === "all" || e.userId === who);
  }).slice().reverse();
  const name = (id: string) => {
    if (id === "anonymous") return "Unknown person";
    const u = L.user.get(id);
    return u ? `${u.name} · ${ROLE_LABEL[u.role]}` : id;
  };
  const failed24h = log.filter((e) => e.action === "login_failed" && now - new Date(e.ts).getTime() < 864e5).length;

  return (
    <>
      <PageHeader title="Activity log" description="Who did what and when: sign-ins, approvals, payments, stock changes and settings."
        actions={<ExportButton onClick={() => downloadCSV(`activity_${r.from}_${r.to}.csv`, [["Date", "Time", "Who", "Action", "Details"], ...rows.map((e) => [fmtDate(e.ts), fmtTime(e.ts), name(e.userId), ACTION_LABEL[e.action], e.detail])])} />} />
      {failed24h > 0 && (
        <div role="alert" className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <ShieldAlert className="size-4 shrink-0" /> {failed24h} failed sign-in {failed24h === 1 ? "attempt" : "attempts"} in the last 24 hours.
        </div>
      )}
      <Card>
        <CardHeader className="gap-3">
          <DateRange from={r.from} to={r.to} onChange={r.set} />
          <div className="flex flex-wrap gap-2">
            <Select value={action} onValueChange={(v) => setAction(v as AuditAction | "all")}>
              <SelectTrigger size="sm" className="w-52" aria-label="Action"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All actions</SelectItem>{(Object.keys(ACTION_LABEL) as AuditAction[]).map((k) => <SelectItem key={k} value={k}>{ACTION_LABEL[k]}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={who} onValueChange={setWho}>
              <SelectTrigger size="sm" className="w-56" aria-label="Person"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">Everyone</SelectItem>{people.map((p) => <SelectItem key={p} value={p}>{name(p)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? <EmptyState title="No activity in this period" hint="Actions taken in the app appear here. The sample history before today isn't logged." /> : (
            <Table>
              <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Who</TableHead><TableHead>Action</TableHead><TableHead>Details</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.slice(0, 500).map((e) => (
                  <TableRow key={e.id} className={cn(e.action === "login_failed" && "bg-destructive/5")}>
                    <TableCell className="tabular-nums">{fmtDate(e.ts)} <span className="text-muted-foreground">{fmtTime(e.ts)}</span></TableCell>
                    <TableCell>{name(e.userId)}</TableCell>
                    <TableCell><Badge variant={e.action === "login_failed" ? "destructive" : SENSITIVE.includes(e.action) ? "warning" : "secondary"}>{ACTION_LABEL[e.action]}</Badge></TableCell>
                    <TableCell className="max-w-[480px] whitespace-normal text-muted-foreground">{e.detail}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
