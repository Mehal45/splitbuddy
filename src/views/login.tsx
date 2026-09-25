"use client";

import * as React from "react";
import { ArrowRight, Crown, Truck, User, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Logo, ThemeToggle } from "@/components/app/shell";
import { custName } from "@/lib/format";
import { navigate } from "@/lib/router";
import { useStore } from "@/lib/store";

export function LoginView() {
  const { db, login } = useStore();
  const drivers = db.users.filter((u) => u.role === "driver");
  const customers = db.users.filter((u) => u.role === "customer");
  const [driverId, setDriverId] = React.useState("u-dr1");
  const [customerId, setCustomerId] = React.useState("u-c1");

  const go = (id: string) => { login(id); navigate("/"); };

  const roles = [
    { icon: Crown, title: "Owner", who: "Anmol Mehta", desc: "Sees everything: dashboard, stock, approvals, customers, reports, Tally sync. Can preview any role's screen.", action: () => go("u-owner") },
    { icon: Warehouse, title: "Warehouse staff", who: "Shivakumar B", desc: "Load sheets, delivery approvals, stock receipts from the plant and end-of-day truck reconciliation.", action: () => go("u-wh1") },
    {
      icon: Truck, title: "Driver", who: null, desc: "Mobile screen: own truck stock, record deliveries with photo, GPS and payment.",
      picker: (
        <Select value={driverId} onValueChange={setDriverId}>
          <SelectTrigger className="w-full" aria-label="Driver"><SelectValue /></SelectTrigger>
          <SelectContent>{drivers.map((u) => <SelectItem key={u.id} value={u.id}>{u.name} · {db.trucks.find((t) => t.id === db.drivers.find((d) => d.id === u.driverId)?.truckId)?.regNo}</SelectItem>)}</SelectContent>
        </Select>
      ),
      action: () => go(driverId),
    },
    {
      icon: User, title: "Customer", who: null, desc: "Customer portal: own deliveries with photos, GST invoices, empty cylinder balance and payments.",
      picker: (
        <Select value={customerId} onValueChange={setCustomerId}>
          <SelectTrigger className="w-full" aria-label="Customer"><SelectValue /></SelectTrigger>
          <SelectContent>{customers.map((u) => { const c = db.customers.find((x) => x.id === u.customerId)!; return <SelectItem key={u.id} value={u.id}>{custName(c)} · {c.area}</SelectItem>; })}</SelectContent>
        </Select>
      ),
      action: () => go(customerId),
    },
  ];

  return (
    <div className="relative min-h-dvh bg-gradient-to-b from-primary/10 via-background to-background">
      <div className="absolute top-3 right-3"><ThemeToggle /></div>
      <div className="mx-auto flex max-w-4xl flex-col items-center px-4 py-12 sm:py-16">
        <Logo className="size-14 rounded-2xl [&_svg]:size-8" />
        <h1 className="mt-4 text-center text-3xl font-semibold tracking-tight">{db.settings.agencyName}</h1>
        <p className="mt-1 text-center text-muted-foreground">{db.settings.agencyTagline}</p>
        <p className="mt-6 max-w-xl text-center text-sm text-muted-foreground">
          Demo version. Pick a role to log in, no password needed. All data is sample data stored in this browser.
        </p>
        <div className="mt-8 grid w-full gap-4 sm:grid-cols-2">
          {roles.map((r) => (
            <Card key={r.title} className="gap-0 py-0">
              <CardContent className="flex h-full flex-col gap-4 p-5">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><r.icon className="size-6" /></div>
                  <div>
                    <h2 className="text-lg font-semibold leading-tight">{r.title}</h2>
                    {r.who && <p className="text-sm text-muted-foreground">{r.who}</p>}
                  </div>
                </div>
                <p className="flex-1 text-sm text-muted-foreground">{r.desc}</p>
                {r.picker}
                <Button size="lg" className="w-full" onClick={r.action}>Log in as {r.title.toLowerCase()} <ArrowRight /></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
