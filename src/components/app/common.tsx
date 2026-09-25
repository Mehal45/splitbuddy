"use client";

import * as React from "react";
import { Download, Inbox, MapPin, Minus, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dayKey, distanceKm, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Customer, Delivery, DeliveryStatus, SizeQty } from "@/lib/types";

export function PageHeader({ title, description, actions, className }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, icon: Icon, tone = "default", onClick, highlight = false }: {
  label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ElementType; tone?: "default" | "danger" | "warning" | "success"; onClick?: () => void;
  highlight?: boolean; // the one headline figure (solid card in the new style)
}) {
  return (
    <Card className={cn("gap-2 py-4", highlight && "stat-hero", onClick && "cursor-pointer transition-colors hover:bg-accent/40")} onClick={onClick}>
      <CardContent className="flex items-start justify-between gap-3 px-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className={cn("stat-value mt-1 text-2xl font-semibold tabular-nums", tone === "danger" && "text-destructive", tone === "warning" && "text-warning-foreground", tone === "success" && "text-success")}>{value}</p>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {Icon && (
          <div className={cn("stat-icon rounded-lg p-2", tone === "danger" ? "bg-destructive/10 text-destructive" : tone === "warning" ? "bg-warning/15 text-warning-foreground" : tone === "success" ? "bg-success/10 text-success" : "bg-primary/10 text-primary")}>
            <Icon className="size-5" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function StatusBadge({ status }: { status: DeliveryStatus }) {
  if (status === "approved") return <Badge variant="success">Approved</Badge>;
  if (status === "rejected") return <Badge variant="destructive">Rejected</Badge>;
  return <Badge variant="warning">Pending approval</Badge>;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-10 text-center text-muted-foreground">
      <Inbox className="size-8 opacity-60" />
      <p className="font-medium text-foreground">{title}</p>
      {hint && <p className="max-w-sm text-sm">{hint}</p>}
    </div>
  );
}

export function qtySummary(q: SizeQty, sizes?: { id: string; label: string }[]) {
  const parts = Object.entries(q).filter(([, n]) => n > 0).map(([s, n]) => `${n}×${sizes?.find((x) => x.id === s)?.label ?? `${s} kg`}`);
  return parts.length ? parts.join(", ") : "–";
}

// ---------- acknowledgement photo ----------

const PAPER = ["#fbf7ec", "#f6f3ea", "#fffdf6", "#f3efe2", "#faf6ee", "#f7f2e6"];
const TABLE = ["#8b6a4f", "#6f5846", "#9c7b5e", "#5f4b3c", "#7d634f", "#a0826a"];
const STAMP = ["#2b4c9b", "#6b2f8f", "#1f6f5c", "#9b2b3a", "#2b4c9b", "#6b2f8f"];

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

// Draws a believable photo of a signed & stamped delivery challan as an SVG.
export function ackPlaceholder(n: number, d: Pick<Delivery, "no" | "ts" | "full" | "empty">, customerName: string) {
  const i = (n - 1) % 6;
  const rot = [-3, 2, -1.5, 3.5, -2.5, 1][i];
  const rows = Object.keys({ ...d.full, ...d.empty }).map((s, k) =>
    `<text x="40" y="${232 + k * 26}" font-size="15" fill="#333">${esc(s)} kg</text><text x="170" y="${232 + k * 26}" font-size="15" fill="#1d3a8a" font-family="cursive">${d.full[s] ?? 0}</text><text x="250" y="${232 + k * 26}" font-size="15" fill="#1d3a8a" font-family="cursive">${d.empty[s] ?? 0}</text>`
  ).join("");
  const name = esc(customerName.slice(0, 26));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="600" viewBox="0 0 480 600">
<defs><filter id="s"><feDropShadow dx="4" dy="8" stdDeviation="8" flood-opacity=".45"/></filter></defs>
<rect width="480" height="600" fill="${TABLE[i]}"/>
<g transform="rotate(${rot} 240 300)" filter="url(#s)">
<rect x="50" y="40" width="380" height="520" fill="${PAPER[i]}" rx="3"/>
<g transform="translate(50 40)" font-family="Arial, sans-serif">
<text x="190" y="36" text-anchor="middle" font-size="18" font-weight="700" fill="#1f2a44">ANMOL GAS AGENCY</text>
<text x="190" y="56" text-anchor="middle" font-size="11" fill="#555">Bharat Gas Distributor · Peenya, Bengaluru</text>
<line x1="20" y1="68" x2="360" y2="68" stroke="#999"/>
<text x="190" y="92" text-anchor="middle" font-size="14" font-weight="700" fill="#333">DELIVERY CHALLAN / ACKNOWLEDGEMENT</text>
<text x="24" y="124" font-size="12" fill="#444">No: ${esc(d.no)}</text>
<text x="24" y="146" font-size="12" fill="#444">Date: ${esc(dayKey(d.ts).split("-").reverse().join("/"))}</text>
<text x="24" y="168" font-size="12" fill="#444">Customer:</text><text x="90" y="168" font-size="15" fill="#1d3a8a" font-family="cursive">${name}</text>
<rect x="20" y="190" width="340" height="${30 + Object.keys({ ...d.full, ...d.empty }).length * 26}" fill="none" stroke="#aaa"/>
<text x="40" y="208" font-size="12" font-weight="700" fill="#333">Size</text><text x="150" y="208" font-size="12" font-weight="700" fill="#333">Full given</text><text x="230" y="208" font-size="12" font-weight="700" fill="#333">Empty back</text>
${rows}
<text x="24" y="420" font-size="11" fill="#666">Received the above cylinders in good condition.</text>
<path d="M40 470 c 20 -30, 35 10, 50 -10 s 20 -25, 30 5 s 25 -20, 40 -5 s 15 10, 30 -8" stroke="#1d3a8a" stroke-width="2.2" fill="none"/>
<line x1="30" y1="485" x2="170" y2="485" stroke="#999"/><text x="30" y="500" font-size="10" fill="#666">Customer signature</text>
<g transform="translate(275 455) rotate(${-12 + i * 5})" opacity=".78">
<circle r="52" fill="none" stroke="${STAMP[i]}" stroke-width="3"/><circle r="40" fill="none" stroke="${STAMP[i]}" stroke-width="1.5"/>
<text y="-4" text-anchor="middle" font-size="10" font-weight="700" fill="${STAMP[i]}">${name.slice(0, 16).toUpperCase()}</text>
<text y="12" text-anchor="middle" font-size="9" fill="${STAMP[i]}">BENGALURU</text>
</g></g></g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function ackSrc(d: Delivery, customer?: Customer) {
  if (d.photo.startsWith("ph:")) return ackPlaceholder(Number(d.photo.slice(3)) || 1, d, customer ? customer.businessName || customer.name : "Customer");
  return d.photo;
}

export function AckPhoto({ delivery, customer, className }: { delivery: Delivery; customer?: Customer; className?: string }) {
  const [open, setOpen] = React.useState(false);
  const src = React.useMemo(() => ackSrc(delivery, customer), [delivery, customer]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn("group relative block overflow-hidden rounded-md border bg-muted", className)} aria-label="Open acknowledgement photo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`Acknowledgement ${delivery.no}`} className="size-full object-cover transition-transform group-hover:scale-105" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Acknowledgement {delivery.no}</DialogTitle>
            <DialogDescription>{fmtDateTime(delivery.ts)}</DialogDescription>
          </DialogHeader>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={`Acknowledgement ${delivery.no}`} className="w-full rounded-md border" />
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------- map ----------

// A simple schematic map: customer's saved location vs where the delivery was logged.
export function MiniMap({ customer, gps, maxKm, className }: { customer: Customer; gps: { lat: number; lng: number; mocked?: boolean }; maxKm: number; className?: string }) {
  const km = distanceKm(customer, gps);
  const far = km > maxKm;
  const span = Math.max(0.004, Math.abs(gps.lat - customer.lat), Math.abs(gps.lng - customer.lng)) * 1.6;
  const cx = (customer.lng + gps.lng) / 2, cy = (customer.lat + gps.lat) / 2;
  const px = (lng: number) => 150 + ((lng - cx) / span) * 130;
  const py = (lat: number) => 90 - ((lat - cy) / span) * 70;
  const c = { x: px(customer.lng), y: py(customer.lat) }, g = { x: px(gps.lng), y: py(gps.lat) };
  return (
    <div className={cn("overflow-hidden rounded-md border", className)}>
      <svg viewBox="0 0 300 180" className="block h-auto w-full bg-[oklch(0.95_0.02_150)] dark:bg-[oklch(0.26_0.02_160)]" role="img" aria-label={`Delivery logged ${km.toFixed(2)} km from customer`}>
        {[30, 75, 120, 165].map((y) => <line key={y} x1="0" x2="300" y1={y} y2={y} className="stroke-white/80 dark:stroke-white/10" strokeWidth="6" />)}
        {[40, 110, 190, 260].map((x) => <line key={x} y1="0" y2="180" x1={x} x2={x} className="stroke-white/80 dark:stroke-white/10" strokeWidth="5" />)}
        <line x1="0" y1="10" x2="300" y2="150" className="stroke-amber-200 dark:stroke-amber-900/60" strokeWidth="9" />
        <circle cx={c.x} cy={c.y} r={Math.max(8, (maxKm / (span * 111)) * 130)} className="fill-primary/10 stroke-primary/40" strokeDasharray="4 3" />
        <line x1={c.x} y1={c.y} x2={g.x} y2={g.y} className={far ? "stroke-destructive" : "stroke-foreground/40"} strokeWidth="1.5" strokeDasharray="4 3" />
        <circle cx={c.x} cy={c.y} r="6" className="fill-primary stroke-white" strokeWidth="2" />
        <circle cx={g.x} cy={g.y} r="6" className={cn(far ? "fill-destructive" : "fill-success", "stroke-white")} strokeWidth="2" />
      </svg>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-card px-3 py-2 text-xs">
        <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-full bg-primary" /> Customer</span>
        <span className="flex items-center gap-1"><span className={cn("inline-block size-2.5 rounded-full", far ? "bg-destructive" : "bg-success")} /> Delivery GPS {gps.mocked ? "(mock)" : ""}</span>
        <span className={cn("font-medium tabular-nums", far && "text-destructive")}><MapPin className="mr-0.5 inline size-3" />{km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`} away</span>
      </div>
      <div className="border-t bg-card px-3 py-1.5 font-mono text-[11px] text-muted-foreground">{gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}</div>
    </div>
  );
}

// ---------- filters and export ----------

export function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const today = dayKey();
  const preset = (days: number) => onChange(dayKey(new Date(Date.now() - (days - 1) * 864e5)), today);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="grid gap-1">
        <Label className="text-xs text-muted-foreground" htmlFor="df">From</Label>
        <Input id="df" type="date" value={from} max={to} onChange={(e) => onChange(e.target.value, to)} className="h-8 w-[9.5rem]" />
      </div>
      <div className="grid gap-1">
        <Label className="text-xs text-muted-foreground" htmlFor="dt">To</Label>
        <Input id="dt" type="date" value={to} min={from} onChange={(e) => onChange(from, e.target.value)} className="h-8 w-[9.5rem]" />
      </div>
      <div className="flex gap-1">
        <Button size="sm" variant="outline" onClick={() => onChange(today, today)}>Today</Button>
        <Button size="sm" variant="outline" onClick={() => preset(7)}>7 days</Button>
        <Button size="sm" variant="outline" onClick={() => preset(30)}>30 days</Button>
        <Button size="sm" variant="outline" onClick={() => preset(60)}>60 days</Button>
      </div>
    </div>
  );
}

export function useDateRange(days = 30) {
  const [range, setRange] = React.useState(() => ({ from: dayKey(new Date(Date.now() - (days - 1) * 864e5)), to: dayKey() }));
  return { ...range, set: (from: string, to: string) => setRange({ from, to }), inRange: (d: string) => d >= range.from && d <= range.to };
}

export function downloadCSV(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows.map((r) => r.map((v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      <Download /> Export CSV
    </Button>
  );
}

// ---------- quantity stepper ----------

export function Stepper({ value, onChange, min = 0, max = 999, large = false, label }: { value: number; onChange: (n: number) => void; min?: number; max?: number; large?: boolean; label?: string }) {
  return (
    <div className={cn("flex items-center gap-1", large && "gap-2")}>
      <Button type="button" variant="outline" size={large ? "xl" : "icon"} className={cn(large && "size-14 px-0")} onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`Decrease ${label ?? ""}`}>
        <Minus />
      </Button>
      <Input
        inputMode="numeric"
        aria-label={label}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value.replace(/\D/g, "") || "0", 10);
          onChange(Math.min(max, Math.max(min, n)));
        }}
        className={cn("w-14 text-center tabular-nums", large && "h-14 w-16 text-xl font-semibold")}
      />
      <Button type="button" variant="outline" size={large ? "xl" : "icon"} className={cn(large && "size-14 px-0")} onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`Increase ${label ?? ""}`}>
        <Plus />
      </Button>
    </div>
  );
}

export function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn("mb-3 text-base font-semibold", className)}>{children}</h2>;
}
