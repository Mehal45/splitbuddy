"use client";

// Expenses (booked by the owner or a warehouse manager) and the daily
// profit report: money collected that day minus that day's expenses.

import * as React from "react";
import { FileText, IndianRupee, Paperclip, Plus, Receipt, Trash2, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { DateRange, downloadCSV, EmptyState, ExportButton, PageHeader, PhoneRow, StatCard, useDateRange } from "@/components/app/common";
import { openPdf, ReceiptPicker, type PendingReceipt } from "@/components/app/receipts";
import { addExpense, canBookExpenses, deleteExpense, isSafeAttachment, logAudit } from "@/lib/engine";
import { dayKey, fmtDate, fmtDateShort, fmtDateTime, fmtMonth, rupees, rupeesShort } from "@/lib/format";
import { useActorId, useSizes } from "@/lib/hooks";
import { profitAndLoss, type PLStatement } from "@/lib/selectors";
import { useLookups, useStore } from "@/lib/store";
import { EXPENSE_CATEGORIES, type Attachment, type Expense, type ExpenseCategory } from "@/lib/types";
import { cn } from "@/lib/utils";

const MODE_LABEL: Record<Expense["mode"], string> = { cash: "Cash", upi: "UPI", bank: "Bank transfer" };

// ---------- book an expense ----------

function ExpenseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { db, act } = useStore();
  const actor = useActorId();
  const today = dayKey();
  const blank = { date: today, category: "" as ExpenseCategory | "", amount: "", mode: "cash" as Expense["mode"], paidTo: "", note: "", truckId: "" };
  const [f, setF] = React.useState(blank);
  const [files, setFiles] = React.useState<PendingReceipt[]>([]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const amount = Number(f.amount);
  const truckRelated = f.category === "Diesel / fuel" || f.category === "Truck repair & maintenance" || f.category === "Tolls & parking";
  const missing = !f.category ? "Pick the expense type" : !f.amount || amount < 1 ? "Enter the amount" : f.category === "Other" && !f.note.trim() ? "Write what it was for" : f.date > today ? "Date can't be in the future" : "";

  const save = () => {
    const ok = act((d) => {
      const e = addExpense(d, {
        date: f.date, ts: new Date().toISOString(), category: f.category as ExpenseCategory, amount, mode: f.mode, paidTo: f.paidTo, note: f.note,
        truckId: truckRelated ? f.truckId || undefined : undefined, userId: actor, today,
        attachments: files.map((r) => ({ ...r, uploadedBy: actor, ts: new Date().toISOString() })),
      });
      logAudit(d, actor, "expense_added", `${e.no} · ${e.category} · ${rupees(e.amount)} (${MODE_LABEL[e.mode]})${e.paidTo ? ` to ${e.paidTo}` : ""}${e.date !== today ? ` dated ${e.date}` : ""}`);
    }, "Expense booked");
    if (ok) { onOpenChange(false); setF(blank); setFiles([]); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Book an expense</DialogTitle><DialogDescription>Record money spent on running the business.</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="ex-cat">Expense type</Label>
            <Select value={f.category} onValueChange={(v) => set("category", v as ExpenseCategory)}>
              <SelectTrigger id="ex-cat" className="w-full"><SelectValue placeholder="Choose…" /></SelectTrigger>
              <SelectContent>{EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ex-amt">Amount (₹)</Label>
            <Input id="ex-amt" inputMode="numeric" maxLength={7} placeholder="0" value={f.amount} onChange={(e) => set("amount", e.target.value.replace(/\D/g, "").replace(/^0+/, ""))} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ex-date">Date spent</Label>
            <Input id="ex-date" type="date" value={f.date} max={today} onChange={(e) => set("date", e.target.value || today)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Paid by</Label>
            <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Paid by">
              {(Object.keys(MODE_LABEL) as Expense["mode"][]).map((m) => (
                <Button key={m} type="button" role="radio" aria-checked={f.mode === m} variant={f.mode === m ? "default" : "outline"} size="sm" onClick={() => set("mode", m)}>{m === "bank" ? "Bank" : MODE_LABEL[m]}</Button>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ex-to">Paid to <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input id="ex-to" maxLength={80} placeholder="e.g. Indian Oil, Peenya" value={f.paidTo} onChange={(e) => set("paidTo", e.target.value)} />
          </div>
          {truckRelated && (
            <div className="grid gap-1.5">
              <Label htmlFor="ex-truck">Truck <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Select value={f.truckId || "none"} onValueChange={(v) => set("truckId", v === "none" ? "" : v)}>
                <SelectTrigger id="ex-truck" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not for a truck</SelectItem>
                  {db.trucks.map((t) => <SelectItem key={t.id} value={t.id}>{t.regNo}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="ex-note">Note {f.category === "Other" ? "" : <span className="font-normal text-muted-foreground">(optional)</span>}</Label>
            <Textarea id="ex-note" maxLength={200} rows={2} placeholder={f.category === "Other" ? "What was this for?" : ""} value={f.note} onChange={(e) => set("note", e.target.value)} />
          </div>
          <div className="sm:col-span-2"><ReceiptPicker value={files} onChange={setFiles} title="Bill / receipt" hint="photo or PDF, optional" /></div>
        </div>
        <DialogFooter className="items-center">
          {missing && <p className="mr-auto text-sm text-muted-foreground">{missing}</p>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={!!missing}>Book {amount > 0 ? rupees(amount) : "expense"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BookExpenseButton({ size }: { size?: "default" | "xl" }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size={size} variant={size === "xl" ? "outline" : "default"} onClick={() => setOpen(true)}><Plus /> Book expense</Button>
      <ExpenseDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

// ---------- one expense ----------

function ExpenseDetail({ expense, onClose }: { expense: Expense | null; onClose: () => void }) {
  const { act, role } = useStore();
  const L = useLookups();
  const actor = useActorId();
  const [confirm, setConfirm] = React.useState(false);
  const [viewing, setViewing] = React.useState<Attachment | null>(null);
  const e = expense;
  const files = (e?.attachments ?? []).filter(isSafeAttachment);
  const remove = () => {
    const ok = act((d) => {
      const x = deleteExpense(d, actor, e!.id);
      logAudit(d, actor, "expense_deleted", `${x.no} · ${x.category} · ${rupees(x.amount)} dated ${x.date}, booked by ${L.user.get(x.by)?.name ?? "unknown"}`);
    }, "Expense deleted");
    if (ok) { setConfirm(false); onClose(); }
  };
  return (
    <>
      <Dialog open={!!e && !viewing} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-lg">
          {e && (
            <>
              <DialogHeader><DialogTitle>{e.category} · {rupees(e.amount)}</DialogTitle><DialogDescription>{e.no} · {fmtDate(e.date)}</DialogDescription></DialogHeader>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Paid by</dt><dd>{MODE_LABEL[e.mode]}</dd>
                {e.paidTo && <><dt className="text-muted-foreground">Paid to</dt><dd>{e.paidTo}</dd></>}
                {e.truckId && <><dt className="text-muted-foreground">Truck</dt><dd>{L.truck.get(e.truckId)?.regNo ?? "Removed truck"}</dd></>}
                {e.note && <><dt className="text-muted-foreground">Note</dt><dd className="whitespace-pre-wrap break-words">{e.note}</dd></>}
                <dt className="text-muted-foreground">Booked by</dt><dd>{L.user.get(e.by)?.name ?? "Unknown"} · {fmtDateTime(e.ts)}</dd>
              </dl>
              {files.length > 0 && (
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {files.map((a) => (
                    <li key={a.id}>
                      <button type="button" className="flex h-28 w-full items-center justify-center overflow-hidden rounded-md border bg-muted" onClick={() => (a.kind === "pdf" ? openPdf(a) : setViewing(a))} aria-label={`Open ${a.name}`}>
                        {a.kind === "pdf"
                          ? <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground"><FileText className="size-8" /> Open PDF</span>
                          // eslint-disable-next-line @next/next/no-img-element
                          : <img src={a.dataUrl} alt={a.name} className="size-full object-cover" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {role === "owner" && (
                <DialogFooter>
                  <Button variant="outline" className="text-destructive" onClick={() => setConfirm(true)}><Trash2 /> Delete expense</Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader><DialogTitle>{viewing?.name}</DialogTitle><DialogDescription>{e?.no}</DialogDescription></DialogHeader>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {viewing && <img src={viewing.dataUrl} alt={viewing.name} className="max-h-[70dvh] w-full rounded-md border object-contain" />}
        </DialogContent>
      </Dialog>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete this expense?</DialogTitle><DialogDescription>{e?.no} ({e && rupees(e.amount)}) will be removed. The activity log keeps a record of it.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={remove}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------- expenses page ----------

export function ExpensesView() {
  const { db, user } = useStore();
  const L = useLookups();
  const r = useDateRange(30);
  const [cat, setCat] = React.useState<string>("all");
  const [selected, setSelected] = React.useState<Expense | null>(null);
  const [open, setOpen] = React.useState(false);
  const today = dayKey();
  const all = db.expenses ?? [];

  if (!canBookExpenses(user)) {
    return (
      <>
        <PageHeader title="Expenses" />
        <Card><CardContent className="py-6"><EmptyState title="Only the owner and warehouse managers can see expenses" hint="Ask the owner to make you a manager if you need to book expenses." /></CardContent></Card>
      </>
    );
  }

  const rows = all.filter((e) => r.inRange(e.date) && (cat === "all" || e.category === cat)).sort((a, b) => (b.date + b.ts).localeCompare(a.date + a.ts));
  const total = rows.reduce((s, e) => s + e.amount, 0);
  const todayTotal = all.filter((e) => e.date === today).reduce((s, e) => s + e.amount, 0);
  const month = today.slice(0, 7);
  const monthTotal = all.filter((e) => e.date.startsWith(month)).reduce((s, e) => s + e.amount, 0);
  const byCat = EXPENSE_CATEGORIES.map((c) => ({ c, amt: rows.filter((e) => e.category === c).reduce((s, e) => s + e.amount, 0) })).filter((x) => x.amt).sort((a, b) => b.amt - a.amt);

  const exportCsv = () => downloadCSV(`expenses_${r.from}_${r.to}.csv`, [
    ["Expense no", "Date", "Type", "Amount", "Paid by", "Paid to", "Truck", "Note", "Bills attached", "Booked by", "Booked at"],
    ...rows.map((e) => [e.no, e.date, e.category, e.amount, MODE_LABEL[e.mode], e.paidTo, e.truckId ? L.truck.get(e.truckId)?.regNo ?? "" : "", e.note, e.attachments?.length ?? 0, L.user.get(e.by)?.name ?? "", fmtDateTime(e.ts)]),
  ]);

  return (
    <>
      <PageHeader title="Expenses" description="Diesel, salaries, hamali, rent and every other running cost. The owner and warehouse managers can book them."
        actions={<><ExportButton onClick={exportCsv} /><Button onClick={() => setOpen(true)}><Plus /> Book expense</Button></>} />
      <ExpenseDialog open={open} onOpenChange={setOpen} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Today" value={rupees(todayTotal)} icon={Wallet} highlight />
        <StatCard label="This month" value={rupeesShort(monthTotal)} icon={Receipt} />
        <StatCard label="Selected period" value={rupeesShort(total)} hint={`${rows.length} entries`} icon={IndianRupee} />
      </div>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <DateRange from={r.from} to={r.to} onChange={r.set} />
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground" htmlFor="ex-filter">Type</Label>
              <Select value={cat} onValueChange={setCat}>
                <SelectTrigger id="ex-filter" className="h-8 w-48"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All types</SelectItem>{EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {byCat.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {byCat.map((x) => <Badge key={x.c} variant="secondary" className="font-normal">{x.c}: <b className="ml-1 tabular-nums">{rupees(x.amt)}</b></Badge>)}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? <EmptyState title="No expenses in this period" hint="Tap 'Book expense' to add one." /> : (
            <>
            <div className="grid gap-2 sm:hidden">
              {rows.slice(0, 200).map((e) => (
                <PhoneRow key={e.id} onClick={() => setSelected(e)} title={<>{e.category}{!!e.attachments?.length && <Paperclip className="ml-1 inline size-3.5 text-muted-foreground" aria-label="Bill attached" />}</>}
                  sub={`${fmtDateShort(e.date)} · ${MODE_LABEL[e.mode]}${e.paidTo ? ` · ${e.paidTo}` : ""}${e.truckId ? ` · ${L.truck.get(e.truckId)?.regNo ?? ""}` : ""}`} right={rupees(e.amount)} />
              ))}
              <p className="flex justify-between px-1 pt-1 text-sm font-medium"><span>Total</span><span className="tabular-nums">{rupees(total)}</span></p>
            </div>
            <Table className="hidden sm:table">
              <TableHeader><TableRow>
                <TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead className="hidden md:table-cell">Paid to / note</TableHead>
                <TableHead className="hidden sm:table-cell">Paid by</TableHead><TableHead className="hidden lg:table-cell">Booked by</TableHead><TableHead className="text-right">Amount</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((e) => (
                  <TableRow key={e.id} className="cursor-pointer" onClick={() => setSelected(e)}>
                    <TableCell className="whitespace-nowrap">{fmtDateShort(e.date)}</TableCell>
                    <TableCell>
                      <span className="font-medium">{e.category}</span>
                      {e.truckId && <span className="ml-1 text-xs text-muted-foreground">· {L.truck.get(e.truckId)?.regNo}</span>}
                      {!!e.attachments?.length && <Paperclip className="ml-1 inline size-3.5 text-muted-foreground" aria-label="Bill attached" />}
                    </TableCell>
                    <TableCell className="hidden max-w-xs truncate text-muted-foreground md:table-cell">{[e.paidTo, e.note].filter(Boolean).join(" · ") || "—"}</TableCell>
                    <TableCell className="hidden sm:table-cell">{MODE_LABEL[e.mode]}</TableCell>
                    <TableCell className="hidden lg:table-cell">{L.user.get(e.by)?.name ?? "Unknown"}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{rupees(e.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter><TableRow><TableCell colSpan={2}>Total</TableCell><TableCell className="hidden md:table-cell" /><TableCell className="hidden sm:table-cell" /><TableCell className="hidden lg:table-cell" /><TableCell className="text-right tabular-nums">{rupees(total)}</TableCell></TableRow></TableFooter>
            </Table>
            </>
          )}
        </CardContent>
      </Card>
      <ExpenseDetail expense={selected} onClose={() => setSelected(null)} />
    </>
  );
}

// ---------- profit & loss ----------

const axisMoney = (v: number) => {
  const a = Math.abs(v), sign = v < 0 ? "−" : "";
  return a >= 1e5 ? `${sign}₹${+(a / 1e5).toFixed(1)}L` : a >= 1000 ? `${sign}₹${Math.round(a / 1000)}k` : `${sign}₹${Math.round(a)}`;
};
const netClass = (n: number) => (Math.round(n) > 0 ? "text-success" : Math.round(n) < 0 ? "text-destructive" : "");
/** Whole rupees; losses shown as − ₹x (non-breaking so it never wraps). */
export const netText = (n: number) => { const r = Math.round(n); return r < 0 ? `−\u00a0${rupees(-r)}` : rupees(r); };
const R0 = (n: number) => rupees(Math.round(n));

function ProfitTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{label && label.length === 10 ? fmtDateShort(label) : label}</p>
      {payload.map((p) => <p key={p.name} className="flex items-center gap-2"><span className="inline-block size-2.5 rounded-sm" style={{ background: p.color }} />{p.name}: <b className="tabular-nums">{netText(p.value)}</b></p>)}
    </div>
  );
}

// Indian financial year: 1 April to 31 March
const fyStart = (d: string) => { const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)); return `${m >= 4 ? y : y - 1}-04-01`; };
const shiftDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const fyLabel = (d: string) => { const s = Number(fyStart(d).slice(0, 4)); return `FY ${s}-${String(s + 1).slice(2)}`; };

function PLLine({ label, value, strong, indent, muted, testId, negative }: { label: React.ReactNode; value: number; strong?: boolean; indent?: boolean; muted?: boolean; testId?: string; negative?: boolean }) {
  return (
    <>
      <dt className={cn(indent && "pl-4", muted && "text-muted-foreground", strong && "font-semibold")}>{label}</dt>
      <dd data-testid={testId} data-value={Math.round(value)} className={cn("text-right tabular-nums", muted && "text-muted-foreground", strong && "font-semibold")}>{negative ? `(${R0(value)})` : R0(value)}</dd>
    </>
  );
}

function Statement({ pl, sizes }: { pl: PLStatement; sizes: { id: string; label: string }[] }) {
  const label = (id: string) => sizes.find((z) => z.id === id)?.label ?? `${id} kg`;
  const margin = pl.revenue ? (pl.gross / pl.revenue) * 100 : 0;
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
      <dt className="col-span-2 pt-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">I. Revenue from operations</dt>
      {pl.revenueBySize.map((x) => <PLLine key={x.size} indent muted label={`Sale of ${label(x.size)} refills · ${x.qty} cyl.`} value={x.amount} />)}
      <PLLine strong label="Total revenue (before GST)" value={pl.revenue} testId="pl-revenue" />

      <dt className="col-span-2 pt-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">II. Cost of cylinders sold</dt>
      <PLLine indent muted label={`Opening stock · ${pl.openingQty} full cyl.`} value={pl.openingValue} />
      <PLLine indent muted label={`Add: Purchases from plant · ${pl.purchaseQty} cyl. (before GST)`} value={pl.purchases} />
      <PLLine indent muted negative label={`Less: Closing stock · ${pl.closingQty} full cyl.`} value={pl.closingValue} />
      <PLLine strong label="Cost of cylinders sold" value={pl.cogs} testId="pl-cogs" />

      <dt className="border-t pt-2 font-semibold">Gross profit (I − II) <span className="font-normal text-muted-foreground">· {margin.toFixed(1)}% margin</span></dt>
      <dd data-testid="pl-gross" data-value={Math.round(pl.gross)} className={cn("border-t pt-2 text-right font-semibold tabular-nums", netClass(pl.gross))}>{netText(pl.gross)}</dd>

      <dt className="col-span-2 pt-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">III. Operating expenses</dt>
      {pl.expensesByCategory.length === 0 && <dt className="col-span-2 pl-4 text-muted-foreground">No expenses booked</dt>}
      {pl.expensesByCategory.map((x) => <PLLine key={x.category} indent muted label={x.category} value={x.amount} />)}
      <PLLine strong label="Total expenses" value={pl.expenses} testId="pl-expenses" />

      <dt className="border-t-2 border-foreground/70 pt-2 text-base font-bold">{Math.round(pl.net) >= 0 ? "Net profit" : "Net loss"} before tax (I − II − III)</dt>
      <dd data-testid="pl-net" data-value={Math.round(pl.net)} className={cn("border-t-2 border-foreground/70 pt-2 text-right text-base font-bold tabular-nums", netClass(pl.net))}>{netText(pl.net)}</dd>
    </dl>
  );
}

type Preset = "today" | "yesterday" | "month" | "lastMonth" | "fy" | "custom";

export function ProfitView() {
  const { db } = useStore();
  const sizes = useSizes();
  const today = dayKey();
  const [preset, setPreset] = React.useState<Preset>("month");
  const [custom, setCustom] = React.useState({ from: shiftDay(today, -6), to: today });
  const thisMonth = today.slice(0, 7) + "-01";
  const lastMonthStart = shiftDay(thisMonth, -1).slice(0, 7) + "-01";
  const range = preset === "today" ? { from: today, to: today }
    : preset === "yesterday" ? { from: shiftDay(today, -1), to: shiftDay(today, -1) }
    : preset === "month" ? { from: thisMonth, to: today }
    : preset === "lastMonth" ? { from: lastMonthStart, to: shiftDay(thisMonth, -1) }
    : preset === "fy" ? { from: fyStart(today), to: today }
    : custom;
  const pl = profitAndLoss(db, range.from, range.to);
  const monthly = pl.days.length > 62;
  const rows = (() => {
    if (!monthly) return pl.days.map((d) => ({ key: d.date, label: fmtDateShort(d.date), revenue: d.revenue, cogs: d.cogs, gross: d.gross, expenses: d.expenses, net: d.net }));
    const m = new Map<string, { key: string; label: string; revenue: number; cogs: number; gross: number; expenses: number; net: number }>();
    for (const d of pl.days) {
      const k = d.date.slice(0, 7);
      const r = m.get(k) ?? { key: k, label: fmtMonth(k), revenue: 0, cogs: 0, gross: 0, expenses: 0, net: 0 };
      r.revenue += d.revenue; r.cogs += d.cogs; r.gross += d.gross; r.expenses += d.expenses; r.net += d.net;
      m.set(k, r);
    }
    return [...m.values()];
  })();
  const chart = rows.slice().reverse().map((x) => ({ date: monthly ? x.label : x.key, "Gross profit": Math.round(x.gross), Expenses: Math.round(x.expenses), "Net profit": Math.round(x.net) }));
  const periodText = range.from === range.to ? fmtDate(range.from) : `${fmtDate(range.from)} – ${fmtDate(range.to)}`;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const exportCsv = () => downloadCSV(`profit_and_loss_${range.from}_${range.to}.csv`, [
    [`${db.settings.agencyName} · Profit & loss statement`], [`Period: ${periodText}`], ["All amounts in ₹, before GST"], [],
    ["I. Revenue from operations"], ...pl.revenueBySize.map((x) => [`Sale of ${x.size} kg refills (${x.qty} cyl.)`, r2(x.amount)]), ["Total revenue", r2(pl.revenue)], [],
    ["II. Cost of cylinders sold"], [`Opening stock (${pl.openingQty} full cyl.)`, r2(pl.openingValue)], [`Add: Purchases (${pl.purchaseQty} cyl.)`, r2(pl.purchases)], [`Less: Closing stock (${pl.closingQty} full cyl.)`, -r2(pl.closingValue)], ["Cost of cylinders sold", r2(pl.cogs)], [],
    ["Gross profit", r2(pl.gross)], [],
    ["III. Operating expenses"], ...pl.expensesByCategory.map((x) => [x.category, x.amount]), ["Total expenses", pl.expenses], [],
    ["Net profit / (loss) before tax", r2(pl.net)], [],
    [monthly ? "Month" : "Date", "Revenue", "Cost of cylinders sold", "Gross profit", "Expenses", "Net profit / (loss)"],
    ...rows.map((x) => [monthly ? x.key : x.key, r2(x.revenue), r2(x.cogs), r2(x.gross), x.expenses, r2(x.net)]),
  ]);
  const presets: [Preset, string][] = [["today", "Today"], ["yesterday", "Yesterday"], ["month", "This month"], ["lastMonth", "Last month"], ["fy", fyLabel(today)], ["custom", "Custom"]];

  return (
    <>
      <PageHeader title="Profit & loss" description="Revenue − cost of cylinders sold − expenses, before GST and before income tax. Only the owner can see this." actions={<><ExportButton onClick={exportCsv} /><BookExpenseButton /></>} />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {presets.map(([k, l]) => <Button key={k} size="sm" variant={preset === k ? "default" : "outline"} onClick={() => setPreset(k)}>{l}</Button>)}
      </div>
      {preset === "custom" && <div className="mb-4"><DateRange from={custom.from} to={custom.to} onChange={(from, to) => setCustom({ from, to })} /></div>}

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Revenue (before GST)" value={netText(pl.revenue)} hint={periodText} icon={Wallet} />
        <StatCard label="Gross profit" value={netText(pl.gross)} hint={pl.revenue ? `${((pl.gross / pl.revenue) * 100).toFixed(1)}% of revenue` : undefined} icon={IndianRupee} />
        <StatCard label="Expenses" value={netText(pl.expenses)} icon={Receipt} tone={pl.expenses ? "warning" : "default"} />
        <StatCard label={Math.round(pl.net) >= 0 ? "Net profit" : "Net loss"} value={netText(pl.net)} icon={pl.net >= 0 ? TrendingUp : TrendingDown} tone={Math.round(pl.net) > 0 ? "success" : Math.round(pl.net) < 0 ? "danger" : "default"} highlight
          hint={pl.pendingSales > 0 ? `+ deliveries worth ${R0(pl.pendingSales)} awaiting approval` : "before tax"} />
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>Statement of profit & loss</CardTitle><CardDescription className="mt-1">{db.settings.agencyName} · {periodText}</CardDescription></CardHeader>
          <CardContent>
            <Statement pl={pl} sizes={sizes} />
            <ul className="mt-5 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              <li>GST is not income or cost: GST collected on sales ({R0(pl.gstOnSales)}) is paid to the government, and GST on plant purchases ({R0(pl.gstOnPurchases)}) is claimed back as input tax credit. See Reports → GST summary.</li>
              <li>Stock = full cylinders at the warehouse and on trucks, valued at the average purchase cost before GST. Shortages and defective cylinders show up as a higher cost of cylinders sold.</li>
              <li>Empty cylinders and customer security deposits are not income. Expenses are counted at the full bill amount on the day they were paid.</li>
              <li>Sales are counted when the delivery is approved and invoiced{pl.pendingSales > 0 ? `; deliveries worth ${R0(pl.pendingSales)} (incl. GST) are still waiting for approval` : ""}. Depreciation and income tax are not included; your CA adds them in the final accounts.</li>
            </ul>
          </CardContent>
        </Card>

        <Card className="xl:col-span-3">
          <CardHeader><CardTitle>{monthly ? "Month by month" : "Day by day"}</CardTitle><CardDescription className="mt-1">Net = gross profit − expenses</CardDescription></CardHeader>
          <CardContent className="space-y-6">
            {rows.length > 1 && (
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chart} margin={{ left: 0, right: 8, top: 8 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="date" tickFormatter={(d: string) => (d.length === 10 ? fmtDateShort(d) : d)} stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} minTickGap={16} />
                    <YAxis tickFormatter={axisMoney} stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} width={56} />
                    <Tooltip content={<ProfitTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Gross profit" fill="var(--success)" radius={[3, 3, 0, 0]} maxBarSize={22} />
                    <Bar dataKey="Expenses" fill="var(--destructive)" radius={[3, 3, 0, 0]} maxBarSize={22} />
                    <Line dataKey="Net profit" stroke="var(--foreground)" strokeWidth={2} dot={{ r: 2 }} type="monotone" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
            <Table className="text-xs sm:text-sm">
              <TableHeader><TableRow>
                <TableHead>{monthly ? "Month" : "Date"}</TableHead><TableHead className="hidden text-right sm:table-cell">Revenue</TableHead><TableHead className="hidden text-right md:table-cell">Cost of sales</TableHead>
                <TableHead className="text-right">Gross</TableHead><TableHead className="text-right">Expenses</TableHead><TableHead className="text-right">Net</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((x) => (
                  <TableRow key={x.key}>
                    <TableCell className="whitespace-nowrap">{x.label}{x.key === today && <Badge variant="secondary" className="ml-1.5 hidden sm:inline-flex">Today</Badge>}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{R0(x.revenue)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{R0(x.cogs)}</TableCell>
                    <TableCell className="text-right tabular-nums">{netText(x.gross)}</TableCell>
                    <TableCell className="text-right tabular-nums">{R0(x.expenses)}</TableCell>
                    <TableCell className={cn("text-right font-semibold tabular-nums", netClass(x.net))}>{netText(x.net)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter><TableRow>
                <TableCell>Total</TableCell><TableCell className="hidden text-right tabular-nums sm:table-cell">{R0(pl.revenue)}</TableCell><TableCell className="hidden text-right tabular-nums md:table-cell">{R0(pl.cogs)}</TableCell>
                <TableCell className="text-right tabular-nums">{netText(pl.gross)}</TableCell><TableCell className="text-right tabular-nums">{R0(pl.expenses)}</TableCell>
                <TableCell className={cn("text-right font-semibold tabular-nums", netClass(pl.net))}>{netText(pl.net)}</TableCell>
              </TableRow></TableFooter>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
