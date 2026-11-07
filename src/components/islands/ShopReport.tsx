import { useState } from "react";
import { rpc, supabase } from "../../lib/supabase";
import { getSession, signInWithGoogle } from "../../lib/session";
import { flushNotifications } from "../../lib/checkout";

const REASONS: [string, string][] = [
  ["closed", "Shop has closed / moved"],
  ["wrong_phone", "Phone or WhatsApp not working"],
  ["wrong_location", "Map pin is in the wrong place"],
  ["prices", "Prices or sarees are not as shown"],
  ["behaviour", "Bad experience with the seller"],
  ["fake", "Fake or fraud listing"],
  ["other", "Something else"],
];

/** "Report a problem" and "Own this shop? Claim it" — both go to the admin queue. */
export default function ShopReport({ shopId, shopName, unclaimed }: { shopId: string; shopName: string; unclaimed: boolean }) {
  const [mode, setMode] = useState<null | "report" | "claim">(null);
  const [reason, setReason] = useState("closed");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function open(m: "report" | "claim") {
    if (!(await getSession())) return signInWithGoogle();
    setErr(null);
    setDone(null);
    setMode(m);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await rpc(supabase(), "report_shop", { p_shop: shopId, p_reason: mode === "claim" ? "claim" : reason, p_details: details });
      flushNotifications();
      setDone(mode === "claim"
        ? "Thanks! Our team will call the shop's number to confirm you're the owner, then hand it over to this Google account."
        : "Thanks for telling us. Our team will check this listing.");
      setMode(null);
      setDetails("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't send.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-xs">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <button type="button" className="underline" onClick={() => open("report")}>Report a problem</button>
        <button type="button" className="font-semibold text-brand-700 underline" onClick={() => open("claim")}>
          {unclaimed ? "Own this shop? Claim it — free" : "Is this your shop?"}
        </button>
      </div>
      {done && <p className="mt-2 rounded-lg bg-leaf-50 p-2 text-leaf" role="status">{done}</p>}
      {mode && (
        <form onSubmit={send} className="card mt-2 space-y-2 p-3 text-sm" aria-label={mode === "claim" ? "Claim this shop" : "Report a problem"}>
          {mode === "report" ? (
            <div>
              <label className="label" htmlFor="rp-reason">What's wrong with {shopName}?</label>
              <select id="rp-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
                {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          ) : (
            <p>Tell us your name and role. We'll call <strong>the shop's listed number</strong> to verify before handing it over.</p>
          )}
          <textarea className="input min-h-20" maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} aria-label="Details"
                    placeholder={mode === "claim" ? "e.g. I'm Ravi, the owner. My number is the one on this page." : "Details help us fix it faster (optional)"} />
          {err && <p className="text-brand-800" role="alert">{err}</p>}
          <div className="flex gap-2">
            <button className="btn-primary !py-1.5" disabled={busy}>{busy ? "Sending…" : "Send"}</button>
            <button type="button" className="btn-ghost !py-1.5" onClick={() => setMode(null)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
