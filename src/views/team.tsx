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
import { addStaff, addTruckWithDriver, logAudit } from "@/lib/engine";
import { useActorId } from "@/lib/hooks";
import { useStore } from "@/lib/store";

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
  const { act } = useStore();
  const actor = useActorId();
  const [open, setOpen] = React.useState(false);
  const [f, setF] = React.useState({ regNo: "", model: "Tata 407", capacity: "80", driverName: "", phone: "", licenseNo: "" });
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  const save = () => {
    const ok = act((d) => {
      const { truck, driver } = addTruckWithDriver(d, { ...f, capacity: Number(f.capacity) || 0 });
      logAudit(d, actor, "team_changed", `Added truck ${truck.regNo} with driver ${driver.name}`);
    }, "Truck and driver added. The driver can now sign in on the driver page.");
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
  const { db, act } = useStore();
  const actor = useActorId();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const staff = db.users.filter((u) => u.role === "warehouse");
  const save = () => {
    const ok = act((d) => {
      const u = addStaff(d, { name, phone });
      logAudit(d, actor, "team_changed", `Added warehouse staff ${u.name}`);
    }, "Staff member added. They can now sign in on the staff page.");
    if (ok) { setOpen(false); setName(""); setPhone(""); }
  };
  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div><CardTitle>Warehouse staff</CardTitle><CardDescription className="mt-1">They sign in on the staff page with their mobile number.</CardDescription></div>
        <Button variant="outline" onClick={() => setOpen(true)}><UserPlus /> Add staff</Button>
      </CardHeader>
      <CardContent>
        {staff.length === 0 ? <EmptyState title="No warehouse staff yet" hint="Add the people who do load sheets, approvals and end-of-day counts." /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Mobile</TableHead></TableRow></TableHeader>
            <TableBody>{staff.map((u) => <TableRow key={u.id}><TableCell className="font-medium">{u.name}</TableCell><TableCell className="tabular-nums">{u.phone}</TableCell></TableRow>)}</TableBody>
          </Table>
        )}
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add warehouse staff</DialogTitle><DialogDescription>Each person needs their own mobile number.</DialogDescription></DialogHeader>
          <div className="grid gap-3">
            <Field id="s-name" label="Name"><Input id="s-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field id="s-phone" label="Mobile"><Input id="s-phone" inputMode="tel" maxLength={14} placeholder="98450 12345" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d\s+]/g, ""))} /></Field>
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
