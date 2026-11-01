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
import { DateRange, downloadCSV, EmptyState, ExportButton, PageHeader, StatCard, useDateRange } from "@/components/app/common";
import { openPdf, ReceiptPicker, type PendingReceipt } from "@/components/app/receipts";
import { addExpense, canBookExpenses, deleteExpense, isSafeAttachment, logAudit } from "@/lib/engine";
import { dayKey, fmtDate, fmtDateShort, fmtDateTime, rupees, rupeesShort } from "@/lib/format";
import { useActorId } from "@/lib/hooks";
import { dailyProfit, type DayProfit } from "@/lib/selectors";
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
        <DialogHeader><DialogTitle>Book an expense</DialogTitle><DialogDescription>It is taken off that day&apos;s collection in the daily profit report.</DialogDescription></DialogHeader>
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
          <DialogHeader><DialogTitle>Delete this expense?</DialogTitle><DialogDescription>{e?.no} ({e && rupees(e.amount)}) will be removed and that day&apos;s profit goes up by the same amount. The activity log keeps a record of it.</DialogDescription></DialogHeader>
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
            <Table>
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
          )}
        </CardContent>
      </Card>
      <ExpenseDetail expense={selected} onClose={() => setSelected(null)} />
    </>
  );
}

// ---------- daily profit ----------

const axisMoney = (v: number) => {
  const a = Math.abs(v), sign = v < 0 ? "−" : "";
  return a >= 1e5 ? `${sign}₹${+(a / 1e5).toFixed(1)}L` : a >= 1000 ? `${sign}₹${Math.round(a / 1000)}k` : `${sign}₹${a}`;
};
const netClass = (n: number) => (n > 0 ? "text-success" : n < 0 ? "text-destructive" : "");
export const netText = (n: number) => (n < 0 ? `− ${rupees(-n)}` : rupees(n));

function ProfitTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{label ? fmtDateShort(label) : ""}</p>
      {payload.map((p) => <p key={p.name} className="flex items-center gap-2"><span className="inline-block size-2.5 rounded-sm" style={{ background: p.color }} />{p.name}: <b className="tabular-nums">{netText(p.value)}</b></p>)}
    </div>
  );
}

function DayBreakup({ day, onClose }: { day: DayProfit | null; onClose: () => void }) {
  const { db } = useStore();
  const L = useLookups();
  const list = day ? (db.expenses ?? []).filter((e) => e.date === day.date).sort((a, b) => b.amount - a.amount) : [];
  return (
    <Dialog open={!!day} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        {day && (
          <>
            <DialogHeader><DialogTitle>{fmtDate(day.date)}</DialogTitle><DialogDescription>Collected minus expenses for the day</DialogDescription></DialogHeader>
            <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
              <dt>Cash collected</dt><dd className="text-right tabular-nums">{rupees(day.cash)}</dd>
              <dt>UPI collected</dt><dd className="text-right tabular-nums">{rupees(day.upi)}</dd>
              {day.other > 0 && <><dt>Cheque / NEFT</dt><dd className="text-right tabular-nums">{rupees(day.other)}</dd></>}
              <dt className="border-t pt-1.5 font-medium">Total collected</dt><dd className="border-t pt-1.5 text-right font-medium tabular-nums">{rupees(day.collected)}</dd>
              {list.map((e) => (
                <React.Fragment key={e.id}>
                  <dt className="text-muted-foreground">− {e.category}{e.truckId ? ` · ${L.truck.get(e.truckId)?.regNo ?? ""}` : ""}{e.paidTo ? ` · ${e.paidTo}` : ""}</dt>
                  <dd className="text-right tabular-nums text-muted-foreground">{rupees(e.amount)}</dd>
                </React.Fragment>
              ))}
              <dt className="font-medium">Total expenses</dt><dd className="text-right font-medium tabular-nums">{rupees(day.expenses)}</dd>
              <dt className="border-t pt-2 text-base font-semibold">{day.net >= 0 ? "Net profit" : "Net loss"}</dt>
              <dd className={cn("border-t pt-2 text-right text-base font-semibold tabular-nums", netClass(day.net))}>{netText(day.net)}</dd>
            </dl>
            {day.pendingCollected > 0 && <p className="text-xs text-muted-foreground">Another {rupees(day.pendingCollected)} was collected on deliveries still waiting for approval. It counts once they are approved.</p>}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ProfitView() {
  const { db } = useStore();
  const r = useDateRange(7);
  const [open, setOpen] = React.useState<DayProfit | null>(null);
  const today = dayKey();
  const todayRow = React.useMemo(() => dailyProfit(db, today, today)[0], [db, today]);
  const rows = React.useMemo(() => dailyProfit(db, r.from, r.to), [db, r.from, r.to]);
  const t = rows.reduce((a, x) => ({ cash: a.cash + x.cash, upi: a.upi + x.upi, other: a.other + x.other, collected: a.collected + x.collected, expenses: a.expenses + x.expenses, net: a.net + x.net, pending: a.pending + x.pendingCollected }), { cash: 0, upi: 0, other: 0, collected: 0, expenses: 0, net: 0, pending: 0 });
  const chart = rows.slice().reverse().map((x) => ({ date: x.date, Collected: x.collected, Expenses: x.expenses, Net: x.net }));
  const exportCsv = () => downloadCSV(`daily_profit_${r.from}_${r.to}.csv`, [
    ["Date", "Cash collected", "UPI collected", "Cheque / NEFT", "Total collected", "Expenses", "Net profit / loss", "Awaiting approval (not counted)"],
    ...rows.map((x) => [x.date, x.cash, x.upi, x.other, x.collected, x.expenses, x.net, x.pendingCollected]),
    ["Total", t.cash, t.upi, t.other, t.collected, t.expenses, t.net, t.pending],
  ]);

  return (
    <>
      <PageHeader title="Daily profit" description="Net profit or loss = total amount collected that day (cash + UPI + cheque/NEFT) − that day's expenses." actions={<BookExpenseButton />} />
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Collected today" value={rupees(todayRow.collected)} hint={`Cash ${rupees(todayRow.cash)} · UPI ${rupees(todayRow.upi)}`} icon={Wallet} onClick={() => setOpen(todayRow)} />
        <StatCard label="Expenses today" value={rupees(todayRow.expenses)} icon={Receipt} tone={todayRow.expenses ? "warning" : "default"} onClick={() => setOpen(todayRow)} />
        <StatCard label={todayRow.net >= 0 ? "Net profit today" : "Net loss today"} value={netText(todayRow.net)} icon={todayRow.net >= 0 ? TrendingUp : TrendingDown} tone={todayRow.net > 0 ? "success" : todayRow.net < 0 ? "danger" : "default"} highlight onClick={() => setOpen(todayRow)}
          hint={todayRow.pendingCollected > 0 ? `+ ${rupees(todayRow.pendingCollected)} waiting for approval` : undefined} />
      </div>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><CardTitle>Day by day</CardTitle><CardDescription className="mt-1">Tap a day to see where the money went.</CardDescription></div>
            <ExportButton onClick={exportCsv} />
          </div>
          <DateRange from={r.from} to={r.to} onChange={r.set} />
        </CardHeader>
        <CardContent className="space-y-6">
          {rows.length > 1 && (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart} margin={{ left: 0, right: 8, top: 8 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="date" tickFormatter={(d) => fmtDateShort(d)} stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} minTickGap={16} />
                  <YAxis tickFormatter={axisMoney} stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} width={56} />
                  <Tooltip content={<ProfitTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Collected" fill="var(--success)" radius={[3, 3, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="Expenses" fill="var(--destructive)" radius={[3, 3, 0, 0]} maxBarSize={28} />
                  <Line dataKey="Net" stroke="var(--foreground)" strokeWidth={2} dot={{ r: 2.5 }} type="monotone" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          <Table className="text-xs sm:text-sm">
            <TableHeader><TableRow>
              <TableHead>Date</TableHead><TableHead className="hidden text-right sm:table-cell">Cash</TableHead><TableHead className="hidden text-right sm:table-cell">UPI</TableHead>
              <TableHead className="text-right">Collected</TableHead><TableHead className="text-right">Expenses</TableHead><TableHead className="text-right"><span className="sm:hidden">Net</span><span className="hidden sm:inline">Net profit / loss</span></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map((x) => (
                <TableRow key={x.date} className="cursor-pointer" onClick={() => setOpen(x)}>
                  <TableCell className="whitespace-nowrap">{fmtDateShort(x.date)}{x.date === today && <Badge variant="secondary" className="ml-1.5 hidden sm:inline-flex">Today</Badge>}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{rupees(x.cash)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{rupees(x.upi)}</TableCell>
                  <TableCell className="text-right tabular-nums">{rupees(x.collected)}</TableCell>
                  <TableCell className="text-right tabular-nums">{rupees(x.expenses)}</TableCell>
                  <TableCell className={cn("text-right font-semibold tabular-nums", netClass(x.net))}>{netText(x.net)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter><TableRow>
              <TableCell>Total</TableCell><TableCell className="hidden text-right tabular-nums sm:table-cell">{rupees(t.cash)}</TableCell><TableCell className="hidden text-right tabular-nums sm:table-cell">{rupees(t.upi)}</TableCell>
              <TableCell className="text-right tabular-nums">{rupees(t.collected)}</TableCell><TableCell className="text-right tabular-nums">{rupees(t.expenses)}</TableCell>
              <TableCell className={cn("text-right font-semibold tabular-nums", netClass(t.net))}>{netText(t.net)}</TableCell>
            </TableRow></TableFooter>
          </Table>
          <p className="text-xs text-muted-foreground">
            Collected = payments recorded that day: approved deliveries and payments taken at the office.{t.pending > 0 && ` ${rupees(t.pending)} collected on deliveries still waiting for approval isn't counted yet.`} Cylinder purchases from the plant are not included here.
          </p>
        </CardContent>
      </Card>
      <DayBreakup day={open} onClose={() => setOpen(null)} />
    </>
  );
}
