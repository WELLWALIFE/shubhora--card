import { getMember } from "@/server/auth/session";
import { flags, planNow } from "@/server/queries";
import { bp } from "@/server/engine/matching";
import { createOrder, razorpayReady } from "@/server/razorpay";

export async function POST(req: Request) {
  const me = await getMember();
  if (!me) return Response.json({ error: "Please log in again." }, { status: 401 });
  if (me.actingAdmin) return Response.json({ error: "Admins cannot pay on a member's behalf here." }, { status: 403 });
  if (!razorpayReady() || !(await flags())["feature.online_payment"]) return Response.json({ error: "Online payment is not available right now." }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { kind?: string };
  const kind = body.kind === "renewal" ? "renewal" : "activation";
  if (kind === "activation" && me.status === "green") return Response.json({ error: "Your ID is already active." }, { status: 400 });
  if (kind === "renewal" && me.status !== "green") return Response.json({ error: "Activate your ID first." }, { status: 400 });
  const plan = await planNow();
  const amount = plan.subscriptionBasePaise + bp(plan.subscriptionBasePaise, plan.gstBp);
  const orderId = await createOrder(me.id, kind, amount);
  return Response.json({ orderId, amount, key: process.env.RAZORPAY_KEY_ID, name: me.name, code: me.code });
}
