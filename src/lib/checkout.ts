import { getSession } from "./session";

type RazorpayResponse = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
type RazorpayCtor = new (opts: Record<string, unknown>) => { open(): void; on(ev: string, cb: (r: { error?: { description?: string } }) => void): void };

let script: Promise<void> | null = null;
function loadRazorpay() {
  script ??= new Promise((resolve, reject) => {
    if ((window as unknown as { Razorpay?: RazorpayCtor }).Razorpay) return resolve();
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      script = null;
      reject(new Error("Couldn't load the payment window. Check your connection and try again."));
    };
    document.head.appendChild(s);
  });
  return script;
}

export async function api<T>(path: string, body: unknown): Promise<T> {
  const s = await getSession();
  if (!s) throw new Error("Please sign in again.");
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.access_token}` },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j;
}

/** Opens Razorpay Checkout for a plan. Resolves when the payment is verified and the plan is active. */
export async function buyPlan(shopId: string, planCode: string, prefill: { name?: string; email?: string; contact?: string }) {
  const order = await api<{ order_id: string; key_id: string; amount: number; currency: string; description: string }>(
    "/api/pay/order",
    { shop_id: shopId, plan_code: planCode },
  );
  await loadRazorpay();
  const Razorpay = (window as unknown as { Razorpay: RazorpayCtor }).Razorpay;
  return new Promise<{ ends_at: string }>((resolve, reject) => {
    const rz = new Razorpay({
      key: order.key_id,
      order_id: order.order_id,
      amount: order.amount,
      currency: order.currency,
      name: "Sarees Hub",
      description: order.description,
      image: `${location.origin}/icons/icon-192.png`,
      prefill,
      notes: { shop_id: shopId, plan_code: planCode },
      theme: { color: "#2f4938" },
      retry: { enabled: true },
      handler: async (resp: RazorpayResponse) => {
        try {
          resolve(await api<{ ends_at: string }>("/api/pay/verify", resp));
        } catch (e) {
          reject(new Error(`${e instanceof Error ? e.message : "Verification failed"}. If money was deducted, your plan will activate automatically within a few minutes — or contact us with payment ID ${resp.razorpay_payment_id}.`));
        }
      },
      modal: { ondismiss: () => reject(new Error("Payment cancelled.")), confirm_close: true },
    });
    rz.on("payment.failed", (r) => {
      // Razorpay lets the buyer retry in the same window; we only log the reason here.
      console.warn("Payment failed:", r.error?.description);
    });
    rz.open();
  });
}
