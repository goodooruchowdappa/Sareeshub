import type { APIRoute } from "astro";
import { json, razorpayKeys, settlePayment, userFromRequest, verifyCheckoutSignature } from "../../../lib/razorpay.server";

export const POST: APIRoute = async ({ request }) => {
  const user = await userFromRequest(request);
  if (!user) return json({ error: "Please sign in again." }, 401);
  const keys = razorpayKeys();
  if (!keys) return json({ error: "Payments are not configured." }, 503);
  const b = (await request.json().catch(() => ({}))) as {
    razorpay_order_id?: string;
    razorpay_payment_id?: string;
    razorpay_signature?: string;
  };
  if (!b.razorpay_order_id || !b.razorpay_payment_id || !b.razorpay_signature) return json({ error: "Invalid request." }, 400);
  if (!(await verifyCheckoutSignature(b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature, keys.keySecret)))
    return json({ error: "Payment verification failed." }, 400);
  try {
    const r = await settlePayment(b.razorpay_order_id, b.razorpay_payment_id);
    return json({ ok: true, ends_at: r.ends_at });
  } catch (e) {
    console.error("[pay/verify]", e);
    return json({ error: e instanceof Error ? e.message : "Could not confirm payment" }, 502);
  }
};
