"use client";

import { useEffect, useRef } from "react";

/** Horizontal scroller that opens in the middle, so a wide tree shows its top person first on a phone. */
export function CenterScroll({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.scrollWidth > el.clientWidth) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, []);
  return <div ref={ref} className={className}>{children}</div>;
}
