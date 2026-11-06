import type { APIRoute } from "astro";
import { json, razorpay, razorpayKeys, serviceClient, userFromRequest } from "../../../lib/razorpay.server";

export const POST: APIRoute = async ({ request }) => {
  const user = await userFromRequest(request);
  if (!user) return json({ error: "Please sign in again." }, 401);
  const body = (await request.json().catch(() => ({}))) as { shop_id?: string; plan_code?: string };
  if (!/^[0-9a-f-]{36}$/.test(body.shop_id ?? "") || !/^[a-z0-9_]{2,30}$/.test(body.plan_code ?? ""))
    return json({ error: "Invalid request." }, 400);
  const keys = razorpayKeys();
  if (!keys) return json({ error: "Online payments aren't switched on yet. Please contact us and we'll activate your plan." }, 503);

  const sb = serviceClient();
  const prep = await sb.rpc("payment_prepare", { p_user: user.id, p_shop: body.shop_id, p_plan: body.plan_code });
  if (prep.error) return json({ error: prep.error.message }, 400);
  const p = prep.data as { amount_paise: number; plan_name: string; shop_name: string; duration_days: number };

  try {
    const order = await razorpay<{ id: string; amount: number; currency: string }>("/v1/orders", {
      method: "POST",
      body: {
        amount: p.amount_paise,
        currency: "INR",
        receipt: `sh_${Date.now().toString(36)}`,
        notes: { shop_id: body.shop_id, plan_code: body.plan_code, user_id: user.id },
      },
    });
    const rec = await sb.rpc("payment_record_order", {
      p_user: user.id,
      p_shop: body.shop_id,
      p_plan: body.plan_code,
      p_amount_paise: order.amount,
      p_order_id: order.id,
    });
    if (rec.error) throw new Error(rec.error.message);
    return json({
      order_id: order.id,
      key_id: keys.keyId,
      amount: order.amount,
      currency: order.currency,
      description: `${p.plan_name} plan · ${p.shop_name} · ${p.duration_days} days`,
    });
  } catch (e) {
    console.error("[pay/order]", e);
    return json({ error: "Couldn't start the payment. Please try again in a minute." }, 502);
  }
};
