import { getMember } from "@/server/auth/session";
import { db } from "@/server";
import { maybeOne, n } from "@/server/db";
import { RuleError } from "@/server/engine/members";
import { applyOrderPayment, checkoutSignatureOk } from "@/server/razorpay";

export async function POST(req: Request) {
  const me = await getMember();
  if (!me) return Response.json({ error: "Please log in again." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { razorpay_order_id?: string; razorpay_payment_id?: string; razorpay_signature?: string };
  if (!b.razorpay_order_id || !b.razorpay_payment_id || !b.razorpay_signature) return Response.json({ error: "Payment details missing." }, { status: 400 });
  if (!checkoutSignatureOk(b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature))
    return Response.json({ error: "Payment could not be verified." }, { status: 400 });
  const o = await maybeOne<{ member_id: unknown }>(await db(), "select member_id from pay_orders where order_id = $1", [b.razorpay_order_id]);
  if (!o || n(o.member_id) !== me.id) return Response.json({ error: "This payment is not for your ID." }, { status: 403 });
  try {
    const r = await applyOrderPayment(b.razorpay_order_id, b.razorpay_payment_id, null, "checkout");
    return Response.json({ ok: true, invoiceNo: r.invoiceNo ?? null });
  } catch (e) {
    if (e instanceof RuleError) return Response.json({ error: `Payment received but not applied: ${e.message} Support will sort this out.` }, { status: 409 });
    throw e;
  }
}
