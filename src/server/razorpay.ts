import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./index";
import { maybeOne, n } from "./db";
import { istDate } from "./engine/dates";
import { RuleError } from "./engine/members";
import { recordPayment } from "./engine/payments";
import { audit } from "./queries";

// Razorpay Orders for activation and renewal. Three entry points apply a payment, all idempotent:
// the browser's verify call (instant), the webhook (server-to-server safety net) and an admin re-check.

export const razorpayReady = () => !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

const auth = () => "Basic " + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");

export async function createOrder(memberId: number, kind: "activation" | "renewal", amountPaise: number) {
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { authorization: auth(), "content-type": "application/json" },
    body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt: `m${memberId}-${Date.now()}`, notes: { member_id: String(memberId), kind, app: "partner" } }),
  });
  if (!res.ok) throw new Error(`Razorpay order failed: ${res.status}`);
  const o = (await res.json()) as { id: string };
  await (await db()).query("insert into pay_orders (order_id, member_id, kind, amount_paise) values ($1, $2, $3, $4)", [o.id, memberId, kind, amountPaise]);
  return o.id;
}

function safeEqualHex(a: string, b: string) {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkoutSignatureOk(orderId: string, paymentId: string, signature: string) {
  const want = createHmac("sha256", process.env.RAZORPAY_KEY_SECRET ?? "").update(`${orderId}|${paymentId}`).digest("hex");
  return safeEqualHex(want, signature);
}

export function webhookSignatureOk(raw: string, signature: string) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  return safeEqualHex(createHmac("sha256", secret).update(raw).digest("hex"), signature);
}

/** Apply a captured payment to its order. Safe to call any number of times. */
export async function applyOrderPayment(orderId: string, paymentId: string, amountPaise: number | null, source: string) {
  const d = await db();
  const o = await maybeOne<{ member_id: unknown; kind: "activation" | "renewal"; amount_paise: unknown; status: string }>(d,
    "select member_id, kind, amount_paise, status from pay_orders where order_id = $1", [orderId]);
  if (!o) throw new RuleError("Unknown order.");
  if (amountPaise !== null && amountPaise !== n(o.amount_paise)) throw new RuleError("Paid amount does not match the order.");
  if (o.status === "paid") return { already: true };
  try {
    const r = await recordPayment(d, { memberId: n(o.member_id), kind: o.kind, method: "online", date: istDate(), reference: paymentId });
    await d.query("update pay_orders set status = 'paid', payment_id = $2, paid_at = now() where order_id = $1", [orderId, paymentId]);
    const { processSuiteSync } = await import("./suite");
    await processSuiteSync(d, 10).catch(() => undefined);
    return { already: r.duplicate, invoiceNo: r.invoiceNo };
  } catch (e) {
    if (e instanceof RuleError) {
      // Money was taken but the rules refused it (for example the ID was already activated by an admin).
      await d.query("update pay_orders set status = 'failed', payment_id = $2 where order_id = $1", [orderId, paymentId]);
      await audit(null, n(o.member_id), "payment.unapplied", e.message, { orderId, paymentId, source });
    }
    throw e;
  }
}
