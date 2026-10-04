"use client";
// Staff Admin → Activate IDs: ready-made choices that fill the form (free leader entry, free with full BV, paid, part
// payment…); every field stays editable. The server action (adminActivateAction) records each activation.
import { useState } from "react";
import { ActionForm } from "@/components/forms";
import { adminActivateAction } from "@/app/actions/admin";

type Preset = { id: string; title: string; note: string; amount: string; bvMode: "none" | "full" | "custom"; bv?: string };

export function ActivateForm({ planBv, planPrice }: { planBv: number; planPrice: number }) {
  const PRESETS: Preset[] = [
    { id: "free-0bv", title: "Free entry · 0 BV", note: "Leader / staff / demo ID. Green, but nobody's pairs or bonus change.", amount: "0", bvMode: "none" },
    { id: "free-full-bv", title: "Free entry · full BV", note: `No money taken, but ${planBv.toLocaleString("en-IN")} BV goes up the tree: sponsor bonus + pairs, like a real sale.`, amount: "0", bvMode: "full" },
    { id: "paid-full", title: "Paid · cash / UPI / bank", note: `Money received outside the app. Full ₹${planPrice.toLocaleString("en-IN")}, full BV, GST invoice.`, amount: String(planPrice), bvMode: "full" },
    { id: "paid-part", title: "Part payment / discount", note: "Any amount received, any BV (e.g. ₹1,500 and half BV). Invoice for the amount.", amount: String(Math.round(planPrice / 2)), bvMode: "custom", bv: String(Math.round(planBv / 2)) },
    { id: "custom", title: "Custom", note: "Set every field yourself.", amount: "0", bvMode: "custom", bv: "0" },
  ];
  const [mode, setMode] = useState("free-0bv");
  const [amount, setAmount] = useState("0");
  const [bvMode, setBvMode] = useState<"none" | "full" | "custom">("none");
  const [bv, setBv] = useState("0");
  const [months, setMonths] = useState("1");
  const [appPlan, setAppPlan] = useState("1");
  const [kind, setKind] = useState("auto");

  function pick(p: Preset) { setMode(p.id); setAmount(p.amount); setBvMode(p.bvMode); if (p.bv) setBv(p.bv); }
  const paid = Number(amount) > 0;
  const bvShown = bvMode === "none" ? 0 : bvMode === "full" ? planBv : Number(bv) || 0;

  return (
    <ActionForm action={adminActivateAction} submit="Activate now">
      <input type="hidden" name="mode" value={mode} />
      <div>
        <p className="label">1 · Which kind of activation?</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" onClick={() => pick(p)}
              className={`rounded-xl border p-3 text-left transition-colors ${mode === p.id ? "border-brand bg-brand-soft" : "border-line hover:bg-black/[.02]"}`}>
              <span className="block text-sm font-bold">{p.title}</span>
              <span className="mt-0.5 block text-xs text-muted">{p.note}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label" htmlFor="handles">2 · IDs — username or SH code (one or many, one per line)</label>
        <textarea id="handles" name="handles" rows={3} required className="input font-mono" placeholder={"Next_Level\nSH100066"} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor="amount">Money received (₹, incl. GST)</label>
          <input id="amount" name="amount" type="number" min={0} step="1" value={amount} onChange={(e) => { setAmount(e.target.value); setMode((m) => (m.startsWith("free") && Number(e.target.value) > 0 ? "custom" : m)); }} className="input" />
          <p className="mt-1 text-xs text-faint">{paid ? "GST invoice is made for this amount." : "0 = free (no invoice)."}</p>
        </div>
        <div>
          <label className="label" htmlFor="bvMode">BV into the tree</label>
          <select id="bvMode" name="bvMode" value={bvMode} onChange={(e) => setBvMode(e.target.value as "none" | "full" | "custom")} className="input">
            <option value="none">0 BV (no pairs, no sponsor bonus)</option>
            <option value="full">Full BV ({planBv.toLocaleString("en-IN")})</option>
            <option value="custom">Custom BV…</option>
          </select>
          {bvMode === "custom" && <input name="bv" type="number" min={0} step="1" value={bv} onChange={(e) => setBv(e.target.value)} className="input mt-2" placeholder="e.g. 1250" />}
        </div>
        <div>
          <label className="label" htmlFor="months">Validity</label>
          <select id="months" name="months" value={months} onChange={(e) => setMonths(e.target.value)} className="input">
            {[1, 2, 3, 6, 12].map((m) => <option key={m} value={m}>{m} month{m > 1 ? "s" : ""}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="appPlan">Shubhora app plan</label>
          <select id="appPlan" name="appPlan" value={appPlan} onChange={(e) => setAppPlan(e.target.value)} className="input">
            <option value="1">Give Growth plan too</option>
            <option value="0">Partner ID only</option>
          </select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="kind">Red ID / Green ID</label>
          <select id="kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className="input">
            <option value="auto">Automatic (Red → activate, Green → renew)</option>
            <option value="activation">Activate only (Red IDs)</option>
            <option value="renewal">Renew only (Green IDs)</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="reference">Reference {paid ? "(required)" : "(optional)"}</label>
          <input id="reference" name="reference" className="input" placeholder={paid ? "UTR / receipt / cheque no." : "e.g. leader offer Sep 2026"} required={paid} />
        </div>
        <div>
          <label className="label" htmlFor="reason">Reason (saved in the record)</label>
          <input id="reason" name="reason" required minLength={4} className="input" placeholder="e.g. Founder leader — free entry" />
        </div>
      </div>

      <p className="rounded-lg bg-amber-soft px-3 py-2 text-xs text-ink">
        Summary: each ID turns <b>Green</b> for <b>{months} month{Number(months) > 1 ? "s" : ""}</b>, {paid ? <>₹{Number(amount).toLocaleString("en-IN")} received with a GST invoice</> : <>free (no invoice)</>},{" "}
        <b>{bvShown.toLocaleString("en-IN")} BV</b>{bvShown > 0 ? " — sponsor bonus and pairs are paid from it at tonight's closing" : " — no bonus or pairs from it"},{" "}
        {appPlan === "1" ? "with the Shubhora Growth plan in the app" : "partner ID only (no app plan)"}. It is recorded below and in the Activity log.
      </p>
    </ActionForm>
  );
}
