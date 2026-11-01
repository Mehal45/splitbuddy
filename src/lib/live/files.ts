// Files in the private "files" bucket: upload from the browser into the person's
// own folder, show them through short-lived signed links.

import * as React from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LIVE, supabase } from "./client";

function dataUrlToBlob(dataUrl: string) {
  const [head, b64] = dataUrl.split(",");
  const type = /data:([^;]+)/.exec(head)?.[1] ?? "application/octet-stream";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Uploads a JPEG/PDF data URL to <folder>/<userId>/<random>.<ext> and returns the path. */
export async function uploadDataUrl(sb: SupabaseClient, folder: "deliveries" | "receipts" | "expenses", dataUrl: string) {
  const { data: u } = await sb.auth.getUser();
  if (!u.user) throw new Error("Please sign in again.");
  const pdf = dataUrl.startsWith("data:application/pdf");
  const path = `${folder}/${u.user.id}/${crypto.randomUUID()}.${pdf ? "pdf" : "jpg"}`;
  const { error } = await sb.storage.from("files").upload(path, dataUrlToBlob(dataUrl), { contentType: pdf ? "application/pdf" : "image/jpeg", upsert: false });
  if (error) throw error;
  return path;
}

const cache = new Map<string, { url: string; until: number }>();

/** Signed link for a stored file (cached for a while). Returns null until ready. */
export function useFileUrl(path?: string | null) {
  const [url, setUrl] = React.useState<string | null>(() => {
    const hit = path ? cache.get(path) : undefined;
    return hit && hit.until > Date.now() ? hit.url : null;
  });
  React.useEffect(() => {
    if (!LIVE || !path || path.startsWith("ph:") || path.startsWith("data:")) return;
    const hit = cache.get(path);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- cached link for a new path
    if (hit && hit.until > Date.now()) { setUrl(hit.url); return; }
    let alive = true;
    supabase().storage.from("files").createSignedUrl(path, 3600).then(({ data }) => {
      if (!alive || !data?.signedUrl) return;
      cache.set(path, { url: data.signedUrl, until: Date.now() + 50 * 60_000 });
      setUrl(data.signedUrl);
    });
    return () => { alive = false; };
  }, [path]);
  return url;
}

export async function signedUrl(path: string) {
  const { data, error } = await supabase().storage.from("files").createSignedUrl(path, 600);
  if (error || !data) throw error ?? new Error("File not found");
  return data.signedUrl;
}
