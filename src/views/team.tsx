"use client";

// Forms for building the team from scratch: trucks with their drivers, and
// warehouse staff. Each new person signs in with their own mobile number.

import * as React from "react";
import { Plus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/app/common";
import { addStaff, addTruckWithDriver, logAudit, setManager } from "@/lib/engine";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useActorId } from "@/lib/hooks";
import { peopleApi, tempPassword } from "@/lib/live/people";
import { rpc, useStore } from "@/lib/store";

function Field({ id, label, children, hint }: { id: string; label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function AddTruckButton() {
  const { act, live } = useStore();
  const [pwd, setPwd] = React.useState(tempPassword);
  const actor = useActorId();
  const [open, setOpen] = React.useState(false);
  const [f, setF] = React.useState({ regNo: "", model: "Tata 407", capacity: "80", driverName: "", phone: "", licenseNo: "" });
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  const save = async () => {
    const ok = await act((d) => {
      const { truck, driver } = addTruckWithDriver(d, { ...f, capacity: Number(f.capacity) || 0 });
      logAudit(d, actor, "team_changed", `Added truck ${truck.regNo} with driver ${driver.name}`);
    }, live ? `Truck and driver added. Driver login: phone ${f.phone}, password ${pwd}` : "Truck and driver added. The driver can now sign in on the driver page.", async (sb) => {
      await peopleApi(sb, { kind: "truck", regNo: f.regNo, model: f.model, capacity: Number(f.capacity) || 0, driverName: f.driverName, phone: f.phone, licenseNo: f.licenseNo, password: pwd });
    });
    if (ok) { setOpen(false); setF({ regNo: "", model: "Tata 407", capacity: "80", driverName: "", phone: "", licenseNo: "" }); }
  };
  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus /> Add truck & driver</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Add truck & driver</DialogTitle><DialogDescription>The driver signs in on the driver page with this mobile number.</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="t-reg" label="Truck number"><Input id="t-reg" maxLength={15} placeholder="KA-01-AB-1234" value={f.regNo} onChange={(e) => set("regNo", e.target.value.toUpperCase())} /></Field>
            <Field id="t-model" label="Model"><Input id="t-model" maxLength={40} value={f.model} onChange={(e) => set("model", e.target.value)} /></Field>
            <Field id="t-cap" label="Capacity (cylinders)"><Input id="t-cap" inputMode="numeric" maxLength={4} value={f.capacity} onChange={(e) => set("capacity", e.target.value.replace(/\D/g, ""))} /></Field>
            <Field id="t-driver" label="Driver name"><Input id="t-driver" maxLength={80} value={f.driverName} onChange={(e) => set("driverName", e.target.value)} /></Field>
            <Field id="t-phone" label="Driver mobile"><Input id="t-phone" inputMode="tel" maxLength={14} placeholder="98450 12345" value={f.phone} onChange={(e) => set("phone", e.target.value.replace(/[^\d\s+]/g, ""))} /></Field>
            <Field id="t-lic" label="Driving licence no. (optional)"><Input id="t-lic" maxLength={30} value={f.licenseNo} onChange={(e) => set("licenseNo", e.target.value)} /></Field>
            {live && <Field id="t-pwd" label="Driver's first password" hint="They sign in on the driver page with their phone and this password."><Input id="t-pwd" className="font-mono" maxLength={64} value={pwd} onChange={(e) => setPwd(e.target.value.trim())} /></Field>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={!f.regNo.trim() || !f.driverName.trim() || !f.phone.trim()}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function StaffCard() {
  const { db, act, live } = useStore();
  const [pwd, setPwd] = React.useState(tempPassword);
  const actor = useActorId();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [manager, setMgr] = React.useState(false);
  const staff = db.users.filter((u) => u.role === "warehouse");
  const save = async () => {
    const ok = await act((d) => {
      const u = addStaff(d, { name, phone, manager });
      logAudit(d, actor, "team_changed", `Added warehouse ${u.manager ? "manager" : "staff"} ${u.name}`);
    }, live ? `Staff member added. Login: phone ${phone}, password ${pwd}` : "Staff member added. They can now sign in on the staff page.", async (sb) => {
      await peopleApi(sb, { kind: "staff", name, phone, manager, password: pwd });
    });
    if (ok) { setOpen(false); setName(""); setPhone(""); setMgr(false); }
  };
  const toggle = (id: string, on: boolean) => act((d) => {
    const u = setManager(d, actor, id, on);
    logAudit(d, actor, "team_changed", `${u.name} is ${on ? "now a warehouse manager (can book expenses)" : "no longer a manager"}`);
  }, on ? "Made manager. They can now book expenses." : "Manager rights removed", rpc("set_manager", { p_user: id, p_on: on }));
  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div><CardTitle>Warehouse staff & managers</CardTitle><CardDescription className="mt-1">They sign in on the staff page with their mobile number. Managers can also book expenses.</CardDescription></div>
        <Button variant="outline" onClick={() => setOpen(true)}><UserPlus /> Add staff</Button>
      </CardHeader>
      <CardContent>
        {staff.length === 0 ? <EmptyState title="No warehouse staff yet" hint="Add the people who do load sheets, approvals and end-of-day counts." /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Mobile</TableHead><TableHead className="text-right">Manager</TableHead></TableRow></TableHeader>
            <TableBody>{staff.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.name}{u.manager && <Badge variant="info" className="ml-1.5">Manager</Badge>}</TableCell>
                <TableCell className="tabular-nums">{u.phone}</TableCell>
                <TableCell className="text-right"><Switch checked={!!u.manager} onCheckedChange={(v) => toggle(u.id, v)} aria-label={`${u.name} is a manager`} /></TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add warehouse staff</DialogTitle><DialogDescription>Each person needs their own mobile number.</DialogDescription></DialogHeader>
          <div className="grid gap-3">
            <Field id="s-name" label="Name"><Input id="s-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field id="s-phone" label="Mobile"><Input id="s-phone" inputMode="tel" maxLength={14} placeholder="98450 12345" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d\s+]/g, ""))} /></Field>
            <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm" htmlFor="s-mgr">
              <span><span className="font-medium">Warehouse manager</span><span className="block text-xs text-muted-foreground">Can also book expenses</span></span>
              <Switch id="s-mgr" checked={manager} onCheckedChange={setMgr} />
            </label>
            {live && <Field id="s-pwd" label="First password" hint="They sign in on the staff page with their phone and this password."><Input id="s-pwd" className="font-mono" maxLength={64} value={pwd} onChange={(e) => setPwd(e.target.value.trim())} /></Field>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={!name.trim() || !phone.trim()}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// Live version only: the owner resets passwords and turns logins on or off.
export function LoginsCard() {
  const { db, act } = useStore();
  const [target, setTarget] = React.useState<{ id: string; name: string } | null>(null);
  const [pwd, setPwd] = React.useState(tempPassword);
  const people = db.users.filter((u) => u.role !== "owner").sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
  const ROLE: Record<string, string> = { warehouse: "Staff", driver: "Driver", customer: "Customer" };
  return (
    <Card className="mt-6">
      <CardHeader><CardTitle>App logins</CardTitle><CardDescription className="mt-1">Everyone signs in with their mobile number and password. Set a new password if someone forgets theirs; turn a login off when someone leaves.</CardDescription></CardHeader>
      <CardContent>
        {people.length === 0 ? <EmptyState title="No logins yet" hint="Logins are created when you add staff, trucks and customers." /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Role</TableHead><TableHead>Mobile</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>{people.map((u) => (
              <TableRow key={u.id} className={u.active === false ? "opacity-60" : ""}>
                <TableCell className="font-medium">{u.name}{u.active === false && <Badge variant="outline" className="ml-1.5">Off</Badge>}</TableCell>
                <TableCell>{u.role === "warehouse" && u.manager ? "Manager" : ROLE[u.role]}</TableCell>
                <TableCell className="tabular-nums">{u.phone}</TableCell>
                <TableCell className="space-x-2 text-right whitespace-nowrap">
                  <Button size="sm" variant="outline" onClick={() => { setPwd(tempPassword()); setTarget({ id: u.id, name: u.name }); }}>New password</Button>
                  <Button size="sm" variant="ghost" onClick={() => act(() => {}, u.active === false ? `${u.name} can sign in again` : `${u.name} can no longer sign in`, rpc("set_login_active", { p_user: u.id, p_on: u.active === false }))}>{u.active === false ? "Turn on" : "Turn off"}</Button>
                </TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
      </CardContent>
      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>New password for {target?.name}</DialogTitle><DialogDescription>Give this to them; they can change it after signing in.</DialogDescription></DialogHeader>
          <Field id="np" label="New password"><Input id="np" className="font-mono" maxLength={72} value={pwd} onChange={(e) => setPwd(e.target.value.trim())} /></Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button>
            <Button disabled={pwd.length < 8} onClick={async () => {
              const t = target!;
              const ok = await act(() => {}, `New password set for ${t.name}: ${pwd}`, (sb) => peopleApi(sb, { kind: "password", userId: t.id, password: pwd }));
              if (ok) setTarget(null);
            }}>Save password</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
