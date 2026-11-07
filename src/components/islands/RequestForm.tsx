import { useEffect, useState } from "react";
import ImageUploader from "./ImageUploader";
import TagPicker from "./TagPicker";
import PlaceField, { type PlaceValue } from "./PlaceField";
import BuyerPlans from "./BuyerPlans";
import { rpc, supabase } from "../../lib/supabase";
import { loadMe, requireSession } from "../../lib/session";
import { flushNotifications } from "../../lib/checkout";
import { SAREE_COLORS } from "../../lib/config";
import type { BuyerStatus, Me, TagRef } from "../../lib/types";

const RADII = [
  { km: 10, label: "Within 10 km" },
  { km: 25, label: "Within 25 km" },
  { km: 50, label: "Within 50 km" },
  { km: 150, label: "Within 150 km" },
  { km: 500, label: "My state / region (500 km)" },
  { km: 0, label: "Anywhere — weavers can ship" },
];
const BUDGETS = [
  { label: "Under ₹3k", min: "", max: "3000" },
  { label: "₹3k–8k", min: "3000", max: "8000" },
  { label: "₹8k–20k", min: "8000", max: "20000" },
  { label: "₹20k–50k", min: "20000", max: "50000" },
  { label: "₹50k+", min: "50000", max: "" },
];

export default function RequestForm() {
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<BuyerStatus | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [tags, setTags] = useState<TagRef[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [place, setPlace] = useState<PlaceValue | null>(null);
  const [f, setF] = useState({ title: "", description: "", min: "", max: "", needed_by: "", quantity: "1", radius: "50" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paidMsg, setPaidMsg] = useState<string | null>(null);

  useEffect(() => {
    requireSession().then(async (s) => {
      if (!s) return;
      const [m, st] = await Promise.all([loadMe(), rpc<BuyerStatus>(supabase(), "my_buyer_status")]);
      setMe(m);
      setStatus(st);
    });
  }, []);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((o) => ({ ...o, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!place) return setErr("Choose your area so we can find sellers near you.");
    setBusy(true);
    try {
      const r = await rpc<{ id: string }>(supabase(), "create_request", {
        p: {
          title: f.title, description: f.description, min_price: f.min, max_price: f.max,
          needed_by: f.needed_by, quantity: f.quantity, radius_km: f.radius === "0" ? "" : f.radius,
          colors, images, tag_ids: tags.map((t) => t.id),
          city: place.city, state: place.state, country: place.country, lat: place.lat, lng: place.lng,
        },
      });
      flushNotifications();
      setTimeout(() => (location.href = `/account/requests?id=${r.id}&sent=1`), 150);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't send your request.");
      setBusy(false);
      if (e instanceof Error && /Choose a plan/.test(e.message)) {
        setStatus(await rpc<BuyerStatus>(supabase(), "my_buyer_status"));
      }
    }
  }

  if (!me || !status) return <div className="h-64 animate-pulse rounded-2xl bg-sand" />;

  const outOfQuota = status.quota != null && (status.remaining ?? 0) <= 0;
  if (outOfQuota)
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-zari-300 bg-zari-100 p-4 text-sm">
          <p className="font-semibold text-zari-700">You've used your {status.plan_name} allowance</p>
          <p className="mt-1">
            {status.plan_code === "buyer_free"
              ? "The free plan includes one custom request every 30 days. Pick a pass to send more — sellers reply with photos and prices."
              : "Pick a plan to keep sending requests."}{" "}
            <a className="underline" href="/account/requests">See your requests and replies</a>.
          </p>
        </div>
        <BuyerPlans me={me} status={status} onPaid={(st, m) => { setStatus(st); setPaidMsg(m); }} />
      </div>
    );

  const today = new Date().toISOString().slice(0, 10);
  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {paidMsg && <p className="rounded-xl bg-leaf-50 p-3 text-sm font-semibold text-leaf" role="status">{paidMsg} Now describe your saree below.</p>}
      <p className="rounded-xl border border-line bg-white px-4 py-3 text-sm" data-testid="quota">
        <strong>{status.plan_name}</strong> plan ·{" "}
        {status.quota == null ? "unlimited requests" : `${status.remaining} of ${status.quota} request${status.quota === 1 ? "" : "s"} left`}
        {" · "}<a className="underline" href="/account/requests">My requests</a>
      </p>

      <section className="card space-y-4 p-4 sm:p-5">
        <h2 className="text-xl">What are you looking for?</h2>
        <div>
          <label className="label" htmlFor="rq-title">In a few words *</label>
          <input id="rq-title" className="input" required maxLength={120} value={f.title} onChange={set("title")}
                 placeholder="e.g. Maroon Kanchi pattu with gold zari border for wedding" />
        </div>
        <ImageUploader value={images} onChange={setImages} max={4} folder="requests" label="Reference photos"
                       hint="Screenshots, Instagram saves or a photo of a saree you like — up to 4." />
        <TagPicker value={tags} onChange={setTags} max={10} label="Saree type" hint="Fabric, weave, work, occasion — pick what matters." />
        <div>
          <span className="label">Colours</span>
          <div className="flex flex-wrap gap-1.5">
            {SAREE_COLORS.map((c) => {
              const on = colors.includes(c);
              return (
                <button type="button" key={c} aria-pressed={on} className={`chip ${on ? "chip-active" : ""}`}
                        onClick={() => setColors((o) => (on ? o.filter((x) => x !== c) : o.length < 6 ? [...o, c] : o))}>
                  {c}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="rq-desc">Details for the seller</label>
          <textarea id="rq-desc" className="input min-h-28" maxLength={2000} value={f.description} onChange={set("description")}
                    placeholder="Border width, blouse, pallu design, weight, occasion… anything that helps." />
        </div>
      </section>

      <section className="card space-y-4 p-4 sm:p-5">
        <h2 className="text-xl">Budget & timing</h2>
        <div className="flex flex-wrap gap-1.5">
          {BUDGETS.map((b) => {
            const on = f.min === b.min && f.max === b.max;
            return (
              <button type="button" key={b.label} aria-pressed={on} className={`chip ${on ? "chip-active" : ""}`}
                      onClick={() => setF((o) => ({ ...o, min: b.min, max: b.max }))}>
                {b.label}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="rq-min">Min price (₹)</label>
            <input id="rq-min" className="input" inputMode="numeric" value={f.min} onChange={(e) => setF((o) => ({ ...o, min: e.target.value.replace(/\D/g, "") }))} />
          </div>
          <div>
            <label className="label" htmlFor="rq-max">Max price (₹)</label>
            <input id="rq-max" className="input" inputMode="numeric" value={f.max} onChange={(e) => setF((o) => ({ ...o, max: e.target.value.replace(/\D/g, "") }))} />
          </div>
          <div>
            <label className="label" htmlFor="rq-date">Needed by</label>
            <input id="rq-date" type="date" className="input" min={today} value={f.needed_by} onChange={set("needed_by")} />
          </div>
          <div>
            <label className="label" htmlFor="rq-qty">Quantity</label>
            <input id="rq-qty" type="number" min={1} max={500} className="input" value={f.quantity} onChange={set("quantity")} />
          </div>
        </div>
      </section>

      <section className="card space-y-4 p-4 sm:p-5">
        <h2 className="text-xl">Where should sellers be?</h2>
        <PlaceField id="rq-place" value={place} onChange={setPlace} />
        <div>
          <label className="label" htmlFor="rq-radius">Send to sellers</label>
          <select id="rq-radius" className="input" value={f.radius} onChange={set("radius")}>
            {RADII.map((r) => <option key={r.km} value={r.km}>{r.label}</option>)}
          </select>
        </div>
        <p className="text-xs text-muted">
          Your request goes only to verified shops and weavers in this area whose plan includes custom requests.
          Your phone number and email are never shared — you contact the sellers you like from their replies.
        </p>
      </section>

      {err && <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800" role="alert">{err}</p>}
      <div className="sticky bottom-0 z-10 -mx-3 border-t border-line bg-cream/95 px-3 py-3 backdrop-blur min-[380px]:-mx-4 min-[380px]:px-4 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <button className="btn-primary w-full sm:w-auto" disabled={busy}>{busy ? "Sending…" : "Send request to sellers"}</button>
      </div>
    </form>
  );
}
