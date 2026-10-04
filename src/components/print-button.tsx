"use client";

export function PrintButton() {
  return <button onClick={() => window.print()} className="btn btn-ghost print:hidden">Print / Save PDF</button>;
}
