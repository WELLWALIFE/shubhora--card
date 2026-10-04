"use client";

import { useState } from "react";
import { FileText, Loader2, Upload as UploadIcon, X } from "lucide-react";
import { withBase } from "@/lib/base";

/** Shrinks a photo in the browser before upload: longest side at most `max` px, saved as JPEG. */
export async function shrinkImage(file: File, max = 1600, quality = 0.82): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale); const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob: Blob | null = await new Promise((ok) => canvas.toBlob(ok, "image/jpeg", quality));
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}

/** File picker that shrinks photos, uploads, and puts the stored file id in a hidden input named `name`. */
export function UploadField({ name, kind, label, current, accept = "image/*", hint, maxDim = 1600 }: {
  name: string; kind: string; label: string; current?: string | null; accept?: string; hint?: string; maxDim?: number;
}) {
  const [id, setId] = useState<string | null>(current ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy(true); setErr(null); setInfo(null);
    try {
      const small = await shrinkImage(f, maxDim);
      const fd = new FormData();
      fd.append("file", small); fd.append("kind", kind);
      const r = await fetch(withBase("/api/upload"), { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Upload failed.");
      setId(j.id);
      setInfo(small !== f ? `Uploaded (reduced from ${(f.size / 1024).toFixed(0)} KB to ${(small.size / 1024).toFixed(0)} KB)` : "Uploaded");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div>
      <span className="label">{label}</span>
      <input type="hidden" name={name} value={id ?? ""} />
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-line bg-surface p-3">
        {id ? (
          <a href={withBase(`/files/${id}`)} target="_blank" rel="noreferrer" className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={withBase(`/files/${id}`)} alt="" className="h-14 w-14 rounded-lg object-cover bg-surface2" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          </a>
        ) : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-surface2 text-faint"><FileText className="h-5 w-5" /></span>}
        <div className="min-w-0 flex-1 text-sm">
          <label className="btn btn-ghost cursor-pointer py-1.5 text-xs">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadIcon className="h-3.5 w-3.5" />}{id ? "Change" : "Choose file"}
            <input type="file" accept={accept} className="sr-only" disabled={busy} onChange={(e) => pick(e.target.files?.[0])} />
          </label>
          {id && <button type="button" onClick={() => { setId(null); setInfo(null); }} className="ml-2 inline-flex items-center gap-1 text-xs text-faint hover:text-red"><X className="h-3 w-3" />Remove</button>}
          {info && <p className="mt-1 text-xs text-green">{info}</p>}
          {err && <p className="mt-1 text-xs text-red">{err}</p>}
          {!info && !err && hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
        </div>
      </div>
    </div>
  );
}
