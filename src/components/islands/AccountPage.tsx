import { useEffect, useState } from "react";
import { rpc, supabase } from "../../lib/supabase";
import { requireSession, signOut, useMe } from "../../lib/session";
import { dateIN, mediaUrl, placeLine } from "../../lib/format";
import type { ShopCard } from "../../lib/types";

type Activity = {
  favorites: ShopCard[];
  reviews: { id: string; rating: number; comment: string | null; hidden: boolean; created_at: string; seller_reply: string | null; shop: { slug: string; name: string; city: string } }[];
};

export default function AccountPage() {
  const { me, refresh } = useMe();
  const [act, setAct] = useState<Activity | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    requireSession().then((s) => s && rpc<Activity>(supabase(), "my_activity").then(setAct));
  }, []);
  useEffect(() => {
    if (me) {
      setName(me.full_name ?? "");
      setPhone(me.phone ?? "");
    }
  }, [me]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await rpc(supabase(), "update_profile", { p_full_name: name, p_phone: phone });
    setSaved(true);
    refresh();
    setTimeout(() => setSaved(false), 2000);
  }

  if (!me || !act) return <div className="h-40 animate-pulse rounded-2xl bg-sand" />;

  return (
    <div className="grid gap-8 lg:grid-cols-[320px_1fr]">
      <aside className="space-y-4">
        <form onSubmit={save} className="card space-y-3 p-5">
          <h2 className="text-xl">Your profile</h2>
          <p className="text-sm text-muted">{me.email}</p>
          <div>
            <label className="label" htmlFor="pf-name">Name shown on reviews</label>
            <input id="pf-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <div>
            <label className="label" htmlFor="pf-phone">Phone (private)</label>
            <input id="pf-phone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} inputMode="tel" />
          </div>
          <button className="btn-primary">{saved ? "Saved ✓" : "Save"}</button>
        </form>
        <div className="card space-y-2 p-5 text-sm">
          {me.shops.length > 0 ? <a className="btn-outline w-full" href="/seller">Seller dashboard</a> : <a className="btn-outline w-full" href="/seller/register">Register your shop</a>}
          {me.is_admin && <a className="btn-outline w-full" href="/admin">Admin portal</a>}
          <button className="btn-ghost w-full" onClick={signOut}>Sign out</button>
        </div>
      </aside>
      <div className="space-y-10">
        <section>
          <h2 className="text-2xl">Saved shops</h2>
          {act.favorites.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Tap “Save” on any shop to keep it here.</p>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
              {act.favorites.map((s) => (
                <a key={s.id} href={`/shops/${s.slug}`} className="card overflow-hidden hover:border-maroon-200">
                  <div className="aspect-[4/3] bg-sand">{s.cover && <img src={mediaUrl(s.cover, "thumb")!} alt="" className="h-full w-full object-cover" loading="lazy" />}</div>
                  <div className="p-3">
                    <p className="font-semibold">{s.name}</p>
                    <p className="text-xs text-muted">{placeLine(s)}</p>
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>
        <section>
          <h2 className="text-2xl">Your reviews</h2>
          {act.reviews.length === 0 ? (
            <p className="mt-2 text-sm text-muted">You haven't reviewed any shops yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {act.reviews.map((r) => (
                <li key={r.id} className="card p-4">
                  <div className="flex items-center justify-between gap-2">
                    <a href={`/shops/${r.shop.slug}#reviews`} className="font-semibold hover:text-maroon-700">{r.shop.name}</a>
                    <span className="text-sm text-zari-600">{"★".repeat(r.rating)}<span className="text-line">{"★".repeat(5 - r.rating)}</span></span>
                  </div>
                  <p className="text-xs text-muted">{r.shop.city} · {dateIN(r.created_at)} {r.hidden && <span className="text-maroon-700">· hidden by moderators</span>}</p>
                  {r.comment && <p className="mt-2 text-sm">{r.comment}</p>}
                  {r.seller_reply && <p className="mt-2 rounded-lg bg-sand p-2 text-sm"><strong>Shop replied:</strong> {r.seller_reply}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
