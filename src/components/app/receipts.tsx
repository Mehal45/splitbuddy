"use client";

// Upload and view purchase receipts (photos or PDFs of the plant's invoice).
// Photos are re-encoded as JPEG (which also drops anything hidden in the file);
// PDFs are accepted only if their first bytes really are a PDF.

import * as React from "react";
import { Camera, FileText, Paperclip, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { attachToInvoice, isSafeAttachment, logAudit, MAX_RECEIPT_BYTES, MAX_RECEIPTS_PER_INVOICE, removeAttachment } from "@/lib/engine";
import { fmtDateTime } from "@/lib/format";
import { useActorId } from "@/lib/hooks";
import { signedUrl, uploadDataUrl, useFileUrl } from "@/lib/live/files";
import { cn } from "@/lib/utils";
import { rpc, useLookups, useStore } from "@/lib/store";
import type { Attachment, Invoice } from "@/lib/types";

export type PendingReceipt = Omit<Attachment, "id" | "uploadedBy" | "ts">;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ACCEPT = [...IMAGE_TYPES, "application/pdf", ".pdf"].join(",");
const base64Bytes = (dataUrl: string) => Math.floor(((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4);
const sizeText = (b: number) => (b >= 1_000_000 ? `${(b / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1000))} KB`);

function readAsDataUrl(file: Blob) {
  return new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

async function photoToJpeg(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    // Big enough to read printed figures on a receipt, small enough to store
    for (const [maxSide, quality] of [[1800, 0.8], [1400, 0.7], [1100, 0.6]] as const) {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff"; // transparent PNGs become white paper, not black
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const out = canvas.toDataURL("image/jpeg", quality);
      if (base64Bytes(out) <= MAX_RECEIPT_BYTES) return out;
    }
    throw new Error("too big");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Turns a chosen file into a safe receipt, or throws a message for the user. */
export async function readReceiptFile(file: File): Promise<PendingReceipt> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (IMAGE_TYPES.includes(file.type)) {
    if (file.size > 30 * 1024 * 1024) throw new Error(`${file.name}: photo is too large (over 30 MB).`);
    let dataUrl: string;
    try { dataUrl = await photoToJpeg(file); } catch { throw new Error(`${file.name}: couldn't read this photo. Try taking it again.`); }
    return { name: file.name.replace(/\.(png|webp|jpe?g)$/i, "") + ".jpg", kind: "image", dataUrl, bytes: base64Bytes(dataUrl) };
  }
  if (isPdf) {
    if (file.size > MAX_RECEIPT_BYTES) throw new Error(`${file.name}: PDF is too large (max 1.5 MB). Scan at a lower quality or take a photo instead.`);
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    if (String.fromCharCode(...head) !== "%PDF-") throw new Error(`${file.name}: this isn't a real PDF file.`);
    const raw = await readAsDataUrl(file);
    const dataUrl = "data:application/pdf;base64," + raw.slice(raw.indexOf(",") + 1);
    return { name: file.name, kind: "pdf", dataUrl, bytes: base64Bytes(dataUrl) };
  }
  if (/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)) {
    throw new Error(`${file.name}: iPhone HEIC photos aren't supported here. In iPhone Settings > Camera > Formats choose "Most Compatible", or take a screenshot of the photo.`);
  }
  throw new Error(`${file.name}: only JPG or PNG photos and PDF files can be uploaded.`);
}

function useFilePickers(onFiles: (files: File[]) => void) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const camRef = React.useRef<HTMLInputElement>(null);
  const inputs = (
    <>
      <input ref={fileRef} type="file" accept={ACCEPT} multiple className="hidden" aria-label="Choose receipt files"
        onChange={(e) => { onFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" aria-label="Take receipt photo"
        onChange={(e) => { onFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
    </>
  );
  return { inputs, pickFile: () => fileRef.current?.click(), takePhoto: () => camRef.current?.click() };
}

async function processFiles(files: File[], room: number) {
  const ok: PendingReceipt[] = [];
  for (const f of files) {
    if (ok.length >= room) { toast.error(`Only ${MAX_RECEIPTS_PER_INVOICE} receipts per purchase.`); break; }
    try { ok.push(await readReceiptFile(f)); } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't use that file."); }
  }
  return ok;
}

/** Picker used inside the "Record stock receipt" form (files are saved with the purchase). */
export function ReceiptPicker({ value, onChange, title = "Plant receipt", hint = "photo or PDF of the invoice, optional" }: { value: PendingReceipt[]; onChange: (v: PendingReceipt[]) => void; title?: string; hint?: string }) {
  const [busy, setBusy] = React.useState(false);
  const { inputs, pickFile, takePhoto } = useFilePickers(async (files) => {
    setBusy(true);
    try { onChange([...value, ...(await processFiles(files, MAX_RECEIPTS_PER_INVOICE - value.length))]); }
    finally { setBusy(false); }
  });
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{title} <span className="font-normal text-muted-foreground">· {hint}</span></p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={takePhoto} disabled={busy || value.length >= MAX_RECEIPTS_PER_INVOICE}><Camera /> Take photo</Button>
          <Button type="button" variant="outline" size="sm" onClick={pickFile} disabled={busy || value.length >= MAX_RECEIPTS_PER_INVOICE}><Upload /> {busy ? "Reading…" : "Upload file"}</Button>
        </div>
      </div>
      {inputs}
      {value.length > 0 && (
        <ul className="grid gap-1.5">
          {value.map((r, i) => (
            <li key={i} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
              {r.kind === "pdf" ? <FileText className="size-4 shrink-0 text-muted-foreground" /> : <Paperclip className="size-4 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{sizeText(r.bytes)}</span>
              <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={`Remove ${r.name}`} onClick={() => onChange(value.filter((_, k) => k !== i))}><X /></Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A stored photo: from the private bucket (live) or embedded data (demo). */
export function FileImg({ a, className }: { a: Attachment; className?: string }) {
  const remote = useFileUrl(a.path);
  const src = a.path ? remote : a.dataUrl;
  if (!src) return <span className={cn("block animate-pulse bg-muted", className)} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={a.name} className={className} />;
}

export function openPdf(a: Attachment) {
  if (a.path) {
    const w = window.open("", "_blank");
    signedUrl(a.path).then((u) => { if (w) w.location.href = u; else window.location.assign(u); }).catch(() => { w?.close(); toast.error("Couldn't open that file."); });
    return;
  }
  const bin = atob(a.dataUrl.slice(a.dataUrl.indexOf(",") + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const w = window.open(url, "_blank");
  if (!w) {
    // Pop-up blocked: download instead
    const link = document.createElement("a");
    link.href = url; link.download = a.name.endsWith(".pdf") ? a.name : `${a.name}.pdf`;
    document.body.appendChild(link); link.click(); link.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Receipts on a purchase invoice: view, add more, and (owner only) remove. */
export function InvoiceReceipts({ invoice }: { invoice: Invoice }) {
  const { act, role } = useStore();
  const L = useLookups();
  const actor = useActorId();
  const [viewing, setViewing] = React.useState<Attachment | null>(null);
  const [removing, setRemoving] = React.useState<Attachment | null>(null);
  const [busy, setBusy] = React.useState(false);
  const list = (invoice.attachments ?? []).filter((a) => a.path || isSafeAttachment(a));
  const canAdd = role === "owner" || role === "warehouse";
  const canRemove = role === "owner";
  const { inputs, pickFile, takePhoto } = useFilePickers(async (files) => {
    setBusy(true);
    try {
      const ready = await processFiles(files, MAX_RECEIPTS_PER_INVOICE - list.length);
      if (!ready.length) return;
      act((d) => {
        for (const r of ready) {
          const att = attachToInvoice(d, invoice.id, { ...r, uploadedBy: actor, ts: new Date().toISOString() });
          logAudit(d, actor, "receipt_attached", `${att.name} (${sizeText(att.bytes)}) on ${invoice.no}`);
        }
      }, ready.length === 1 ? "Receipt uploaded" : `${ready.length} receipts uploaded`, async (sb) => {
        for (const r of ready) await rpc("attach_receipt", { p_invoice: invoice.id, p_file: { name: r.name, kind: r.kind, bytes: r.bytes, path: await uploadDataUrl(sb, "receipts", r.dataUrl) } })(sb);
      });
    } finally { setBusy(false); }
  });

  return (
    <div className="no-print grid gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">Plant receipts</p>
          <p className="text-sm text-muted-foreground">{list.length ? `${list.length} attached` : "No receipt attached yet"}</p>
        </div>
        {canAdd && list.length < MAX_RECEIPTS_PER_INVOICE && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={takePhoto} disabled={busy}><Camera /> Take photo</Button>
            <Button size="sm" onClick={pickFile} disabled={busy}><Upload /> {busy ? "Reading…" : "Attach receipt"}</Button>
          </div>
        )}
      </div>
      {inputs}
      {list.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((a) => (
            <li key={a.id} className="grid gap-2 rounded-md border p-2">
              <button type="button" className="flex h-36 items-center justify-center overflow-hidden rounded bg-muted" onClick={() => (a.kind === "pdf" ? openPdf(a) : setViewing(a))} aria-label={`Open ${a.name}`}>
                {a.kind === "pdf"
                  ? <span className="flex flex-col items-center gap-1 text-sm text-muted-foreground"><FileText className="size-10" /> Open PDF</span>
                  : <FileImg a={a} className="size-full object-cover" />}
              </button>
              <div className="flex items-start justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{a.name}</p>
                  <p className="text-muted-foreground">{sizeText(a.bytes)} · {L.user.get(a.uploadedBy)?.name ?? "Unknown"} · {fmtDateTime(a.ts)}</p>
                </div>
                {canRemove && <Button variant="ghost" size="icon" className="size-7 shrink-0 text-destructive" aria-label={`Remove ${a.name}`} onClick={() => setRemoving(a)}><Trash2 /></Button>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader><DialogTitle>{viewing?.name}</DialogTitle><DialogDescription>Uploaded by {viewing && (L.user.get(viewing.uploadedBy)?.name ?? "Unknown")} · {viewing && fmtDateTime(viewing.ts)}</DialogDescription></DialogHeader>
          {viewing && <FileImg a={viewing} className="max-h-[70dvh] w-full rounded-md border object-contain" />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Remove this receipt?</DialogTitle><DialogDescription>{removing?.name} will be removed from {invoice.no}. This is recorded in the activity log.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => {
              const target = removing!;
              act((d) => { removeAttachment(d, invoice.id, target.id); logAudit(d, actor, "receipt_removed", `${target.name} from ${invoice.no}`); }, "Receipt removed", async (sb) => {
                const path = await rpc("remove_attachment", { p_id: target.id })(sb);
                if (typeof path === "string") await sb.storage.from("files").remove([path]);
              });
              setRemoving(null);
            }}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
