import type { APIRoute } from "astro";
import { getSecret } from "astro:env/server";
import { json, serviceClient, settlePayment, verifyWebhookSignature } from "../../../lib/razorpay.server";

// Razorpay → Settings → Webhooks: URL https://<your-domain>/api/pay/webhook,
// events payment.captured, payment.failed, order.paid, and the same secret as RAZORPAY_WEBHOOK_SECRET.
export const POST: APIRoute = async ({ request }) => {
  const secret = getSecret("RAZORPAY_WEBHOOK_SECRET");
  if (!secret) return json({ error: "webhook not configured" }, 503);
  const raw = await request.text();
  const sig = request.headers.get("x-razorpay-signature") ?? "";
  if (!(await verifyWebhookSignature(raw, sig, secret))) return json({ error: "bad signature" }, 401);

  type Entity = { id: string; order_id: string; error_description?: string };
  const evt = JSON.parse(raw) as { event: string; payload: { payment?: { entity: Entity } } };
  const pay = evt.payload.payment?.entity;
  if (!pay?.order_id) return json({ ok: true, ignored: evt.event });

  try {
    if (evt.event === "payment.captured" || evt.event === "order.paid") {
      await settlePayment(pay.order_id, pay.id);
    } else if (evt.event === "payment.failed") {
      await serviceClient().rpc("payment_mark_failed", {
        p_order_id: pay.order_id,
        p_payment_id: pay.id,
        p_reason: pay.error_description ?? "failed",
      });
    }
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Orders not created by this site (e.g. payment links) are acknowledged so Razorpay stops retrying.
    if (/Unknown order/.test(msg)) return json({ ok: true, ignored: "unknown order" });
    console.error("[pay/webhook]", evt.event, msg);
    return json({ error: "processing failed" }, 500); // Razorpay retries later
  }
};
