"use client";

import { useState } from "react";
import { Check, Copy, MessageCircle } from "lucide-react";

export function ShareLink({ url, label, qr, text }: { url: string; label: string; qr: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="card p-5 flex flex-col items-center text-center min-w-0">
      <p className="text-sm font-bold">{label}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt={`QR code for ${label}`} className="mt-4 h-44 w-44 rounded-xl border border-line bg-white p-2" />
      <p className="mt-3 w-full truncate rounded-lg bg-surface2 px-3 py-2 font-mono text-xs text-muted">{url}</p>
      <div className="mt-3 flex w-full gap-2">
        <button type="button" className="btn btn-ghost flex-1" onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); }}>
          {copied ? <Check className="h-4 w-4 text-green" /> : <Copy className="h-4 w-4" />}{copied ? "Copied" : "Copy"}
        </button>
        <a className="btn flex-1 bg-[#25D366] text-white" href={`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`} target="_blank" rel="noreferrer">
          <MessageCircle className="h-4 w-4" /> WhatsApp
        </a>
      </div>
    </div>
  );
}
