import { useCallback, useEffect, useState } from "react";
import ImageUploader from "./ImageUploader";
import { rpc, supabase } from "../../lib/supabase";
import { flushNotifications } from "../../lib/checkout";
import { budgetLabel, dateIN, formatKm, mediaUrl, timeAgo } from "../../lib/format";
import type { TagRef } from "../../lib/types";

type Item = {
  id: string; title: string; min_price: number | null; max_price: number | null; city: string; state: string | null;
  needed_by: string | null; quantity: number; created_at: string; expires_at: string; image: string | null; image_count: number;
  distance_km: number; responses: number; full: boolean; tags: TagRef[]; unlocked: boolean;
  my_response: { id: string; message: string; price_inr: number | null; ready_in_days: number | null; images: string[]; status: string; hidden: boolean } | null;
  description?: string | null; images?: string[]; colors?: string[]; radius_km?: number | null; buyer?: string;
};
type Data = {
  status: { quota: number | null; used: number; plan_name: string; head_start_hours: number; shop_approved: boolean; max_responses: number };
  items: Item[];
};

export default function SellerRequests({ shopId, goPlan, flash }: { shopId: string; goPlan: () => void; flash: (m: string) => void }) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [replying, setReplying] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const load = useCallback(
    () => rpc<Data>(supabase(), "seller_requests", { p_shop: shopId }).then((x) => { setD(x); setErr(null); }).catch((e) => setErr(e.message)),
    [shopId],
  );
  useEffect(() => {
    load();
  }, [load]);

  async function unlock(id: string) {
    setErr(null);
    try {
      await rpc(supabase(), "unlock_request", { p_shop: shopId, p_request: id });
      await load();
      setReplying(id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't open this request.");
    }
  }

  if (!d) return err ? <p className="rounded-xl bg-brand-50 p-4 text-brand-800">{err}</p> : <div className="h-40 animate-pulse rounded-2xl bg-sand" />;
  const st = d.status;
  const left = st.quota == null ? null : Math.max(st.quota - st.used, 0);

  if (!st.shop_approved)
    return <p className="rounded-xl bg-zari-100 p-4 text-sm text-zari-700">Custom requests from buyers appear here once your shop is approved.</p>;

  return (
    <div className="space-y-5">
      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="min-w-0">
          <p className="font-semibold">Custom saree requests near you</p>
          {st.quota == null ? (
            <p className="text-sm text-muted">{st.plan_name} plan: unlimited requests, and you see new ones {st.head_start_hours} hours before Free sellers.</p>
          ) : st.quota === 0 ? (
            <p className="text-sm text-muted">Your plan doesn't include custom requests.</p>
          ) : (
            <>
              <p className="text-sm text-muted" data-testid="lead-quota">
                {st.plan_name} plan: <strong className="text-ink">{left} of {st.quota}</strong> requests left this month · new requests reach you after {st.head_start_hours} hours
              </p>
              <div className="mt-2 h-2 w-full max-w-xs overflow-hidden rounded-full bg-sand">
                <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min(100, (st.used / Math.max(st.quota, 1)) * 100)}%` }} />
              </div>
            </>
          )}
        </div>
        {st.quota != null && <button className="btn-gold shrink-0" onClick={goPlan}>Get unlimited requests</button>}
      </div>
      {err && <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800" role="alert">{err} {/Upgrade/.test(err) && <button className="underline" onClick={goPlan}>See plans</button>}</p>}

      {d.items.length === 0 ? (
        <div className="card p-8 text-center text-sm text-muted">
          <p className="font-display text-xl text-ink">No requests right now</p>
          <p className="mt-1">When a buyer near you asks for a saree, it shows up here and in your notifications.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {d.items.map((r) => (
            <li key={r.id} className="card p-4 sm:p-5" data-testid="seller-request">
              <div className="flex min-w-0 gap-3">
                <div className="relative h-24 w-20 shrink-0 overflow-hidden rounded-lg bg-sand">
                  {r.image && (
                    <img src={mediaUrl(r.image, "thumb")!} alt="" className={`h-full w-full object-cover ${r.unlocked ? "" : "scale-110 blur-sm"}`} loading="lazy" />
                  )}
                  {r.image_count > 1 && <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] text-white">+{r.image_count - 1}</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted">{timeAgo(r.created_at)} · {r.city} · {formatKm(r.distance_km)}</p>
                  <p className="mt-0.5 font-semibold">{r.title}</p>
                  <p className="text-sm"><strong>{budgetLabel(r.min_price, r.max_price)}</strong>{r.needed_by && ` · by ${dateIN(r.needed_by)}`}{r.quantity > 1 && ` · ${r.quantity} pcs`}</p>
                  {r.tags.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{r.tags.map((t) => <span key={t.id} className="chip !py-0.5 !text-xs">{t.name}</span>)}</div>}
                  <p className="mt-1 text-xs text-muted">{r.responses} {r.responses === 1 ? "seller has" : "sellers have"} replied{r.full && " · full"}</p>
                </div>
              </div>

              {r.unlocked && (
                <div className="mt-3 space-y-2 rounded-xl bg-sand/60 p-3 text-sm">
                  {r.buyer && <p className="text-xs text-muted">Buyer: {r.buyer}</p>}
                  {r.description && <p className="whitespace-pre-line">{r.description}</p>}
                  {!!r.colors?.length && <p><span className="text-muted">Colours:</span> {r.colors.join(", ")}</p>}
                  {!!r.images?.length && (
                    <div className="flex gap-2 overflow-x-auto">
                      {r.images.map((p) => (
                        <button type="button" key={p} onClick={() => setZoom(p)} className="h-28 w-24 shrink-0 overflow-hidden rounded-lg bg-white">
                          <img src={mediaUrl(p, "thumb")!} alt="Buyer's reference" className="h-full w-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {r.my_response && replying !== r.id && (
                <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm">
                  <p className="font-semibold text-brand-800">
                    Your reply {r.my_response.status === "shortlisted" ? "· ★ Shortlisted by the buyer" : r.my_response.status === "declined" ? "· Not chosen" : "· Sent"}
                    {r.my_response.hidden && " · hidden by moderators"}
                  </p>
                  <p className="mt-1">{r.my_response.message}</p>
                  {r.my_response.price_inr && <p className="mt-1 font-semibold">₹{r.my_response.price_inr.toLocaleString("en-IN")}</p>}
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {!r.unlocked ? (
                  <button className="btn-primary" onClick={() => unlock(r.id)} disabled={r.full || (left !== null && left <= 0)}>
                    {r.full ? "Enough replies already" : left === null ? "Open & reply" : `Open & reply (uses 1 of ${left})`}
                  </button>
                ) : replying !== r.id && (r.my_response || !r.full) ? (
                  <button className="btn-primary" onClick={() => setReplying(r.id)}>{r.my_response ? "Edit reply" : "Reply with photos & price"}</button>
                ) : null}
              </div>

              {replying === r.id && (
                <ReplyForm
                  shopId={shopId}
                  requestId={r.id}
                  initial={r.my_response}
                  onCancel={() => setReplying(null)}
                  onSent={async () => {
                    setReplying(null);
                    await load();
                    flash("Reply sent — the buyer has been notified.");
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">Buyers' phone numbers are private. If they like your reply, they'll call or WhatsApp you. Each request accepts up to {st.max_responses} replies.</p>
      {zoom && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/80 p-4" onClick={() => setZoom(null)} role="dialog" aria-label="Photo">
          <img src={mediaUrl(zoom)!} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}
    </div>
  );
}

function ReplyForm({ shopId, requestId, initial, onCancel, onSent }: {
  shopId: string; requestId: string; initial: Item["my_response"]; onCancel: () => void; onSent: () => void;
}) {
  const [images, setImages] = useState<string[]>(initial?.images ?? []);
  const [message, setMessage] = useState(initial?.message ?? "");
  const [price, setPrice] = useState(initial?.price_inr ? String(initial.price_inr) : "");
  const [days, setDays] = useState(initial?.ready_in_days != null ? String(initial.ready_in_days) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await rpc(supabase(), "respond_request", { p_shop: shopId, p_request: requestId, p: { message, price_inr: price, ready_in_days: days, images } });
      flushNotifications();
      onSent();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't send.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={send} className="mt-3 space-y-3 border-t border-line pt-3">
      <ImageUploader value={images} onChange={setImages} max={4} folder="replies" label="Photos of your saree" hint="Real photos of sarees you have or can make." />
      <div>
        <label className="label" htmlFor={`msg-${requestId}`}>Message to the buyer *</label>
        <textarea id={`msg-${requestId}`} className="input min-h-24" required maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)}
                  placeholder="e.g. We have this in pure Kanchi silk, 2 colour options. Blouse included. Can courier anywhere in India." />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor={`price-${requestId}`}>Your price (₹)</label>
          <input id={`price-${requestId}`} className="input" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} />
        </div>
        <div>
          <label className="label" htmlFor={`days-${requestId}`}>Ready in (days)</label>
          <input id={`days-${requestId}`} className="input" inputMode="numeric" placeholder="0 = in stock" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} />
        </div>
      </div>
      {err && <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800" role="alert">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={busy}>{busy ? "Sending…" : initial ? "Update reply" : "Send reply"}</button>
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
