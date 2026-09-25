"use client";

import * as React from "react";
import { ArrowLeft, ArrowRight, Check, Copy, Crown, Lock, Smartphone, Truck, User, Warehouse } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Logo, ThemeToggle } from "@/components/app/shell";
import { custName } from "@/lib/format";
import { navigate } from "@/lib/router";
import { useStore } from "@/lib/store";
import type { Role, User as AppUser } from "@/lib/types";
import { cn } from "@/lib/utils";

const DEMO_PIN = "1234";

const digits = (s: string) => s.replace(/\D/g, "");

function Frame({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  const { db } = useStore();
  return (
    <div className="login-bg relative min-h-dvh">
      <div className="absolute top-3 right-3"><ThemeToggle /></div>
      <div className={cn("mx-auto flex flex-col items-center px-4 py-12 sm:py-16", wide ? "max-w-4xl" : "max-w-md")}>
        <Logo className="size-14 rounded-2xl [&_svg]:size-8" />
        <h1 className="mt-4 text-center text-3xl font-semibold tracking-tight">{db.settings.agencyName}</h1>
        <p className="mt-1 text-center text-muted-foreground">{db.settings.agencyTagline}</p>
        <div className="mt-8 w-full">{children}</div>
        <p className="mt-8 text-center text-xs text-muted-foreground">Demo version · all data is sample data stored in this browser</p>
      </div>
    </div>
  );
}

function KeepSignedIn({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start gap-2.5">
      <Checkbox id="keep" checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <div className="grid gap-0.5">
        <Label htmlFor="keep" className="cursor-pointer">Keep me signed in</Label>
        <p className="text-xs text-muted-foreground">Untick on a shared phone or computer.</p>
      </div>
    </div>
  );
}

function CodeBoxes({ length, value, onChange, secret = false, label }: { length: number; value: string; onChange: (v: string) => void; secret?: boolean; label: string }) {
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);
  const set = (i: number, ch: string) => {
    const arr = value.padEnd(length, " ").split("");
    arr[i] = ch || " ";
    onChange(arr.join("").trimEnd());
  };
  return (
    <div className="flex justify-center gap-2.5" role="group" aria-label={label}>
      {Array.from({ length }, (_, i) => (
        <Input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          id={`${label.replace(/\s/g, "-").toLowerCase()}-${i}`}
          aria-label={`${label} digit ${i + 1}`}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          type={secret ? "password" : "text"}
          maxLength={length}
          value={(value[i] ?? "").trim()}
          autoFocus={i === 0}
          onChange={(e) => {
            const d = digits(e.target.value);
            if (d.length > 1) { onChange(d.slice(0, length)); refs.current[Math.min(length, d.length) - 1]?.focus(); return; }
            set(i, d);
            if (d && i < length - 1) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => { if (e.key === "Backspace" && !(value[i] ?? "").trim() && i > 0) refs.current[i - 1]?.focus(); }}
          className="size-14 text-center text-2xl font-semibold tabular-nums"
        />
      ))}
    </div>
  );
}

// ---------- owner: PIN, then log in as anyone ----------

export function OwnerLogin() {
  const { db, login } = useStore();
  const [pin, setPin] = React.useState("");
  const [keep, setKeep] = React.useState(true);
  const [unlocked, setUnlocked] = React.useState(false);
  const [error, setError] = React.useState("");
  const [driverId, setDriverId] = React.useState("u-dr1");
  const [customerId, setCustomerId] = React.useState("u-c1");
  const expected = db.settings.ownerPin ?? DEMO_PIN;

  const unlock = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (pin === expected) { setUnlocked(true); setError(""); }
    else { setError("That PIN is not correct. Try again."); setPin(""); }
  };
  const go = (id: string) => { login(id, keep); navigate("/"); };

  if (!unlocked) {
    return (
      <Frame>
        <Card className="gap-0 py-0">
          <CardContent className="p-6">
            <form onSubmit={unlock} className="grid gap-5">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><Lock className="size-5" /></div>
                <div><h2 className="text-lg font-semibold leading-tight">Owner login</h2><p className="text-sm text-muted-foreground">Enter your 4-digit PIN</p></div>
              </div>
              <CodeBoxes length={4} value={pin} onChange={(v) => { setPin(v); setError(""); }} secret label="PIN" />
              {error && <p className="text-center text-sm text-destructive">{error}</p>}
              <KeepSignedIn checked={keep} onChange={setKeep} />
              <Button type="submit" size="lg" className="w-full" disabled={pin.length !== 4}>Unlock <ArrowRight /></Button>
              <p className="rounded-md bg-muted px-3 py-2 text-center text-sm text-muted-foreground">Demo PIN: <b className="text-foreground tabular-nums">{expected}</b></p>
            </form>
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Staff, drivers and customers use their own login pages.
        </p>
      </Frame>
    );
  }

  const drivers = db.users.filter((u) => u.role === "driver");
  const customers = db.users.filter((u) => u.role === "customer");
  const roles: { icon: React.ElementType; title: string; who?: string; desc: string; picker?: React.ReactNode; action: () => void }[] = [
    { icon: Crown, title: "Owner", who: "Anmol Mehta", desc: "Everything: dashboard, stock, approvals, customers, reports, Tally sync.", action: () => go("u-owner") },
    { icon: Warehouse, title: "Warehouse staff", who: "Shivakumar B", desc: "Load sheets, approvals, plant receipts and end-of-day counts.", action: () => go("u-wh1") },
    {
      icon: Truck, title: "Driver", desc: "Mobile screen: own truck, deliveries with photo, GPS and payment.",
      picker: (
        <Select value={driverId} onValueChange={setDriverId}>
          <SelectTrigger className="w-full" aria-label="Driver"><SelectValue /></SelectTrigger>
          <SelectContent>{drivers.map((u) => <SelectItem key={u.id} value={u.id}>{u.name} · {db.trucks.find((t) => t.id === db.drivers.find((d) => d.id === u.driverId)?.truckId)?.regNo}</SelectItem>)}</SelectContent>
        </Select>
      ),
      action: () => go(driverId),
    },
    {
      icon: User, title: "Customer", desc: "Portal: own deliveries, GST invoices, empty balance and payments.",
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
    <Frame wide>
      <p className="mb-4 text-center text-sm text-muted-foreground">Owner access unlocked. Open the app as any role.</p>
      <div className="grid w-full gap-4 sm:grid-cols-2">
        {roles.map((r, i) => (
          <Card key={r.title} className={cn("gap-0 py-0", i === 0 && "stat-hero")}>
            <CardContent className="flex h-full flex-col gap-4 p-5">
              <div className="flex items-center gap-3">
                <div className="stat-icon rounded-xl bg-primary/10 p-2.5 text-primary"><r.icon className="size-6" /></div>
                <div><h2 className="text-lg font-semibold leading-tight">{r.title}</h2>{r.who && <p className="text-sm opacity-70">{r.who}</p>}</div>
              </div>
              <p className="flex-1 text-sm opacity-75">{r.desc}</p>
              {r.picker}
              <Button size="lg" className="w-full" variant={i === 0 ? "secondary" : "default"} onClick={r.action}>Open as {r.title.toLowerCase()} <ArrowRight /></Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <ShareLinks />
    </Frame>
  );
}

function ShareLinks() {
  const [base, setBase] = React.useState("");
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- needs window, client only
    setBase(window.location.href.split("#")[0]);
  }, []);
  const links: [string, string][] = [["Warehouse staff", "staff"], ["Drivers", "driver"], ["Customers", "customer"]];
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success("Link copied"); }
    catch { toast.info(text); }
  };
  return (
    <Card className="mt-6 gap-3 py-5">
      <CardContent className="grid gap-3 px-5">
        <div><h2 className="font-semibold">Login links to share</h2><p className="text-sm text-muted-foreground">Each group gets its own page. None of them can open this owner page without the PIN.</p></div>
        {links.map(([label, hash]) => (
          <div key={hash} className="flex flex-wrap items-center gap-2">
            <span className="w-32 text-sm font-medium">{label}</span>
            <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-xs select-all">{base}#{hash}</code>
            <Button size="sm" variant="outline" onClick={() => copy(`${base}#${hash}`)}><Copy /> Copy</Button>
            <Button size="sm" variant="ghost" onClick={() => navigate(`/${hash}`)}>Open</Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ---------- staff / driver / customer: mobile number + OTP ----------

const ROLE_COPY: Record<Exclude<Role, "owner">, { title: string; icon: React.ElementType; notFound: string }> = {
  warehouse: { title: "Staff login", icon: Warehouse, notFound: "This number isn't registered as warehouse staff. Ask the owner to add you." },
  driver: { title: "Driver login", icon: Truck, notFound: "This number isn't registered as a driver. Ask the office to add you." },
  customer: { title: "Customer login", icon: User, notFound: "We couldn't find a customer with this number. Use the number you gave the agency." },
};

export function PhoneLogin({ role }: { role: Exclude<Role, "owner"> }) {
  const { db, login } = useStore();
  const copy = ROLE_COPY[role];
  const [phone, setPhone] = React.useState("");
  const [keep, setKeep] = React.useState(true);
  const [step, setStep] = React.useState<"phone" | "otp">("phone");
  const [otp, setOtp] = React.useState("");
  const [error, setError] = React.useState("");
  const [user, setUser] = React.useState<AppUser | null>(null);
  const [resendIn, setResendIn] = React.useState(0);
  const people = db.users.filter((u) => u.role === role);

  React.useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn(resendIn - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const label = (u: AppUser) => {
    if (u.customerId) { const c = db.customers.find((x) => x.id === u.customerId); return c ? custName(c) : u.name; }
    return u.name;
  };

  const sendOtp = (e?: React.FormEvent) => {
    e?.preventDefault();
    const d = digits(phone).slice(-10);
    const found = people.find((u) => digits(u.phone).slice(-10) === d);
    if (!found) { setError(copy.notFound); return; }
    setUser(found); setError(""); setOtp(""); setStep("otp"); setResendIn(30);
  };
  const verify = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!user || otp.length !== 4) return;
    login(user.id, keep);
    navigate("/");
  };

  return (
    <Frame>
      <Card className="gap-0 py-0">
        <CardContent className="p-6">
          {step === "phone" ? (
            <form onSubmit={sendOtp} className="grid gap-5">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><copy.icon className="size-5" /></div>
                <div><h2 className="text-lg font-semibold leading-tight">{copy.title}</h2><p className="text-sm text-muted-foreground">We&apos;ll send a one-time code to your mobile</p></div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="phone">Mobile number</Label>
                <div className="flex">
                  <span className="flex items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm text-muted-foreground">+91</span>
                  <Input id="phone" inputMode="tel" autoComplete="tel-national" autoFocus value={phone} onChange={(e) => { setPhone(e.target.value.replace(/[^\d\s]/g, "").slice(0, 12)); setError(""); }} placeholder="98450 12345" className="h-12 rounded-l-none text-lg tabular-nums" aria-invalid={!!error} />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>
              <KeepSignedIn checked={keep} onChange={setKeep} />
              <Button type="submit" size="lg" className="h-12 w-full" disabled={digits(phone).length < 10}><Smartphone /> Send OTP</Button>
            </form>
          ) : (
            <form onSubmit={verify} className="grid gap-5">
              <button type="button" onClick={() => setStep("phone")} className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Change number</button>
              <div>
                <h2 className="text-lg font-semibold">Enter the 4-digit code</h2>
                <p className="text-sm text-muted-foreground">Sent to +91 {user?.phone} · {label(user!)}</p>
              </div>
              <CodeBoxes length={4} value={otp} onChange={setOtp} label="OTP" />
              <p className="rounded-md bg-muted px-3 py-2 text-center text-sm text-muted-foreground">Demo: no SMS is sent. Any 4 digits work.</p>
              <Button type="submit" size="lg" className="h-12 w-full" disabled={otp.length !== 4}><Check /> Verify and log in</Button>
              <Button type="button" variant="ghost" disabled={resendIn > 0} onClick={() => { setResendIn(30); toast.success("Code sent again (demo)"); }}>
                {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
      {step === "phone" && (
        <Card className="mt-4 gap-2 py-4">
          <CardContent className="px-5">
            <p className="mb-2 text-sm font-medium">Demo numbers <span className="font-normal text-muted-foreground">· tap to fill</span></p>
            <div className="grid gap-1">
              {people.slice(0, 4).map((u) => (
                <button key={u.id} type="button" onClick={() => { setPhone(u.phone); setError(""); }} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent">
                  <span className="min-w-0 truncate">{label(u)}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{u.phone}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </Frame>
  );
}

export function LoginRouter({ path }: { path: string }) {
  const base = path.split("?")[0].split("/").filter(Boolean)[0];
  if (base === "staff") return <PhoneLogin role="warehouse" />;
  if (base === "driver") return <PhoneLogin role="driver" />;
  if (base === "customer" || base === "me") return <PhoneLogin role="customer" />;
  return <OwnerLogin />;
}
