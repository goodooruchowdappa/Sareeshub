import { useCallback, useEffect, useState } from "react";
import BuyerPlans from "./BuyerPlans";
import { rpc, supabase } from "../../lib/supabase";
import { loadMe, requireSession } from "../../lib/session";
import { flushNotifications } from "../../lib/checkout";
import { budgetLabel, dateIN, formatKm, mediaUrl, telLink, timeAgo, whatsappLink } from "../../lib/format";
import type { BuyerStatus, Me, RequestDetail, RequestSummary } from "../../lib/types";

const STATUS: Record<string, [string, string]> = {
  open: ["Open", "bg-leaf-50 text-leaf"],
  closed: ["Closed", "bg-sand text-muted"],
  expired: ["Expired", "bg-sand text-muted"],
  hidden: ["Removed", "bg-brand-50 text-brand-800"],
};

export default function MyRequests() {
  const [me, setMe] = useState<Me | null>(null);
  const [list, setList] = useState<RequestSummary[] | null>(null);
  const [status, setStatus] = useState<BuyerStatus | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showPlans, setShowPlans] = useState(false);
  const sent = typeof window !== "undefined" && new URLSearchParams(location.search).get("sent") === "1";

  const reload = useCallback(async () => {
    const [l, s] = await Promise.all([rpc<RequestSummary[]>(supabase(), "my_requests"), rpc<BuyerStatus>(supabase(), "my_buyer_status")]);
    setList(l);
    setStatus(s);
  }, []);

  useEffect(() => {
    requireSession().then(async (s) => {
      if (!s) return;
      setMe(await loadMe());
      setOpenId(new URLSearchParams(location.search).get("id"));
      reload();
    });
  }, [reload]);

  const open = (id: string | null) => {
    setOpenId(id);
    const u = new URL(location.href);
    if (id) u.searchParams.set("id", id);
    else u.searchParams.delete("id");
    u.searchParams.delete("sent");
    history.pushState(null, "", u);
    window.scrollTo({ top: 0 });
  };
  useEffect(() => {
    const pop = () => setOpenId(new URLSearchParams(location.search).get("id"));
    addEventListener("popstate", pop);
    return () => removeEventListener("popstate", pop);
  }, []);

  if (!me || !list || !status) return <div className="h-48 animate-pulse rounded-2xl bg-sand" />;
  if (openId) return <Detail id={openId} sent={sent} back={() => { open(null); reload(); }} />;

  return (
    <div className="space-y-6">
      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <p className="text-sm text-muted">Your plan</p>
          <p className="font-display text-xl">{status.plan_name}</p>
          <p className="text-sm" data-testid="quota">
            {status.quota == null ? "Unlimited requests" : `${status.remaining} of ${status.quota} request${status.quota === 1 ? "" : "s"} left`}
            {status.ends_at && ` · until ${dateIN(status.ends_at)}`}
          </p>
          <p className="mt-1 text-xs text-muted">A request that gets no replies doesn't use up your allowance.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-outline" onClick={() => setShowPlans((v) => !v)}>{showPlans ? "Hide plans" : "Plans"}</button>
          <a className="btn-primary" href="/requests/new">+ New request</a>
        </div>
      </div>
      {showPlans && <BuyerPlans me={me} status={status} onPaid={setStatus} />}

      {list.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-display text-2xl">No requests yet</p>
          <p className="mt-2 text-sm text-muted">Upload a photo of the saree you have in mind and nearby shops and weavers will reply with what they have.</p>
          <a className="btn-primary mt-5" href="/requests/new">Request a custom saree</a>
        </div>
      ) : (
        <ul className="space-y-3">
          {list.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => open(r.id)} className="card flex w-full min-w-0 gap-3 p-3 text-left hover:border-brand-200 sm:p-4">
                <div className="h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-sand sm:h-24 sm:w-20">
                  {r.image && <img src={mediaUrl(r.image, "thumb")!} alt="" className="h-full w-full object-cover" loading="lazy" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`badge ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span>
                    <span className="text-xs text-muted">{timeAgo(r.created_at)} · {r.city}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 font-semibold">{r.title}</p>
                  <p className="text-sm text-muted">{budgetLabel(r.min_price, r.max_price)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-display text-2xl text-brand-800">{r.responses}</p>
                  <p className="text-xs text-muted">{r.responses === 1 ? "reply" : "replies"}</p>
                  {r.unseen > 0 && <span className="badge mt-1 bg-zari-500 text-white">{r.unseen} new</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Detail({ id, sent, back }: { id: string; sent: boolean; back: () => void }) {
  const [d, setD] = useState<RequestDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const load = useCallback(() => rpc<RequestDetail>(supabase(), "get_request", { p_id: id }).then(setD).catch((e) => setErr(e.message)), [id]);
  useEffect(() => {
    load();
  }, [load]);

  if (err) return <div className="space-y-3"><button className="btn-ghost" onClick={back}>← My requests</button><p className="rounded-xl bg-brand-50 p-4 text-brand-800">{err}</p></div>;
  if (!d) return <div className="h-48 animate-pulse rounded-2xl bg-sand" />;
  const r = d.request;

  async function setReply(rid: string, s: string) {
    await rpc(supabase(), "set_response_status", { p_response: rid, p_status: s });
    if (s === "shortlisted") flushNotifications();
    load();
  }
  async function close() {
    const reason = prompt("Close this request? Sellers will stop replying.\nOptional: tell us why (e.g. found my saree).", "");
    if (reason === null) return;
    await rpc(supabase(), "close_request", { p_id: id, p_reason: reason });
    load();
  }

  return (
    <div className="space-y-6">
      <button className="btn-ghost -ml-2" onClick={back}>← My requests</button>
      {sent && (
        <div className="rounded-2xl border border-brand-200 bg-brand-50 p-4 text-sm" role="status">
          <p className="font-semibold text-brand-800">Request sent ✓</p>
          <p className="mt-1">We've notified verified sellers near {r.city}. Replies usually arrive within a day — we'll show them here and in your notifications.</p>
        </div>
      )}
      <div className="card grid gap-4 p-4 sm:p-5 md:grid-cols-[1fr_240px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`badge ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span>
            <span className="text-xs text-muted">Sent {dateIN(r.created_at)} · {r.status === "open" ? `open until ${dateIN(r.expires_at)}` : r.closed_reason ?? ""}</span>
          </div>
          <h2 className="mt-2 text-2xl">{r.title}</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-muted">Budget</dt><dd className="font-semibold">{budgetLabel(r.min_price, r.max_price)}</dd></div>
            <div><dt className="text-xs text-muted">Needed by</dt><dd className="font-semibold">{r.needed_by ? dateIN(r.needed_by) : "Flexible"}</dd></div>
            <div><dt className="text-xs text-muted">Sellers</dt><dd className="font-semibold">{r.radius_km ? `Within ${r.radius_km} km of ${r.city}` : "Anywhere"}</dd></div>
            {r.quantity > 1 && <div><dt className="text-xs text-muted">Quantity</dt><dd className="font-semibold">{r.quantity}</dd></div>}
            {r.colors.length > 0 && <div><dt className="text-xs text-muted">Colours</dt><dd className="font-semibold">{r.colors.join(", ")}</dd></div>}
          </dl>
          {r.tags.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{r.tags.map((t) => <span key={t.id} className="chip">{t.name}</span>)}</div>}
          {r.description && <p className="mt-3 whitespace-pre-line text-sm">{r.description}</p>}
          {r.status === "open" && <button className="btn-ghost mt-3 -ml-2 text-sm" onClick={close}>Close request</button>}
        </div>
        {r.images.length > 0 && (
          <div className="grid grid-cols-4 gap-2 md:grid-cols-2">
            {r.images.map((p) => (
              <button type="button" key={p} onClick={() => setZoom(p)} className="aspect-[3/4] overflow-hidden rounded-lg bg-sand">
                <img src={mediaUrl(p, "thumb")!} alt="Your reference" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      <section>
        <h3 className="text-2xl">Replies from sellers <span className="text-muted">({d.responses.length})</span></h3>
        {d.responses.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{r.status === "open" ? "No replies yet. Sellers usually reply within a day — check back soon." : "No replies."}</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {d.responses.map((x) => {
              const msg = `Hi ${x.shop.name}, I saw your reply on Sarees Hub to my request "${r.title}".`;
              return (
                <li key={x.id} className={`card p-4 sm:p-5 ${x.status === "shortlisted" ? "ring-2 ring-zari-500" : ""} ${x.status === "declined" ? "opacity-60" : ""}`} data-testid="reply">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <a href={`/shops/${x.shop.slug}`} target="_blank" className="font-semibold hover:text-brand-700">{x.shop.name} ↗</a>
                      <p className="text-xs text-muted">
                        {x.shop.city}{x.shop.distance_km != null && ` · ${formatKm(x.shop.distance_km)}`}
                        {x.shop.rating_count > 0 && ` · ★ ${Number(x.shop.rating_avg).toFixed(1)} (${x.shop.rating_count})`} · {timeAgo(x.created_at)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-display text-2xl text-brand-800">{x.price_inr ? `₹${x.price_inr.toLocaleString("en-IN")}` : "Price on call"}</p>
                      {x.ready_in_days != null && <p className="text-xs text-muted">{x.ready_in_days === 0 ? "Ready now" : `Ready in ${x.ready_in_days} days`}</p>}
                    </div>
                  </div>
                  <p className="mt-3 whitespace-pre-line text-sm">{x.message}</p>
                  {x.images.length > 0 && (
                    <div className="mt-3 flex gap-2 overflow-x-auto">
                      {x.images.map((p) => (
                        <button type="button" key={p} onClick={() => setZoom(p)} className="h-28 w-24 shrink-0 overflow-hidden rounded-lg bg-sand">
                          <img src={mediaUrl(p, "thumb")!} alt={`Saree from ${x.shop.name}`} className="h-full w-full object-cover" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {x.shop.whatsapp && <a className="btn-whatsapp" href={whatsappLink(x.shop.whatsapp, msg, x.shop.country_code)} target="_blank" rel="noopener">WhatsApp</a>}
                    <a className="btn-outline" href={telLink(x.shop.phone)}>Call</a>
                    {x.status !== "shortlisted" ? (
                      <button className="btn-ghost" onClick={() => setReply(x.id, "shortlisted")}>☆ Shortlist</button>
                    ) : (
                      <button className="btn-ghost text-zari-700" onClick={() => setReply(x.id, "sent")}>★ Shortlisted</button>
                    )}
                    {x.status !== "declined" ? (
                      <button className="btn-ghost text-muted" onClick={() => setReply(x.id, "declined")}>Not for me</button>
                    ) : (
                      <button className="btn-ghost text-muted" onClick={() => setReply(x.id, "sent")}>Undo</button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-4 text-xs text-muted">Tip: confirm the final price, delivery and returns with the seller before paying. Sarees Hub doesn't take payment for sarees.</p>
      </section>

      {zoom && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/80 p-4" onClick={() => setZoom(null)} role="dialog" aria-label="Photo">
          <img src={mediaUrl(zoom)!} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}
    </div>
  );
}
