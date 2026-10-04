"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Info, X } from "lucide-react";

/** Small "i" button. Click (or tap) shows a short guide; click outside or press Esc to close. */
export function InfoTip({ title, children, align = "left" }: { title?: string; children: React.ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  return (
    <span ref={box} className="relative inline-flex align-middle">
      <button type="button" aria-label={title ? `About: ${title}` : "More information"} aria-expanded={open} aria-controls={id}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
        className="grid h-[18px] w-[18px] place-items-center rounded-full border border-current text-faint hover:text-brand transition-colors">
        <Info className="h-3 w-3" strokeWidth={2.5} />
      </button>
      {open && (
        <span id={id} role="dialog" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          className={`absolute top-6 z-40 w-72 max-w-[80vw] rounded-xl border border-line bg-surface p-3.5 text-left text-[13px] font-normal normal-case tracking-normal leading-relaxed text-ink shadow-xl ${align === "right" ? "right-0" : "left-0"}`}>
          <span className="flex items-start justify-between gap-2">
            {title && <b className="block text-sm mb-1">{title}</b>}
            <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="text-faint hover:text-ink -mr-1"><X className="h-3.5 w-3.5" /></button>
          </span>
          <span className="block text-muted">{children}</span>
        </span>
      )}
    </span>
  );
}
