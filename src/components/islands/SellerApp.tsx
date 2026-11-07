import { useCallback, useEffect, useState } from "react";
import ShopForm, { shopToValues, valuesToPayload } from "./ShopForm";
import ImageUploader from "./ImageUploader";
import TagPicker from "./TagPicker";
import SellerRequests from "./SellerRequests";
import { rpc, supabase } from "../../lib/supabase";
import { loadMe, requireSession } from "../../lib/session";
import { buyPlan } from "../../lib/checkout";
import { SAREE_COLORS, kindLabel } from "../../lib/config";
import { dateIN, mediaUrl, paise, rupees } from "../../lib/format";
import type { Me, Plan, TagRef } from "../../lib/types";

type Product = {
  id: string; slug: string; title: string; description: string | null; price_inr: number | null; mrp_inr: number | null;
  colors: string[]; length_m: number | null; blouse_included: boolean; in_stock: boolean; images: string[]; active: boolean;
  updated_at: string; tags: TagRef[];
};
type MyShop = {
  shop: Record<string, unknown> & { id: string; slug: string; name: string; status: string; review_note: string | null; pending_changes: Record<string, unknown> | null; kind: string; city: string; rating_avg: number; rating_count: number; submitted_at: string };
  tags: TagRef[];
  plan: Plan;
  plan_ends_at: string | null;
  usage: { products: number; max_products: number; max_photos: number };
  stats: { last30: { views: number; calls: number; whatsapp: number; directions: number }; daily: { day: string; views: number; leads: number }[]; favorites: number };
  products: Product[];
  reviews: { id: string; rating: number; comment: string | null; created_at: string; author: string; seller_reply: string | null; hidden: boolean }[];
  payments: { id: string; plan_code: string; amount_paise: number; status: string; provider: string; razorpay_payment_id: string | null; method: string | null; created_at: string; paid_at: string | null }[];
};
type Tab = "overview" | "requests" | "details" | "sarees" | "reviews" | "plan";

export default function SellerApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [shopId, setShopId] = useState<string | null>(null);
  const [data, setData] = useState<MyShop | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const isNew = typeof window !== "undefined" && new URLSearchParams(location.search).get("new") === "1";

  useEffect(() => {
    requireSession().then(async (s) => {
      if (!s) return;
      const m = await loadMe(true);
      setMe(m);
      const want = new URLSearchParams(location.search).get("shop");
      const t = new URLSearchParams(location.search).get("tab") as Tab | null;
      if (t) setTab(t);
      setShopId(m?.shops.find((x) => x.id === want)?.id ?? m?.shops[0]?.id ?? null);
    });
  }, []);

  const reload = useCallback(async () => {
    if (!shopId) return;
    try {
      setData(await rpc<MyShop>(supabase(), "my_shop", { p_shop: shopId }));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't load your shop.");
    }
  }, [shopId]);
  useEffect(() => {
    reload();
  }, [reload]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3500);
  };
  const go = (t: Tab) => {
    setTab(t);
    const u = new URL(location.href);
    u.searchParams.set("tab", t);
    u.searchParams.delete("new");
    history.replaceState(null, "", u);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!me) return <Skeleton />;
  if (me.shops.length === 0)
    return (
      <div className="card mx-auto max-w-lg p-8 text-center">
        <h1 className="text-3xl">Start selling on Sarees Hub</h1>
        <p className="mt-2 text-muted">Register your shop for free. Once approved, buyers nearby can find you on the map.</p>
        <a className="btn-primary mt-6" href="/seller/register">Register your shop</a>
      </div>
    );
  if (err) return <p className="rounded-xl bg-brand-50 p-4 text-brand-800">{err}</p>;
  if (!data) return <Skeleton />;

  const s = data.shop;
  const tabs: [Tab, string][] = [
    ["overview", "Overview"],
    ["requests", "Custom requests"],
    ["sarees", `Sarees (${data.usage.products})`],
    ["details", "Shop details"],
    ["reviews", `Reviews (${data.reviews.length})`],
    ["plan", "Plan & billing"],
  ];

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zari-700">{kindLabel(s.kind)} · {s.city}</p>
          <h1 className="text-2xl leading-tight sm:truncate sm:text-3xl">{s.name}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {me.shops.length > 1 && (
            <select className="input !w-auto" value={shopId ?? ""} onChange={(e) => { setData(null); setShopId(e.target.value); }} aria-label="Switch shop">
              {me.shops.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          )}
          {s.status === "approved" && <a href={`/shops/${s.slug}?fresh=1`} target="_blank" className="btn-outline">View public page ↗</a>}
          <a href="/seller/register" className="btn-ghost text-sm">+ Add branch</a>
        </div>
      </div>

      <StatusBanner data={data} isNew={isNew} onEdit={() => go("details")} onCancelChanges={async () => { await rpc(supabase(), "cancel_shop_changes", { p_shop: s.id }); reload(); }} />

      <nav className="mt-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="Dashboard sections" style={{ scrollbarWidth: "none" }}>
        {tabs.map(([t, l]) => (
          <button key={t} onClick={() => go(t)} className={`shrink-0 border-b-2 px-4 py-2.5 text-sm font-semibold ${tab === t ? "border-brand-700 text-brand-800" : "border-transparent text-muted hover:text-ink"}`} aria-current={tab === t ? "page" : undefined}>
            {l}
          </button>
        ))}
      </nav>

      <div className="mt-6">
        {tab === "overview" && <Overview data={data} go={go} />}
        {tab === "details" && (
          <ShopForm
            key={s.id + s.updated_at}
            initial={shopToValues(s, data.tags)}
            maxPhotos={data.usage.max_photos}
            liveShop={s.status === "approved" || s.status === "suspended"}
            submitLabel={s.status === "rejected" ? "Save & resubmit for approval" : "Save changes"}
            onSubmit={async (v) => {
              const r = await rpc<{ status: string; pending_changes: unknown }>(supabase(), "update_shop", { p_shop: s.id, p: valuesToPayload(v) });
              await reload();
              flash(r.pending_changes ? "Saved. Name/location changes are waiting for a quick review." : "Saved.");
              go("overview");
            }}
          />
        )}
        {tab === "requests" && <SellerRequests shopId={s.id} goPlan={() => go("plan")} flash={flash} />}
        {tab === "sarees" && <Sarees data={data} reload={reload} flash={flash} go={go} />}
        {tab === "reviews" && <Reviews data={data} reload={reload} flash={flash} />}
        {tab === "plan" && <Billing data={data} me={me} reload={reload} flash={flash} />}
      </div>

      {toast && <div className="fixed bottom-24 left-1/2 z-[80] md:bottom-5 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-white shadow-lg" role="status">{toast}</div>}
    </div>
  );
}

function Skeleton() {
  return <div className="space-y-4"><div className="h-10 w-1/2 animate-pulse rounded-xl bg-sand" /><div className="h-48 animate-pulse rounded-2xl bg-sand" /></div>;
}

function StatusBanner({ data, isNew, onEdit, onCancelChanges }: { data: MyShop; isNew: boolean; onEdit: () => void; onCancelChanges: () => void }) {
  const s = data.shop;
  return (
    <div className="mt-4 space-y-2">
      {s.status === "pending" && (
        <div className="rounded-2xl border border-zari-300 bg-zari-100 p-4 text-sm">
          <p className="font-semibold text-zari-700">{isNew ? "🎉 Thanks! Your shop was submitted." : "Waiting for approval"}</p>
          <p className="mt-1">Our team checks every listing, usually within a day. Meanwhile, add your best sarees so your page is ready when it goes live.</p>
        </div>
      )}
      {s.status === "rejected" && (
        <div className="rounded-2xl border border-brand-200 bg-brand-50 p-4 text-sm">
          <p className="font-semibold text-brand-800">Needs changes before it can go live</p>
          {s.review_note && <p className="mt-1">“{s.review_note}”</p>}
          <button className="btn-primary mt-3" onClick={onEdit}>Fix & resubmit</button>
        </div>
      )}
      {s.status === "suspended" && (
        <div className="rounded-2xl border border-brand-200 bg-brand-50 p-4 text-sm">
          <p className="font-semibold text-brand-800">Your listing is hidden</p>
          {s.review_note && <p className="mt-1">Reason: {s.review_note}</p>}
          <p className="mt-1">Please <a className="underline" href="/contact">contact us</a> to restore it.</p>
        </div>
      )}
      {s.status === "approved" && s.review_note && !s.pending_changes && (
        <div className="rounded-2xl border border-line bg-white p-3 text-sm">Note from our team: {s.review_note}</div>
      )}
      {s.pending_changes && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-white p-3 text-sm">
          <span>Changes waiting for review: <strong>{Object.keys(s.pending_changes).filter((k) => k !== "lng").map((k) => (k === "lat" ? "location" : k.replace("_", " "))).join(", ")}</strong></span>
          <button className="btn-ghost text-xs" onClick={onCancelChanges}>Cancel request</button>
        </div>
      )}
    </div>
  );
}

function Overview({ data, go }: { data: MyShop; go: (t: Tab) => void }) {
  const st = data.stats.last30;
  const s = data.shop;
  const url = `${location.origin}/shops/${s.slug}`;
  const max = Math.max(1, ...data.stats.daily.map((d) => d.views + d.leads));
  const checklist = [
    { done: ((s.photos as string[]) ?? []).length > 0, label: "Add a shop photo", tab: "details" as Tab },
    { done: data.tags.length >= 3, label: "Pick at least 3 specialities", tab: "details" as Tab },
    { done: !!s.hours, label: "Add your timings", tab: "details" as Tab },
    { done: data.usage.products >= 3, label: "List 3 or more sarees", tab: "sarees" as Tab },
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[["Page views", st.views], ["Calls", st.calls], ["WhatsApp", st.whatsapp], ["Directions", st.directions], ["Saved by", data.stats.favorites]].map(([l, n]) => (
            <div key={l as string} className="card p-4">
              <p className="font-display text-3xl text-brand-800">{n}</p>
              <p className="text-xs text-muted">{l}{l !== "Saved by" && " · 30 days"}</p>
            </div>
          ))}
        </div>
        <div className="card p-4">
          <p className="text-sm font-semibold">Last 30 days</p>
          <div className="mt-3 flex h-36 items-end gap-[3px]" role="img" aria-label="Daily views and leads chart">
            {data.stats.daily.map((d) => (
              <div key={d.day} className="flex flex-1 flex-col justify-end" title={`${dateIN(d.day)}: ${d.views} views, ${d.leads} leads`}>
                <div className="rounded-t-sm bg-zari-500" style={{ height: `${(d.leads / max) * 100}%` }} />
                <div className="bg-brand-200" style={{ height: `${(d.views / max) * 100}%` }} />
              </div>
            ))}
          </div>
          <p className="mt-2 flex gap-4 text-xs text-muted"><span><span className="mr-1 inline-block h-2 w-2 bg-brand-200" />Views</span><span><span className="mr-1 inline-block h-2 w-2 bg-zari-500" />Calls, WhatsApp & directions</span></p>
        </div>
        {data.shop.status === "approved" && (
          <div className="card p-4">
            <p className="text-sm font-semibold">Share your shop page</p>
            <p className="text-xs text-muted">Put it on your WhatsApp status, Instagram bio and visiting cards.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input readOnly value={url} className="input flex-1" onFocus={(e) => e.target.select()} aria-label="Shop link" />
              <button className="btn-outline" onClick={() => navigator.clipboard.writeText(url)}>Copy</button>
              <a className="btn-whatsapp" target="_blank" rel="noopener" href={`https://wa.me/?text=${encodeURIComponent(`Visit ${s.name} on Sarees Hub — see our sarees, timings and directions: ${url}`)}`}>Share on WhatsApp</a>
            </div>
          </div>
        )}
      </div>
      <aside className="space-y-4">
        <div className="card p-4">
          <p className="text-sm font-semibold">Complete your listing</p>
          <ul className="mt-2 space-y-2 text-sm">
            {checklist.map((c) => (
              <li key={c.label} className="flex items-center gap-2">
                <span className={c.done ? "text-leaf" : "text-line"}>{c.done ? "✓" : "○"}</span>
                {c.done ? <span className="text-muted line-through">{c.label}</span> : <button className="text-left underline" onClick={() => go(c.tab)}>{c.label}</button>}
              </li>
            ))}
          </ul>
        </div>
        <div className="card p-4 text-sm">
          <p className="font-semibold">{data.plan.name} plan</p>
          <p className="text-muted">{data.usage.products} of {data.usage.max_products} sarees used{data.plan_ends_at && data.plan.code !== "free" ? ` · until ${dateIN(data.plan_ends_at)}` : ""}</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-sand"><div className="h-full bg-brand-700" style={{ width: `${Math.min(100, (data.usage.products / Math.max(1, data.usage.max_products)) * 100)}%` }} /></div>
          {!data.plan.featured && <button className="btn-gold mt-3 w-full" onClick={() => go("plan")}>Get featured</button>}
        </div>
        <div className="card p-4 text-sm">
          <p className="font-semibold">Rating</p>
          <p className="font-display text-3xl text-brand-800">{Number(s.rating_avg).toFixed(1)} <span className="text-base text-muted">({s.rating_count})</span></p>
          <button className="mt-1 underline" onClick={() => go("reviews")}>Reply to reviews</button>
        </div>
      </aside>
    </div>
  );
}

const emptyProduct = (): Omit<Product, "id" | "slug" | "updated_at"> & { id?: string } => ({
  title: "", description: "", price_inr: null, mrp_inr: null, colors: [], length_m: 6.3, blouse_included: true,
  in_stock: true, images: [], active: true, tags: [],
});

function Sarees({ data, reload, flash, go }: { data: MyShop; reload: () => Promise<void>; flash: (m: string) => void; go: (t: Tab) => void }) {
  const [editing, setEditing] = useState<ReturnType<typeof emptyProduct> | null>(null);
  const [q, setQ] = useState("");
  const full = data.usage.products >= data.usage.max_products;
  const list = data.products.filter((p) => !q || p.title.toLowerCase().includes(q.toLowerCase()));

  async function quick(p: Product, patch: Partial<Product>) {
    await rpc(supabase(), "save_product", { p_shop: data.shop.id, p: { ...p, ...patch, tag_ids: p.tags.map((t) => t.id) } });
    await reload();
  }
  async function del(p: Product) {
    if (!confirm(`Delete “${p.title}”?`)) return;
    await rpc(supabase(), "delete_product", { p_product: p.id });
    await reload();
    flash("Deleted.");
  }

  if (editing)
    return (
      <ProductEditor
        shopId={data.shop.id}
        initial={editing}
        onCancel={() => setEditing(null)}
        onSaved={async (addAnother) => {
          await reload();
          flash("Saree saved.");
          setEditing(addAnother ? { ...emptyProduct(), tags: editing.tags, length_m: editing.length_m } : null);
        }}
      />
    );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search your sarees" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="text-sm text-muted">{data.usage.products} / {data.usage.max_products} on the {data.plan.name} plan</span>
        <button className="btn-primary ml-auto" onClick={() => (full ? go("plan") : setEditing(emptyProduct()))}>
          {full ? "Limit reached — upgrade" : "+ Add saree"}
        </button>
      </div>
      {data.products.length === 0 ? (
        <div className="card mt-6 p-10 text-center">
          <p className="font-display text-2xl">Add your first saree</p>
          <p className="mt-1 text-sm text-muted">A clear photo, price and a few tags (fabric, weave, occasion) is all you need. Buyers can then WhatsApp you about it.</p>
          <button className="btn-primary mt-4" onClick={() => setEditing(emptyProduct())}>+ Add saree</button>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((p) => (
            <div key={p.id} className={`card overflow-hidden ${p.active ? "" : "opacity-60"}`}>
              <button className="block aspect-[3/4] w-full bg-sand" onClick={() => setEditing(p)} aria-label={`Edit ${p.title}`}>
                {p.images[0] && <img src={mediaUrl(p.images[0], "thumb")!} alt="" className="h-full w-full object-cover" loading="lazy" />}
              </button>
              <div className="space-y-1 p-3">
                <p className="line-clamp-2 text-sm font-medium">{p.title}</p>
                <p className="text-sm font-semibold">{rupees(p.price_inr)}</p>
                <div className="flex flex-wrap gap-1 text-[11px]">
                  {!p.active && <span className="badge bg-sand">Hidden</span>}
                  {!p.in_stock && <span className="badge bg-brand-50 text-brand-800">Out of stock</span>}
                </div>
                <div className="flex flex-wrap gap-1 pt-1">
                  <button className="btn-outline !px-2 !py-1 text-xs" onClick={() => setEditing(p)}>Edit</button>
                  <button className="btn-outline !px-2 !py-1 text-xs" onClick={() => quick(p, { in_stock: !p.in_stock })}>{p.in_stock ? "Mark sold out" : "Back in stock"}</button>
                  <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => quick(p, { active: !p.active })}>{p.active ? "Hide" : "Show"}</button>
                  <button className="btn-ghost !px-2 !py-1 text-xs text-brand-700" onClick={() => del(p)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductEditor({ shopId, initial, onCancel, onSaved }: { shopId: string; initial: ReturnType<typeof emptyProduct>; onCancel: () => void; onSaved: (addAnother: boolean) => void }) {
  const [p, setP] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [customColor, setCustomColor] = useState("");
  const set = <K extends keyof typeof p>(k: K, v: (typeof p)[K]) => setP((x) => ({ ...x, [k]: v }));
  const toggleColor = (c: string) => set("colors", p.colors.includes(c) ? p.colors.filter((x) => x !== c) : p.colors.length < 6 ? [...p.colors, c] : p.colors);

  async function save(addAnother: boolean) {
    setErr(null);
    if (!p.images.length) return setErr("Add at least one photo.");
    if (p.title.trim().length < 3) return setErr("Add a title.");
    setBusy(true);
    try {
      await rpc(supabase(), "save_product", { p_shop: shopId, p: { ...p, tag_ids: p.tags.map((t) => t.id) } });
      onSaved(addAnother);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card space-y-5 p-5 sm:p-6" onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <div className="flex items-center justify-between">
        <h2 className="text-2xl">{p.id ? "Edit saree" : "Add a saree"}</h2>
        <button type="button" className="btn-ghost" onClick={onCancel}>← Back</button>
      </div>
      <ImageUploader label="Photos" hint="Full saree first, then pallu, border and blouse. Natural daylight works best." value={p.images} onChange={(v) => set("images", v)} max={6} folder="sarees" />
      <div>
        <label className="label" htmlFor="p-title">Title *</label>
        <input id="p-title" className="input" required minLength={3} maxLength={140} value={p.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Maroon pure pattu Dharmavaram with gold zari border" />
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <div>
          <label className="label" htmlFor="p-price">Price (₹)</label>
          <input id="p-price" className="input" inputMode="numeric" value={p.price_inr ?? ""} onChange={(e) => set("price_inr", e.target.value ? Number(e.target.value.replace(/\D/g, "")) : null)} placeholder="Leave empty for “price on request”" />
        </div>
        <div>
          <label className="label" htmlFor="p-mrp">MRP (₹, optional)</label>
          <input id="p-mrp" className="input" inputMode="numeric" value={p.mrp_inr ?? ""} onChange={(e) => set("mrp_inr", e.target.value ? Number(e.target.value.replace(/\D/g, "")) : null)} />
        </div>
        <div>
          <label className="label" htmlFor="p-len">Length (m)</label>
          <input id="p-len" className="input" inputMode="decimal" value={p.length_m ?? ""} onChange={(e) => set("length_m", e.target.value ? Number(e.target.value) : null)} />
        </div>
        <div className="flex flex-col justify-end gap-1.5 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={p.blouse_included} onChange={(e) => set("blouse_included", e.target.checked)} /> Blouse piece included</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={p.in_stock} onChange={(e) => set("in_stock", e.target.checked)} /> In stock</label>
        </div>
      </div>
      <TagPicker label="Tags — fabric, weave, zari, occasion" hint="e.g. Pure Pattu + Dharmavaram + Pure Zari + Bridal. Buyers filter by these." value={p.tags} onChange={(t) => set("tags", t)} max={15} />
      <div>
        <p className="label">Colours</p>
        <div className="flex flex-wrap gap-1.5">
          {[...SAREE_COLORS, ...p.colors.filter((c) => !SAREE_COLORS.includes(c))].map((c) => (
            <button type="button" key={c} className={`chip ${p.colors.includes(c) ? "chip-active" : ""}`} onClick={() => toggleColor(c)}>{c}</button>
          ))}
          <input className="input !w-36 !py-1" placeholder="Other colour" value={customColor} onChange={(e) => setCustomColor(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (customColor.trim()) { toggleColor(customColor.trim()); setCustomColor(""); } } }} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="p-desc">Description</label>
        <textarea id="p-desc" className="input min-h-24" maxLength={3000} value={p.description ?? ""} onChange={(e) => set("description", e.target.value)} placeholder="Weight, border width, care instructions, wholesale price for 10+ pieces…" />
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.active} onChange={(e) => set("active", e.target.checked)} /> Show this saree on my page</label>
      {err && <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        {!p.id && <button type="button" className="btn-outline" disabled={busy} onClick={() => save(true)}>Save & add another</button>}
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function Reviews({ data, reload, flash }: { data: MyShop; reload: () => Promise<void>; flash: (m: string) => void }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (data.reviews.length === 0) return <p className="card p-8 text-center text-muted">No reviews yet. Ask happy customers to review you — share your shop link after a sale.</p>;
  return (
    <ul className="space-y-3">
      {data.reviews.map((r) => (
        <li key={r.id} className={`card p-4 ${r.hidden ? "opacity-60" : ""}`}>
          <div className="flex items-center justify-between">
            <p className="font-semibold">{r.author}</p>
            <span className="text-zari-600">{"★".repeat(r.rating)}<span className="text-line">{"★".repeat(5 - r.rating)}</span></span>
          </div>
          <p className="text-xs text-muted">{dateIN(r.created_at)}{r.hidden && " · hidden by moderators"}</p>
          {r.comment && <p className="mt-2 text-sm">{r.comment}</p>}
          {!r.hidden && (
            <div className="mt-3">
              <textarea className="input min-h-16 text-sm" placeholder="Write a polite public reply…" maxLength={1000}
                value={drafts[r.id] ?? r.seller_reply ?? ""} onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))} />
              <button className="btn-outline mt-2 !py-1.5 text-xs" onClick={async () => {
                await rpc(supabase(), "reply_review", { p_review: r.id, p_reply: drafts[r.id] ?? r.seller_reply ?? "" });
                await reload();
                flash("Reply saved.");
              }}>{r.seller_reply ? "Update reply" : "Post reply"}</button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Billing({ data, me, reload, flash }: { data: MyShop; me: Me; reload: () => Promise<void>; flash: (m: string) => void }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    rpc<Plan[]>(supabase(), "list_plans").then(setPlans).catch(() => {});
  }, []);
  const approved = data.shop.status === "approved";

  async function buy(code: string) {
    setErr(null);
    setBusy(code);
    try {
      const r = await buyPlan(data.shop.id, code, { name: me.full_name ?? undefined, email: me.email, contact: (data.shop.phone as string) ?? undefined });
      await reload();
      flash(`Payment successful! Plan active until ${dateIN(r.ends_at)}.`);
    } catch (e) {
      const m = e instanceof Error ? e.message : "Payment failed.";
      if (m !== "Payment cancelled.") setErr(m);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <p className="text-sm text-muted">Current plan</p>
          <p className="font-display text-2xl">{data.plan.name}{data.plan.featured && <span className="badge ml-2 bg-zari-100 text-zari-700">★ Featured</span>}</p>
          {data.plan_ends_at && data.plan.code !== "free" && <p className="text-sm">Active until <strong>{dateIN(data.plan_ends_at)}</strong>. Buying the same plan again extends it.</p>}
        </div>
        <p className="text-sm text-muted">{data.usage.products}/{data.usage.max_products} sarees · {data.usage.max_photos} shop photos</p>
      </div>
      {!approved && <p className="rounded-xl bg-zari-100 p-3 text-sm text-zari-700">You can buy a plan once your shop is approved.</p>}
      {err && <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800" role="alert">{err}</p>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((p) => (
          <div key={p.code} className={`card flex flex-col p-5 ${p.code === data.plan.code ? "ring-2 ring-brand-700" : ""}`}>
            <p className="font-display text-xl">{p.name}</p>
            <p className="mt-1"><span className="font-display text-3xl text-brand-800">₹{p.price_inr.toLocaleString("en-IN")}</span>{p.price_inr > 0 && <span className="text-xs text-muted"> / {p.duration_days} days</span>}</p>
            <ul className="mt-3 flex-1 space-y-1 text-sm">{p.features.map((f) => <li key={f}>✓ {f}</li>)}</ul>
            {p.price_inr > 0 ? (
              <button className="btn-primary mt-4" disabled={!approved || !!busy} onClick={() => buy(p.code)}>
                {busy === p.code ? "Opening payment…" : p.code === data.plan.code ? "Extend" : "Buy now"}
              </button>
            ) : (
              <p className="mt-4 text-center text-xs text-muted">{p.code === data.plan.code ? "Your current plan" : "Included"}</p>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">Secure payments by Razorpay — UPI, cards, netbanking and wallets. Prices include GST. Plans don't auto-renew. <a className="underline" href="/refund-policy">Refund policy</a>.</p>
      <div>
        <h3 className="text-xl">Payment history</h3>
        {data.payments.length === 0 ? <p className="mt-2 text-sm text-muted">No payments yet.</p> : (
          <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-sand text-xs uppercase text-muted"><tr><th className="p-3">Date</th><th className="p-3">Plan</th><th className="p-3">Amount</th><th className="p-3">Status</th><th className="p-3">Reference</th></tr></thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.id} className="border-t border-line">
                    <td className="whitespace-nowrap p-3">{dateIN(p.paid_at ?? p.created_at)}</td>
                    <td className="p-3">{plans.find((x) => x.code === p.plan_code)?.name ?? p.plan_code}</td>
                    <td className="p-3">{paise(p.amount_paise)}</td>
                    <td className="p-3"><span className={`badge ${p.status === "paid" ? "bg-leaf-50 text-leaf" : "bg-brand-50 text-brand-800"}`}>{p.status}</span></td>
                    <td className="p-3 font-mono text-xs">{p.razorpay_payment_id ?? (p.provider === "manual" ? "Offline" : "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
