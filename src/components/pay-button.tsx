"use client";

import { useState } from "react";
import { withBase } from "@/lib/base";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

type RzpResponse = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
declare global { interface Window { Razorpay?: new (o: Record<string, unknown>) => { open(): void } } }

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => ok(); s.onerror = () => fail(new Error("Could not load the payment window. Check your internet."));
    document.body.appendChild(s);
  });
}

export function PayButton({ kind, label }: { kind: "activation" | "renewal"; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);

  async function pay() {
    setBusy(true); setMsg(null);
    try {
      await loadCheckout();
      const r = await fetch(withBase("/api/pay/order"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind }) });
      const o = await r.json();
      if (!r.ok) throw new Error(o.error ?? "Could not start the payment.");
      const rzp = new window.Razorpay!({
        key: o.key, order_id: o.orderId, amount: o.amount, currency: "INR",
        name: "Shubhora Business Suite", description: kind === "renewal" ? "Monthly renewal" : "Activation",
        prefill: { name: o.name }, notes: { partner_id: o.code }, theme: { color: "#2f5bf5" },
        modal: { ondismiss: () => setBusy(false) },
        handler: async (resp: RzpResponse) => {
          const v = await fetch(withBase("/api/pay/verify"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(resp) });
          const j = await v.json();
          if (v.ok) { setMsg({ tone: "green", text: "Payment received. Your ID is updated." }); router.refresh(); }
          else setMsg({ tone: "red", text: j.error ?? "Payment could not be confirmed. If money was taken, contact support." });
          setBusy(false);
        },
      });
      rzp.open();
    } catch (e) {
      setMsg({ tone: "red", text: (e as Error).message }); setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <button onClick={pay} disabled={busy} className="btn btn-primary w-full">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{label}</button>
      {msg && <p className={`rounded-lg px-3 py-2 text-sm font-medium ${msg.tone === "green" ? "bg-green-soft text-green" : "bg-red-soft text-red"}`}>{msg.text}</p>}
    </div>
  );
}
