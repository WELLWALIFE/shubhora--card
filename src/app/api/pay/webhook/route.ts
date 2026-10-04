import { RuleError } from "@/server/engine/members";
import { applyOrderPayment, webhookSignatureOk } from "@/server/razorpay";

// Razorpay → server. Configure in the Razorpay dashboard with event payment.captured and the
// secret stored as RAZORPAY_WEBHOOK_SECRET. Read the raw body first: the signature is over the exact bytes.

export async function POST(req: Request) {
  const raw = await req.text();
  if (!webhookSignatureOk(raw, req.headers.get("x-razorpay-signature") ?? "")) return new Response("bad signature", { status: 400 });
  const evt = JSON.parse(raw) as { event?: string; payload?: { payment?: { entity?: { id: string; order_id: string; amount: number; notes?: { app?: string } } } } };
  const p = evt.payload?.payment?.entity;
  if (evt.event !== "payment.captured" || !p?.order_id || p.notes?.app !== "partner") return Response.json({ ok: true, ignored: true });
  try {
    await applyOrderPayment(p.order_id, p.id, p.amount, "webhook");
  } catch (e) {
    if (!(e instanceof RuleError)) throw e;
    // Recorded in the audit log; answering 200 stops Razorpay from retrying a payment that needs a human.
  }
  return Response.json({ ok: true });
}
