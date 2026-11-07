import { useEffect, useState } from "react";
import { rpc, supabase } from "../../lib/supabase";
import { buyPlan } from "../../lib/checkout";
import { dateIN } from "../../lib/format";
import type { BuyerStatus, Me, Plan } from "../../lib/types";

/** Buyer request plans with Razorpay checkout. Calls onPaid with the new allowance. */
export default function BuyerPlans({ me, status, onPaid, compact = false }: { me: Me; status: BuyerStatus; onPaid: (s: BuyerStatus, message: string) => void; compact?: boolean }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    rpc<Plan[]>(supabase(), "list_plans", { p_audience: "buyer" }).then(setPlans).catch(() => setErr("Couldn't load plans."));
  }, []);

  async function buy(code: string) {
    setErr(null);
    setBusy(code);
    try {
      const r = await buyPlan(null, code, { name: me.full_name ?? undefined, email: me.email, contact: me.phone ?? undefined });
      const s = await rpc<BuyerStatus>(supabase(), "my_buyer_status");
      const msg = `Payment successful — ${s.plan_name} active until ${dateIN(r.ends_at)}.`;
      setOk(msg);
      onPaid(s, msg);
    } catch (e) {
      const m = e instanceof Error ? e.message : "Payment failed.";
      if (m !== "Payment cancelled.") setErr(m);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {err && <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800" role="alert">{err}</p>}
      {ok && <p className="rounded-xl bg-leaf-50 p-3 text-sm font-semibold text-leaf" role="status">{ok}</p>}
      <div className={`grid gap-3 ${compact ? "sm:grid-cols-3" : "md:grid-cols-3"}`}>
        {plans.map((p) => {
          const current = p.code === status.plan_code;
          return (
            <div key={p.code} className={`card flex min-w-0 flex-col p-4 ${current ? "ring-2 ring-brand-700" : ""}`} data-plan={p.code}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-display text-lg">{p.name}</p>
                {current && <span className="badge bg-brand-50 text-brand-800">Current</span>}
              </div>
              <p className="mt-1">
                <span className="font-display text-2xl text-brand-800">₹{p.price_inr.toLocaleString("en-IN")}</span>
                <span className="text-xs text-muted"> / {p.duration_days} days</span>
              </p>
              <p className="mt-1 text-sm font-semibold">
                {p.request_quota == null ? "Unlimited requests" : `${p.request_quota} request${p.request_quota === 1 ? "" : "s"}`}
              </p>
              {!compact && <ul className="mt-2 flex-1 space-y-1 text-sm text-muted">{p.features.map((f) => <li key={f}>✓ {f}</li>)}</ul>}
              {p.price_inr > 0 ? (
                <button type="button" className="btn-primary mt-3" disabled={!!busy} onClick={() => buy(p.code)}>
                  {busy === p.code ? "Opening payment…" : current ? "Extend" : `Get ${p.name}`}
                </button>
              ) : (
                <p className="mt-3 text-center text-xs text-muted">Free for everyone</p>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted">
        Secure payments by Razorpay — UPI, cards, netbanking, wallets. One-time payment, no auto-renewal.{" "}
        <a className="underline" href="/refund-policy">Refund policy</a>.
      </p>
    </div>
  );
}
