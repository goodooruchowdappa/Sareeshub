import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from "astro:env/client";
import { getSecret, RAZORPAY_API_BASE } from "astro:env/server";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const verifyCheckoutSignature = async (orderId: string, paymentId: string, signature: string, secret: string) =>
  safeEqual(await hmacHex(secret, `${orderId}|${paymentId}`), signature);

export const verifyWebhookSignature = async (rawBody: string, signature: string, secret: string) =>
  safeEqual(await hmacHex(secret, rawBody), signature);

export function razorpayKeys() {
  const keyId = getSecret("RAZORPAY_KEY_ID");
  const keySecret = getSecret("RAZORPAY_KEY_SECRET");
  return keyId && keySecret ? { keyId, keySecret } : null;
}

export async function razorpay<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const keys = razorpayKeys();
  if (!keys) throw new Error("Razorpay is not configured");
  const r = await fetch(`${RAZORPAY_API_BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Basic ${btoa(`${keys.keyId}:${keys.keySecret}`)}`,
      "Content-Type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: { description?: string } };
  if (!r.ok) throw new Error(j.error?.description ?? `Razorpay error ${r.status}`);
  return j;
}

/** Service-role client: bypasses RLS. Only used inside these API routes. */
export function serviceClient(): SupabaseClient {
  const key = getSecret("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(PUBLIC_SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Returns the signed-in user's id from the Bearer token, verified with Supabase Auth. */
export async function userFromRequest(request: Request): Promise<{ id: string; email?: string } | null> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || token.split(".").length !== 3) return null;
  const sb = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email };
}

export type RzPayment = { id: string; order_id: string; amount: number; currency: string; status: string; method: string; error_description?: string };

/** Marks the order paid (idempotent) after re-checking the payment with Razorpay. */
export async function settlePayment(orderId: string, paymentId: string) {
  let pay = await razorpay<RzPayment>(`/v1/payments/${encodeURIComponent(paymentId)}`);
  if (pay.order_id !== orderId) throw new Error("Payment does not belong to this order");
  if (pay.status === "authorized") {
    // Accounts without auto-capture: capture now so the money settles.
    pay = await razorpay<RzPayment>(`/v1/payments/${encodeURIComponent(paymentId)}/capture`, {
      method: "POST",
      body: { amount: pay.amount, currency: pay.currency },
    });
  }
  if (pay.status !== "captured") throw new Error(`Payment is ${pay.status}`);
  const { data, error } = await serviceClient().rpc("payment_mark_paid", {
    p_order_id: orderId,
    p_payment_id: paymentId,
    p_amount_paise: pay.amount,
    p_method: pay.method,
  });
  if (error) throw new Error(error.message);
  return data as { status: string; already: boolean; ends_at: string };
}
