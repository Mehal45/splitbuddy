"use client";

import * as React from "react";
import {
  Bell, Boxes, ClipboardCheck, Eye, Factory, FileBarChart, History, LayoutDashboard, LogOut, Menu, Monitor, Moon, PackagePlus,
  Receipt, RefreshCw, Scale, Settings, Sun, Truck, Users, Wallet, ListChecks, Home, Flame,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { custName } from "@/lib/format";
import { Link, navigate } from "@/lib/router";
import { useStore } from "@/lib/store";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface NavItem { href: string; label: string; icon: React.ElementType; badge?: "pending" | "alerts" }

export const NAV: Record<Role, NavItem[]> = {
  owner: [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/alerts", label: "Alerts", icon: Bell, badge: "alerts" },
    { href: "/approvals", label: "Approvals", icon: ClipboardCheck, badge: "pending" },
    { href: "/loads", label: "Load sheets", icon: Truck },
    { href: "/reconciliation", label: "End of day", icon: Scale },
    { href: "/stock", label: "Stock", icon: Boxes },
    { href: "/purchases", label: "Purchases", icon: Factory },
    { href: "/sales", label: "Sales invoices", icon: Receipt },
    { href: "/customers", label: "Customers", icon: Users },
    { href: "/fleet", label: "Trucks & drivers", icon: Truck },
    { href: "/movements", label: "Movement log", icon: History },
    { href: "/reports", label: "Reports", icon: FileBarChart },
    { href: "/tally", label: "Tally sync", icon: RefreshCw },
    { href: "/settings", label: "Settings", icon: Settings },
  ],
  warehouse: [
    { href: "/", label: "Today", icon: LayoutDashboard },
    { href: "/loads", label: "Load sheets", icon: Truck },
    { href: "/approvals", label: "Approvals", icon: ClipboardCheck, badge: "pending" },
    { href: "/purchases", label: "Stock receipts", icon: PackagePlus },
    { href: "/reconciliation", label: "End of day", icon: Scale },
    { href: "/stock", label: "Stock", icon: Boxes },
    { href: "/movements", label: "Movement log", icon: History },
    { href: "/customers", label: "Customers", icon: Users },
  ],
  driver: [
    { href: "/", label: "My day", icon: Home },
    { href: "/driver/new", label: "New delivery", icon: PackagePlus },
    { href: "/driver/history", label: "My deliveries", icon: ListChecks },
  ],
  customer: [
    { href: "/", label: "Overview", icon: Home },
    { href: "/me/deliveries", label: "Deliveries", icon: Truck },
    { href: "/me/invoices", label: "Invoices", icon: Receipt },
    { href: "/me/payments", label: "Payments", icon: Wallet },
  ],
};

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", warehouse: "Warehouse staff", driver: "Driver", customer: "Customer" };

function isActive(href: string, path: string) {
  if (href === "/") return path === "/";
  return path === href || path.startsWith(href + "/");
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground", className)}>
      <Flame className="size-5" />
    </div>
  );
}

function useBadgeCounts() {
  const { db, alerts } = useStore();
  return { pending: db.deliveries.filter((d) => d.status === "pending").length, alerts: alerts.length };
}

function NavLinks({ items, path, onNavigate }: { items: NavItem[]; path: string; onNavigate?: () => void }) {
  const counts = useBadgeCounts();
  return (
    <nav className="grid gap-0.5">
      {items.map((it) => {
        const active = isActive(it.href, path);
        const count = it.badge ? counts[it.badge] : 0;
        return (
          <Link key={it.href} href={it.href} onClick={onNavigate}
            className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors", active ? "bg-primary/10 text-primary" : "text-sidebar-foreground/80 hover:bg-accent hover:text-foreground")}>
            <it.icon className="size-4" />
            <span className="flex-1">{it.label}</span>
            {count > 0 && <Badge variant={it.badge === "alerts" ? "destructive" : "warning"} className="px-1.5">{count}</Badge>}
          </Link>
        );
      })}
    </nav>
  );
}

// ---------- theme ----------

type ThemePref = "light" | "dark" | "system";
function applyTheme(t: ThemePref) {
  try { localStorage.setItem("anmol-theme", t); } catch { /* private mode */ }
  const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}

export function ThemeToggle() {
  const [pref, setPref] = React.useState<ThemePref>("system");
  React.useEffect(() => {
    let saved: ThemePref = "system";
    try { saved = (localStorage.getItem("anmol-theme") as ThemePref) || "system"; } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read saved preference once
    setPref(saved);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { if ((localStorage.getItem("anmol-theme") || "system") === "system") applyTheme("system"); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const Icon = pref === "dark" ? Moon : pref === "light" ? Sun : Monitor;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Theme"><Icon /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(["light", "dark", "system"] as ThemePref[]).map((t) => (
          <DropdownMenuItem key={t} onClick={() => { setPref(t); applyTheme(t); }}>
            {t === "light" ? <Sun /> : t === "dark" ? <Moon /> : <Monitor />} {t[0].toUpperCase() + t.slice(1)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------- owner "view as" ----------

export function ViewAsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { db, viewAs } = useStore();
  const [role, setRole] = React.useState<Role>("driver");
  const people = db.users.filter((u) => u.role === role);
  const [userId, setUserId] = React.useState<string>("u-dr1");
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- default person when role changes
    setUserId(people[0]?.id ?? "");
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps
  const labelFor = (id: string) => {
    const u = db.users.find((x) => x.id === id);
    if (!u) return "";
    if (u.customerId) { const c = db.customers.find((x) => x.id === u.customerId)!; return `${custName(c)} (${c.area})`; }
    if (u.driverId) { const d = db.drivers.find((x) => x.id === u.driverId)!; return `${u.name} · ${db.trucks.find((t) => t.id === d.truckId)?.regNo}`; }
    return u.name;
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>View the app as another role</DialogTitle>
          <DialogDescription>See exactly what your staff, drivers and customers see. You can switch back any time.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Role</Label>
            <div className="grid grid-cols-3 gap-2">
              {(["warehouse", "driver", "customer"] as Role[]).map((r) => (
                <Button key={r} variant={role === r ? "default" : "outline"} onClick={() => setRole(r)}>{ROLE_LABEL[r]}</Button>
              ))}
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Person</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose" /></SelectTrigger>
              <SelectContent>
                {people.map((u) => <SelectItem key={u.id} value={u.id}>{labelFor(u.id)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => { viewAs(userId); onOpenChange(false); navigate("/"); }} disabled={!userId}><Eye /> View as {ROLE_LABEL[role].toLowerCase()}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ViewAsBanner() {
  const { realUser, user, role, viewAs, db } = useStore();
  if (!realUser || realUser.role !== "owner" || !user || user.id === realUser.id) return null;
  const who = user.customerId ? custName(db.customers.find((c) => c.id === user.customerId)!) : user.name;
  return (
    <div className="no-print sticky top-0 z-40 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-brand-accent px-4 py-1.5 text-center text-sm font-medium text-black">
      <span><Eye className="mr-1 inline size-4" />Owner preview: {ROLE_LABEL[role!]} screen as <b>{who}</b></span>
      <button className="underline underline-offset-2" onClick={() => { viewAs(undefined); navigate("/"); }}>Back to owner view</button>
    </div>
  );
}

function UserMenu() {
  const { realUser, user, logout, role } = useStore();
  const [viewOpen, setViewOpen] = React.useState(false);
  if (!user) return null;
  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("");
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-9 gap-2 px-2">
            <span className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{initials}</span>
            <span className="hidden text-left text-sm leading-tight sm:block">
              <span className="block max-w-[9rem] truncate font-medium">{user.name}</span>
              <span className="block text-xs text-muted-foreground">{ROLE_LABEL[role!]}</span>
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>{realUser?.name}<span className="block text-xs font-normal text-muted-foreground">{ROLE_LABEL[realUser!.role]}</span></DropdownMenuLabel>
          <DropdownMenuSeparator />
          {realUser?.role === "owner" && <DropdownMenuItem onClick={() => setViewOpen(true)}><Eye /> View as another role…</DropdownMenuItem>}
          <DropdownMenuItem onClick={() => { logout(); navigate("/"); }}><LogOut /> Log out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ViewAsDialog open={viewOpen} onOpenChange={setViewOpen} />
    </>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  const { db } = useStore();
  return (
    <Link href="/" className="flex min-w-0 items-center gap-2.5">
      <Logo />
      <span className={cn("min-w-0 leading-tight", compact && "hidden sm:block")}>
        <span className="block truncate font-semibold">{db.settings.agencyName}</span>
        <span className="block truncate text-xs text-muted-foreground">{db.settings.agencyTagline}</span>
      </span>
    </Link>
  );
}

export function AppShell({ path, children }: { path: string; children: React.ReactNode }) {
  const { role, realUser } = useStore();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [viewOpen, setViewOpen] = React.useState(false);
  const items = NAV[role!];

  if (role === "driver") {
    return (
      <div className="min-h-dvh bg-muted/40">
        <ViewAsBanner />
        <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-background shadow-sm">
          <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b bg-background/95 px-4 backdrop-blur">
            <Brand compact />
            <div className="flex items-center gap-1"><ThemeToggle /><UserMenu /></div>
          </header>
          <main className="flex-1 px-4 pt-4 pb-28">{children}</main>
          <nav className="no-print fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-md grid-cols-3 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
            {items.map((it) => (
              <Link key={it.href} href={it.href} className={cn("flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium", isActive(it.href, path) ? "text-primary" : "text-muted-foreground")}>
                <it.icon className={cn("size-6", it.href === "/driver/new" && "rounded-full bg-primary p-1 text-primary-foreground size-8")} />
                {it.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <ViewAsBanner />
      <div className="flex">
        <aside className="no-print sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r bg-sidebar p-3 lg:flex">
          <div className="px-1 pt-1"><Brand /></div>
          <NavLinks items={items} path={path} />
          {realUser?.role === "owner" && role === "owner" && (
            <Button variant="outline" size="sm" className="mt-auto" onClick={() => setViewOpen(true)}><Eye /> View as another role</Button>
          )}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu"><Menu /></Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 overflow-y-auto p-3">
                <SheetHeader className="p-1"><SheetTitle className="sr-only">Menu</SheetTitle><Brand /></SheetHeader>
                <NavLinks items={items} path={path} onNavigate={() => setMenuOpen(false)} />
                {realUser?.role === "owner" && role === "owner" && (
                  <Button variant="outline" size="sm" onClick={() => { setMenuOpen(false); setViewOpen(true); }}><Eye /> View as another role</Button>
                )}
              </SheetContent>
            </Sheet>
            <div className="lg:hidden"><Brand compact /></div>
            <div className="ml-auto flex items-center gap-1">
              {role === "owner" && <AlertBell />}
              <ThemeToggle />
              <UserMenu />
            </div>
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
        </div>
      </div>
      <ViewAsDialog open={viewOpen} onOpenChange={setViewOpen} />
    </div>
  );
}

function AlertBell() {
  const { alerts } = useStore();
  return (
    <Button variant="ghost" size="icon" asChild aria-label={`${alerts.length} alerts`}>
      <Link href="/alerts" className="relative">
        <Bell />
        {alerts.length > 0 && <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-white">{alerts.length}</span>}
      </Link>
    </Button>
  );
}
