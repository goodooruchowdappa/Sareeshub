import { useCallback, useEffect, useState } from "react";
import MiniMap from "./MiniMap";
import ShopForm, { shopToValues, valuesToPayload } from "./ShopForm";
import { rpc, supabase } from "../../lib/supabase";
import { loadMe, requireSession } from "../../lib/session";
import { TAG_CATEGORIES, categoryLabel, kindLabel } from "../../lib/config";
import { dateIN, mediaUrl, paise, telLink } from "../../lib/format";
import type { Me, Plan, TagRef } from "../../lib/types";

type Tab = "overview" | "pending" | "changes" | "shops" | "reviews" | "tags" | "plans" | "payments" | "team";
type Overview = Record<string, number>;
type ShopRow = {
  id: string; slug: string; name: string; kind: string; status: string; city: string; state: string | null; country: string;
  phone: string; owner_email: string | null; owner_name: string | null; cover: string | null; submitted_at: string;
  approved_at: string | null; has_changes: boolean; rating_avg: number; rating_count: number; plan: string; products: number;
};

const call = <T,>(fn: string, args: Record<string, unknown> = {}) => rpc<T>(supabase(), fn, args);

export default function AdminApp() {
  const [me, setMe] = useState<Me | null | "denied">(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [ov, setOv] = useState<Overview | null>(null);
  const [openShop, setOpenShop] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3000);
  };
  const refreshOv = useCallback(() => call<Overview>("admin_overview").then(setOv).catch(() => {}), []);

  useEffect(() => {
    requireSession().then(async (s) => {
      if (!s) return;
      const m = await loadMe(true);
      if (!m?.is_admin) return setMe("denied");
      setMe(m);
      const t = new URLSearchParams(location.search).get("tab") as Tab | null;
      if (t) setTab(t);
      refreshOv();
    });
  }, [refreshOv]);

  const go = (t: Tab) => {
    setTab(t);
    history.replaceState(null, "", `/admin?tab=${t}`);
  };

  if (me === null) return <div className="h-40 animate-pulse rounded-2xl bg-sand" />;
  if (me === "denied")
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <h1 className="text-2xl">Admins only</h1>
        <p className="mt-2 text-sm text-muted">This account doesn't have admin access. Sign in with the admin Google account.</p>
      </div>
    );

  const nav: [Tab, string, number?][] = [
    ["overview", "Overview"],
    ["pending", "Approvals", ov?.pending],
    ["changes", "Change requests", ov?.changes],
    ["shops", "All shops"],
    ["reviews", "Reviews"],
    ["tags", "Tags"],
    ["plans", "Plans"],
    ["payments", "Payments"],
    ["team", "Team"],
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Admin sections">
        {nav.map(([t, l, n]) => (
          <button key={t} onClick={() => go(t)} className={`flex shrink-0 items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium ${tab === t ? "bg-maroon-700 text-white" : "hover:bg-sand"}`}>
            {l}
            {!!n && <span className={`rounded-full px-2 text-xs ${tab === t ? "bg-white/20" : "bg-zari-300 text-ink"}`}>{n}</span>}
          </button>
        ))}
      </nav>
      <div className="min-w-0">
        {tab === "overview" && <OverviewPanel ov={ov} go={go} />}
        {tab === "pending" && <ShopList key="p" status="pending" onOpen={setOpenShop} />}
        {tab === "changes" && <ShopList key="c" changes onOpen={setOpenShop} />}
        {tab === "shops" && <ShopList key="a" onOpen={setOpenShop} filterable />}
        {tab === "reviews" && <ReviewsPanel flash={flash} />}
        {tab === "tags" && <TagsPanel flash={flash} />}
        {tab === "plans" && <PlansPanel flash={flash} />}
        {tab === "payments" && <PaymentsPanel />}
        {tab === "team" && <TeamPanel flash={flash} />}
      </div>
      {openShop && (
        <ShopDrawer
          id={openShop}
          onClose={() => setOpenShop(null)}
          onChanged={(m) => {
            flash(m);
            refreshOv();
            window.dispatchEvent(new Event("admin:reload"));
          }}
        />
      )}
      {toast && <div className="fixed bottom-5 left-1/2 z-[80] -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-white shadow-lg" role="status">{toast}</div>}
    </div>
  );
}

function OverviewPanel({ ov, go }: { ov: Overview | null; go: (t: Tab) => void }) {
  if (!ov) return <div className="h-40 animate-pulse rounded-2xl bg-sand" />;
  const cards: [string, string | number, Tab?][] = [
    ["Waiting for approval", ov.pending, "pending"],
    ["Change requests", ov.changes, "changes"],
    ["Live shops", ov.approved, "shops"],
    ["Paid shops", ov.paid_shops, "payments"],
    ["Revenue (30 days)", paise(ov.revenue_30d_paise), "payments"],
    ["Revenue (all time)", paise(ov.revenue_total_paise), "payments"],
    ["Sarees listed", ov.products],
    ["Reviews", ov.reviews, "reviews"],
    ["Users", ov.users, "team"],
    ["Leads sent (30 days)", ov.leads_30d],
    ["Rejected", ov.rejected, "shops"],
    ["Suspended", ov.suspended, "shops"],
  ];
  return (
    <div>
      <h1 className="text-3xl">Admin overview</h1>
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {cards.map(([l, v, t]) => (
          <button key={l} disabled={!t} onClick={() => t && go(t)} className="card p-4 text-left enabled:hover:border-maroon-200">
            <p className="font-display text-3xl text-maroon-800">{v}</p>
            <p className="text-xs text-muted">{l}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function useReload(fn: () => void) {
  useEffect(() => {
    window.addEventListener("admin:reload", fn);
    return () => window.removeEventListener("admin:reload", fn);
  }, [fn]);
}

function ShopList({ status, changes, filterable, onOpen }: { status?: string; changes?: boolean; filterable?: boolean; onOpen: (id: string) => void }) {
  const [st, setSt] = useState(status ?? "");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [res, setRes] = useState<{ total: number; items: ShopRow[] } | null>(null);
  const load = useCallback(() => {
    call<{ total: number; items: ShopRow[] }>("admin_shops", { p_status: st || null, p_q: q || null, p_changes: !!changes, p_limit: 30, p_offset: page * 30 }).then(setRes);
  }, [st, q, changes, page]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);
  useReload(load);

  return (
    <div>
      <h1 className="text-2xl">{changes ? "Change requests" : status === "pending" ? "Waiting for approval" : "All shops"}</h1>
      {filterable && (
        <div className="mt-3 flex flex-wrap gap-2">
          <input className="input max-w-xs" placeholder="Name, city, phone or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
          <select className="input !w-auto" value={st} onChange={(e) => { setSt(e.target.value); setPage(0); }}>
            <option value="">All statuses</option>
            {["pending", "approved", "rejected", "suspended"].map((x) => <option key={x}>{x}</option>)}
          </select>
        </div>
      )}
      {!res ? <div className="mt-4 h-32 animate-pulse rounded-2xl bg-sand" /> : res.items.length === 0 ? (
        <p className="card mt-4 p-8 text-center text-muted">Nothing here. 🎉</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {res.items.map((s) => (
            <li key={s.id}>
              <button onClick={() => onOpen(s.id)} className="card flex w-full items-center gap-3 p-3 text-left hover:border-maroon-200">
                <span className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-sand">{s.cover && <img src={mediaUrl(s.cover, "thumb")!} alt="" className="h-full w-full object-cover" />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{s.name}</span>
                  <span className="block truncate text-xs text-muted">{kindLabel(s.kind)} · {[s.city, s.state, s.country].filter(Boolean).join(", ")} · {s.owner_email}</span>
                  <span className="block text-xs text-muted">Submitted {dateIN(s.submitted_at)} · {s.products} sarees · plan {s.plan}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <StatusBadge status={s.status} />
                  {s.has_changes && <span className="badge bg-zari-100 text-zari-700">changes</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {res && res.total > 30 && (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm">
          <button className="btn-outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>←</button>
          <span>Page {page + 1} of {Math.ceil(res.total / 30)}</span>
          <button className="btn-outline" disabled={(page + 1) * 30 >= res.total} onClick={() => setPage((p) => p + 1)}>→</button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const c: Record<string, string> = { pending: "bg-zari-100 text-zari-700", approved: "bg-leaf-50 text-leaf", rejected: "bg-maroon-50 text-maroon-800", suspended: "bg-ink text-white" };
  return <span className={`badge ${c[status] ?? "bg-sand"}`}>{status}</span>;
}

type AdminShop = {
  shop: Record<string, unknown> & { id: string; slug: string; name: string; kind: string; status: string; lat: number; lng: number; phone: string; whatsapp: string | null; photos: string[]; pending_changes: Record<string, unknown> | null; review_note: string | null; description: string | null; city: string; submitted_at: string; updated_at: string };
  tags: TagRef[];
  plan: Plan;
  plan_ends_at: string | null;
  usage: { products: number; max_products: number; max_photos: number };
  owner: { id: string; email: string; full_name: string | null; phone: string | null; created_at: string; other_shops: number } | null;
  products: { id: string; title: string; images: string[]; price_inr: number | null; active: boolean }[];
};

function ShopDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: (m: string) => void }) {
  const [d, setD] = useState<AdminShop | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [grant, setGrant] = useState({ plan: "pro", days: 30, amount: 0, note: "" });

  const load = useCallback(() => call<AdminShop>("admin_shop", { p_shop: id }).then((x) => { setD(x); setNote(x.shop.review_note ?? ""); }), [id]);
  useEffect(() => {
    load();
    call<Plan[]>("admin_plans").then(setPlans);
  }, [load]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  async function act(fn: string, args: Record<string, unknown>, msg: string) {
    setBusy(true);
    setErr(null);
    try {
      await call(fn, args);
      onChanged(msg);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const s = d?.shop;
  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/40" onClick={onClose} role="dialog" aria-modal="true" aria-label="Shop details">
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-cream p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            {s && <StatusBadge status={s.status} />}
            <h2 className="mt-1 text-2xl">{s?.name ?? "Loading…"}</h2>
            {s && <p className="text-sm text-muted">{kindLabel(s.kind)} · submitted {dateIN(s.submitted_at)}</p>}
          </div>
          <button className="btn-ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {!d || !s ? <div className="mt-6 h-64 animate-pulse rounded-2xl bg-sand" /> : edit ? (
          <div className="mt-4">
            <button className="btn-ghost mb-3" onClick={() => setEdit(false)}>← Back</button>
            <ShopForm initial={shopToValues(s, d.tags)} maxPhotos={20} submitLabel="Save as admin" onSubmit={async (v) => {
              await call("admin_update_shop", { p_shop: s.id, p: valuesToPayload(v) });
              onChanged("Shop updated");
              setEdit(false);
              load();
            }} />
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            {s.photos.length > 0 && (
              <div className="flex gap-2 overflow-x-auto">
                {s.photos.map((p) => <a key={p} href={mediaUrl(p)!} target="_blank" rel="noopener"><img src={mediaUrl(p, "thumb")!} alt="" className="h-28 w-28 shrink-0 rounded-xl object-cover" /></a>)}
              </div>
            )}
            <div className="h-56 overflow-hidden rounded-2xl border border-line"><MiniMap lat={s.lat} lng={s.lng} label={s.name} /></div>
            <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-sm">
              {[
                ["Phone", <a className="underline" href={telLink(s.phone)}>{s.phone}</a>],
                ["WhatsApp", s.whatsapp],
                ["Address", [s.address_line, s.landmark, s.locality, s.city, s.district, s.state, s.postal_code, s.country].filter(Boolean).join(", ")],
                ["Pin", `${s.lat}, ${s.lng}`],
                ["Hours", s.hours],
                ["Owner", d.owner ? `${d.owner.full_name ?? ""} <${d.owner.email}> · joined ${dateIN(d.owner.created_at)}${d.owner.other_shops ? ` · ${d.owner.other_shops} other shop(s)` : ""}` : "—"],
                ["Plan", `${d.plan.name}${d.plan_ends_at && d.plan.code !== "free" ? ` until ${dateIN(d.plan_ends_at)}` : ""} · ${d.usage.products}/${d.usage.max_products} sarees`],
                ["Tags", d.tags.map((t) => t.name).join(", ")],
                ["About", s.description],
              ].filter(([, v]) => v).map(([k, v]) => (
                <div key={k as string} className="contents"><dt className="text-muted">{k as string}</dt><dd className="min-w-0 break-words">{v as React.ReactNode}</dd></div>
              ))}
            </dl>
            <a className="text-sm font-semibold text-maroon-700 underline" target="_blank" href={`https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`}>Check the pin on Google Maps ↗</a>

            {s.pending_changes && (
              <div className="rounded-2xl border border-zari-300 bg-zari-100 p-4 text-sm">
                <p className="font-semibold">Requested changes</p>
                <ul className="mt-1 space-y-0.5">
                  {Object.entries(s.pending_changes).map(([k, v]) => <li key={k}><span className="text-muted">{k}:</span> {String(s[k] ?? "—")} → <strong>{String(v)}</strong></li>)}
                </ul>
                {"lat" in s.pending_changes && (
                  <a className="underline" target="_blank" href={`https://www.google.com/maps/search/?api=1&query=${s.pending_changes.lat},${s.pending_changes.lng}`}>See new pin ↗</a>
                )}
                <div className="mt-3 flex gap-2">
                  <button className="btn-primary !py-1.5" disabled={busy} onClick={() => act("admin_review_changes", { p_shop: s.id, p_approve: true, p_note: null }, "Changes approved")}>Approve changes</button>
                  <button className="btn-outline !py-1.5" disabled={busy} onClick={() => act("admin_review_changes", { p_shop: s.id, p_approve: false, p_note: note || null }, "Changes declined")}>Decline</button>
                </div>
              </div>
            )}

            <div className="card space-y-3 p-4">
              <label className="label" htmlFor="adm-note">Message to seller (required to reject or suspend)</label>
              <textarea id="adm-note" className="input min-h-16" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Please add a photo of the shop front and fix the pin." />
              <div className="flex flex-wrap gap-2">
                {s.status !== "approved" && <button className="btn-primary" disabled={busy} onClick={() => act("admin_set_shop_status", { p_shop: s.id, p_status: "approved", p_note: note || null }, "Approved — now live on the map")}>✓ Approve</button>}
                {s.status !== "rejected" && s.status !== "approved" && <button className="btn-outline" disabled={busy} onClick={() => act("admin_set_shop_status", { p_shop: s.id, p_status: "rejected", p_note: note }, "Sent back to seller")}>Reject with note</button>}
                {s.status === "approved" && <button className="btn-outline" disabled={busy} onClick={() => act("admin_set_shop_status", { p_shop: s.id, p_status: "suspended", p_note: note }, "Suspended")}>Suspend</button>}
                <button className="btn-ghost" onClick={() => setEdit(true)}>Edit details</button>
                {s.status === "approved" && <a className="btn-ghost" target="_blank" href={`/shops/${s.slug}?fresh=1`}>Public page ↗</a>}
              </div>
              {err && <p className="text-sm text-maroon-700">{err}</p>}
            </div>

            <div className="card space-y-2 p-4 text-sm">
              <p className="font-semibold">Record an offline payment / grant a plan</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <select className="input" value={grant.plan} onChange={(e) => { const p = plans.find((x) => x.code === e.target.value); setGrant((g) => ({ ...g, plan: e.target.value, days: p?.duration_days ?? g.days, amount: p?.price_inr ?? 0 })); }}>
                  {plans.filter((p) => p.code !== "free").map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                </select>
                <input className="input" inputMode="numeric" value={grant.days} onChange={(e) => setGrant((g) => ({ ...g, days: Number(e.target.value) || 0 }))} aria-label="Days" />
                <input className="input" inputMode="numeric" value={grant.amount} onChange={(e) => setGrant((g) => ({ ...g, amount: Number(e.target.value) || 0 }))} aria-label="Amount received (₹)" />
                <input className="input" value={grant.note} onChange={(e) => setGrant((g) => ({ ...g, note: e.target.value }))} placeholder="UPI ref / note" />
              </div>
              <p className="text-xs text-muted">Plan · days · amount received in ₹ (0 for complimentary) · reference</p>
              <button className="btn-outline" disabled={busy} onClick={() => act("admin_grant_plan", { p_shop: s.id, p_plan: grant.plan, p_days: grant.days, p_amount_inr: grant.amount, p_note: grant.note || null }, "Plan granted")}>Grant plan</button>
            </div>

            {d.products.length > 0 && (
              <div>
                <p className="text-sm font-semibold">Sarees ({d.products.length})</p>
                <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {d.products.slice(0, 18).map((p) => <img key={p.id} title={p.title} src={mediaUrl(p.images[0], "thumb")!} alt={p.title} className={`aspect-[3/4] w-full rounded-lg object-cover ${p.active ? "" : "opacity-40"}`} />)}
                </div>
              </div>
            )}
            <button className="text-xs text-maroon-700 underline" onClick={() => confirm("Delete this shop and all its sarees permanently?") && act("admin_delete_shop", { p_shop: s.id }, "Shop deleted").then(onClose)}>
              Delete shop permanently
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewsPanel({ flash }: { flash: (m: string) => void }) {
  const [hidden, setHidden] = useState<"" | "true" | "false">("");
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ total: number; items: { id: string; rating: number; comment: string | null; hidden: boolean; hidden_reason: string | null; created_at: string; shop_name: string; shop_slug: string; author: string; email: string; seller_reply: string | null }[] } | null>(null);
  const load = useCallback(() => call<typeof res>("admin_reviews", { p_hidden: hidden === "" ? null : hidden === "true", p_q: q || null, p_limit: 100 }).then(setRes), [hidden, q]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);
  return (
    <div>
      <h1 className="text-2xl">Reviews</h1>
      <p className="text-sm text-muted">Reviews go live immediately. Hide fake or abusive ones — the shop rating updates automatically.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search text or shop" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input !w-auto" value={hidden} onChange={(e) => setHidden(e.target.value as typeof hidden)}>
          <option value="">All</option><option value="false">Visible</option><option value="true">Hidden</option>
        </select>
      </div>
      <ul className="mt-4 space-y-2">
        {res?.items.map((r) => (
          <li key={r.id} className={`card p-4 ${r.hidden ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm"><strong>{r.author}</strong> <span className="text-muted">({r.email})</span> → <a className="underline" href={`/shops/${r.shop_slug}`} target="_blank">{r.shop_name}</a></p>
              <span className="text-zari-600">{"★".repeat(r.rating)}<span className="text-line">{"★".repeat(5 - r.rating)}</span></span>
            </div>
            <p className="text-xs text-muted">{dateIN(r.created_at)}{r.hidden && ` · hidden${r.hidden_reason ? `: ${r.hidden_reason}` : ""}`}</p>
            {r.comment && <p className="mt-2 text-sm">{r.comment}</p>}
            <button className="btn-outline mt-2 !py-1 text-xs" onClick={async () => {
              const reason = r.hidden ? null : prompt("Reason for hiding (optional)") ?? null;
              await call("admin_set_review_hidden", { p_review: r.id, p_hidden: !r.hidden, p_reason: reason });
              flash(r.hidden ? "Review restored" : "Review hidden");
              load();
            }}>{r.hidden ? "Show again" : "Hide"}</button>
          </li>
        ))}
        {res && res.items.length === 0 && <p className="card p-6 text-center text-muted">No reviews.</p>}
      </ul>
    </div>
  );
}

type AdminTag = TagRef & { hidden: boolean; is_default: boolean; products: number; shops: number; created_by: string | null };
function TagsPanel({ flash }: { flash: (m: string) => void }) {
  const [tags, setTags] = useState<AdminTag[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [onlyCustom, setOnlyCustom] = useState(false);
  const [form, setForm] = useState({ id: null as string | null, name: "", category: "fabric", is_default: true, hidden: false });
  const [merge, setMerge] = useState<{ from: AdminTag; into: string } | null>(null);
  const load = useCallback(() => call<AdminTag[]>("admin_tags").then(setTags), []);
  useEffect(() => { load(); }, [load]);
  const list = tags.filter((t) => (!q || t.name.toLowerCase().includes(q.toLowerCase())) && (!cat || t.category === cat) && (!onlyCustom || !t.is_default));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await call("admin_save_tag", { p_id: form.id, p_name: form.name, p_category: form.category, p_is_default: form.is_default, p_hidden: form.hidden });
      flash("Tag saved");
      setForm({ id: null, name: "", category: form.category, is_default: true, hidden: false });
      load();
    } catch (e2) {
      alert(e2 instanceof Error ? e2.message : "Failed");
    }
  }

  return (
    <div>
      <h1 className="text-2xl">Tags</h1>
      <p className="text-sm text-muted">“Common” tags are shown first to sellers and buyers. Sellers can add their own; hide spam or merge duplicates (e.g. “Pattu” into “Pure Pattu”).</p>
      <form onSubmit={save} className="card mt-4 flex flex-wrap items-end gap-2 p-4">
        <div className="min-w-48 flex-1"><label className="label">{form.id ? "Edit tag" : "New tag"}</label><input className="input" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
        <select className="input !w-auto" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>{TAG_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={form.is_default} onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))} /> Common</label>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={form.hidden} onChange={(e) => setForm((f) => ({ ...f, hidden: e.target.checked }))} /> Hidden</label>
        <button className="btn-primary">{form.id ? "Save" : "Add"}</button>
        {form.id && <button type="button" className="btn-ghost" onClick={() => setForm({ id: null, name: "", category: "fabric", is_default: true, hidden: false })}>Cancel</button>}
      </form>
      <div className="mt-4 flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search tags" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input !w-auto" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All types</option>{TAG_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={onlyCustom} onChange={(e) => setOnlyCustom(e.target.checked)} /> Seller-created only</label>
      </div>
      <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-sand text-xs uppercase text-muted"><tr><th className="p-2.5">Tag</th><th className="p-2.5">Type</th><th className="p-2.5">Used</th><th className="p-2.5">Created by</th><th className="p-2.5"></th></tr></thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.id} className={`border-t border-line ${t.hidden ? "opacity-50" : ""}`}>
                <td className="p-2.5 font-medium">{t.name} {t.is_default && <span className="badge bg-maroon-50 text-maroon-800">common</span>} {t.hidden && <span className="badge bg-sand">hidden</span>}</td>
                <td className="p-2.5">{categoryLabel(t.category)}</td>
                <td className="p-2.5">{t.products} sarees · {t.shops} shops</td>
                <td className="p-2.5 text-xs text-muted">{t.created_by ?? "system"}</td>
                <td className="whitespace-nowrap p-2.5 text-right">
                  <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setForm({ id: t.id, name: t.name, category: t.category, is_default: t.is_default, hidden: t.hidden })}>Edit</button>
                  <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setMerge({ from: t, into: "" })}>Merge…</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {merge && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4" onClick={() => setMerge(null)}>
          <div className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <p className="font-semibold">Merge “{merge.from.name}” into…</p>
            <select className="input mt-3" value={merge.into} onChange={(e) => setMerge({ ...merge, into: e.target.value })}>
              <option value="">Choose a tag</option>
              {tags.filter((t) => t.id !== merge.from.id).map((t) => <option key={t.id} value={t.id}>{t.name} ({categoryLabel(t.category)})</option>)}
            </select>
            <p className="mt-2 text-xs text-muted">All sarees and shops tagged “{merge.from.name}” will move to the chosen tag, then “{merge.from.name}” is deleted.</p>
            <div className="mt-4 flex gap-2">
              <button className="btn-primary" disabled={!merge.into} onClick={async () => { await call("admin_merge_tags", { p_from: merge.from.id, p_into: merge.into }); setMerge(null); flash("Tags merged"); load(); }}>Merge</button>
              <button className="btn-ghost" onClick={() => setMerge(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PlansPanel({ flash }: { flash: (m: string) => void }) {
  const [plans, setPlans] = useState<(Plan & { active_shops: number })[]>([]);
  const [edit, setEdit] = useState<(Plan & { featuresText: string }) | null>(null);
  const load = useCallback(() => call<(Plan & { active_shops: number })[]>("admin_plans").then(setPlans), []);
  useEffect(() => { load(); }, [load]);
  const blank: Plan & { featuresText: string } = { code: "", name: "", description: "", price_inr: 0, duration_days: 30, max_products: 50, max_photos: 5, featured: false, priority: 0, features: [], active: true, sort_order: 9, featuresText: "" };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    try {
      await call("admin_save_plan", { p: { ...edit, features: edit.featuresText.split("\n").map((x) => x.trim()).filter(Boolean) } });
      flash("Plan saved");
      setEdit(null);
      load();
    } catch (e2) {
      alert(e2 instanceof Error ? e2.message : "Failed");
    }
  }
  const num = (k: keyof Plan) => (e: React.ChangeEvent<HTMLInputElement>) => setEdit((p) => p && { ...p, [k]: Number(e.target.value) || 0 });

  return (
    <div>
      <div className="flex items-center justify-between"><h1 className="text-2xl">Plans</h1><button className="btn-outline" onClick={() => setEdit(blank)}>+ New plan</button></div>
      <p className="text-sm text-muted">Prices are in rupees including GST. Changing a price affects new purchases only.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {plans.map((p) => (
          <div key={p.code} className={`card p-4 ${p.active ? "" : "opacity-60"}`}>
            <div className="flex items-center justify-between"><p className="font-display text-xl">{p.name}</p><button className="btn-ghost !py-1 text-xs" onClick={() => setEdit({ ...p, featuresText: p.features.join("\n") })}>Edit</button></div>
            <p className="text-sm">₹{p.price_inr} / {p.duration_days} days · {p.max_products} sarees · {p.max_photos} photos · priority {p.priority}{p.featured ? " · featured" : ""}</p>
            <p className="text-xs text-muted">code: {p.code} · {p.active_shops} shops on it now{p.active ? "" : " · inactive"}</p>
          </div>
        ))}
      </div>
      {edit && (
        <form onSubmit={save} className="card mt-5 grid gap-3 p-5 sm:grid-cols-2">
          <div><label className="label">Code (permanent)</label><input className="input" required pattern="[a-z0-9_]{2,30}" disabled={plans.some((p) => p.code === edit.code)} value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></div>
          <div><label className="label">Name</label><input className="input" required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
          <div className="sm:col-span-2"><label className="label">Description</label><input className="input" value={edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
          <div><label className="label">Price ₹ (incl. GST)</label><input className="input" inputMode="numeric" value={edit.price_inr} onChange={num("price_inr")} /></div>
          <div><label className="label">Duration (days)</label><input className="input" inputMode="numeric" value={edit.duration_days} onChange={num("duration_days")} /></div>
          <div><label className="label">Max sarees</label><input className="input" inputMode="numeric" value={edit.max_products} onChange={num("max_products")} /></div>
          <div><label className="label">Max shop photos</label><input className="input" inputMode="numeric" value={edit.max_photos} onChange={num("max_photos")} /></div>
          <div><label className="label">Ranking priority (higher shows first)</label><input className="input" inputMode="numeric" value={edit.priority} onChange={num("priority")} /></div>
          <div><label className="label">Sort order</label><input className="input" inputMode="numeric" value={edit.sort_order} onChange={num("sort_order")} /></div>
          <div className="sm:col-span-2"><label className="label">Features (one per line)</label><textarea className="input min-h-24" value={edit.featuresText} onChange={(e) => setEdit({ ...edit, featuresText: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.featured} onChange={(e) => setEdit({ ...edit, featured: e.target.checked })} /> Featured badge & gold pin</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Available to buy</label>
          <div className="flex gap-2 sm:col-span-2"><button className="btn-primary">Save plan</button><button type="button" className="btn-ghost" onClick={() => setEdit(null)}>Cancel</button></div>
        </form>
      )}
    </div>
  );
}

function PaymentsPanel() {
  const [status, setStatus] = useState("paid");
  const [res, setRes] = useState<{ total: number; items: { id: string; shop_name: string; shop_slug: string; email: string; plan_code: string; amount_paise: number; status: string; provider: string; razorpay_order_id: string | null; razorpay_payment_id: string | null; method: string | null; note: string | null; error_reason: string | null; created_at: string; paid_at: string | null }[] } | null>(null);
  useEffect(() => { call<typeof res>("admin_payments", { p_status: status || null, p_limit: 200 }).then(setRes); }, [status]);
  const total = res?.items.filter((p) => p.status === "paid").reduce((a, p) => a + p.amount_paise, 0) ?? 0;
  function csv() {
    if (!res) return;
    const rows = [["Date", "Shop", "Email", "Plan", "Amount (INR)", "Status", "Provider", "Method", "Payment ID", "Order ID", "Note"],
      ...res.items.map((p) => [p.paid_at ?? p.created_at, p.shop_name, p.email, p.plan_code, (p.amount_paise / 100).toFixed(2), p.status, p.provider, p.method ?? "", p.razorpay_payment_id ?? "", p.razorpay_order_id ?? "", p.note ?? p.error_reason ?? ""])];
    const blob = new Blob([rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sarees-hub-payments-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl">Payments</h1>
        <div className="flex gap-2">
          <select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="paid">Paid</option><option value="created">Started (not paid)</option><option value="failed">Failed</option></select>
          <button className="btn-outline" onClick={csv}>Export CSV</button>
        </div>
      </div>
      <p className="text-sm text-muted">{res?.total ?? 0} payments · {paise(total)} collected in this list. Refunds are issued from the Razorpay dashboard.</p>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-sand text-xs uppercase text-muted"><tr><th className="p-2.5">Date</th><th className="p-2.5">Shop</th><th className="p-2.5">Plan</th><th className="p-2.5">Amount</th><th className="p-2.5">Status</th><th className="p-2.5">Reference</th></tr></thead>
          <tbody>
            {res?.items.map((p) => (
              <tr key={p.id} className="border-t border-line">
                <td className="p-2.5 whitespace-nowrap">{dateIN(p.paid_at ?? p.created_at)}</td>
                <td className="p-2.5"><a className="underline" href={`/shops/${p.shop_slug}`} target="_blank">{p.shop_name}</a><span className="block text-xs text-muted">{p.email}</span></td>
                <td className="p-2.5">{p.plan_code}</td>
                <td className="p-2.5">{paise(p.amount_paise)}</td>
                <td className="p-2.5"><StatusBadge status={p.status === "paid" ? "approved" : p.status === "failed" ? "rejected" : "pending"} /> <span className="text-xs">{p.status}</span></td>
                <td className="p-2.5 font-mono text-xs">{p.provider === "manual" ? `manual · ${p.note ?? ""}` : p.razorpay_payment_id ?? p.razorpay_order_id}{p.error_reason && <span className="block text-maroon-700">{p.error_reason}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TeamPanel({ flash }: { flash: (m: string) => void }) {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<{ id: string; email: string; full_name: string | null; created_at: string; is_admin: boolean; shops: number; reviews: number }[]>([]);
  const [email, setEmail] = useState("");
  const load = useCallback(() => call<typeof users>("admin_users", { p_q: q || null, p_limit: 100 }).then(setUsers), [q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  async function setAdmin(e: string, make: boolean) {
    try {
      await call("admin_set_admin", { p_email: e, p_admin: make });
      flash(make ? `${e} is now an admin` : `Removed admin: ${e}`);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    }
  }
  return (
    <div>
      <h1 className="text-2xl">Team & users</h1>
      <form className="card mt-4 flex flex-wrap items-end gap-2 p-4" onSubmit={(e) => { e.preventDefault(); setAdmin(email, true); setEmail(""); }}>
        <div className="flex-1"><label className="label">Add an admin by Google email</label><input type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gmail.com" /></div>
        <button className="btn-primary">Make admin</button>
      </form>
      <input className="input mt-4 max-w-xs" placeholder="Search users" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="mt-3 space-y-2">
        {users.map((u) => (
          <li key={u.id} className="card flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <span><strong>{u.full_name ?? "—"}</strong> <span className="text-muted">{u.email}</span>{u.is_admin && <span className="badge ml-2 bg-maroon-700 text-white">admin</span>}<span className="block text-xs text-muted">Joined {dateIN(u.created_at)} · {u.shops} shops · {u.reviews} reviews</span></span>
            <button className="btn-ghost !py-1 text-xs" onClick={() => setAdmin(u.email, !u.is_admin)}>{u.is_admin ? "Remove admin" : "Make admin"}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
