import { useState } from "react";
import LocationPicker from "./LocationPicker";
import ImageUploader from "./ImageUploader";
import TagPicker from "./TagPicker";
import { SHOP_KINDS } from "../../lib/config";
import type { Address } from "../../lib/geo";
import type { TagRef } from "../../lib/types";

export type ShopValues = {
  name: string;
  kind: string;
  owner_name: string;
  phone: string;
  whatsapp: string;
  email: string;
  tagline: string;
  description: string;
  hours: string;
  established_year: string;
  website: string;
  instagram: string;
  address_line: string;
  landmark: string;
  locality: string;
  city: string;
  district: string;
  state: string;
  postal_code: string;
  country: string;
  country_code: string;
  lat: number | null;
  lng: number | null;
  photos: string[];
  tags: TagRef[];
};

export const emptyShop = (): ShopValues => ({
  name: "", kind: "shop", owner_name: "", phone: "", whatsapp: "", email: "", tagline: "", description: "",
  hours: "", established_year: "", website: "", instagram: "", address_line: "", landmark: "", locality: "",
  city: "", district: "", state: "", postal_code: "", country: "India", country_code: "IN", lat: null, lng: null,
  photos: [], tags: [],
});

export function shopToValues(s: Record<string, unknown>, tags: TagRef[]): ShopValues {
  const v = emptyShop();
  for (const k of Object.keys(v) as (keyof ShopValues)[]) {
    if (k === "tags") continue;
    const x = s[k];
    if (x != null) (v as Record<string, unknown>)[k] = typeof v[k] === "string" ? String(x) : x;
  }
  v.tags = tags;
  return v;
}

export function valuesToPayload(v: ShopValues) {
  const { tags, ...rest } = v;
  return { ...rest, whatsapp: rest.whatsapp || rest.phone, tag_ids: tags.map((t) => t.id) };
}

export function Section({ n, title, children, note }: { n: number; title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="flex items-center gap-3 text-xl">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-700 font-sans text-sm font-bold text-white">{n}</span>
        {title}
      </h2>
      {note && <p className="mt-2 rounded-lg bg-zari-100 px-3 py-2 text-xs text-zari-700">{note}</p>}
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

const HOURS = ["Mon–Sat 10 AM – 9 PM", "All days 9 AM – 9 PM", "Mon–Sun 10 AM – 8:30 PM, Tue closed", "By appointment"];

type Props = {
  initial: ShopValues;
  maxPhotos: number;
  submitLabel: string;
  onSubmit: (v: ShopValues) => Promise<void>;
  /** Approved shops: name, type and location changes need admin review. */
  liveShop?: boolean;
};

export default function ShopForm({ initial, maxPhotos, submitLabel, onSubmit, liveShop }: Props) {
  const [v, setV] = useState<ShopValues>(initial);
  const [sameWa, setSameWa] = useState(!initial.whatsapp || initial.whatsapp === initial.phone);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof ShopValues>(k: K, val: ShopValues[K]) => setV((p) => ({ ...p, [k]: val }));

  function fillAddress(a: Address) {
    setV((p) => ({
      ...p,
      // Only fill what the seller hasn't typed yet, except city/state/country which follow the pin.
      address_line: p.address_line || a.address_line || "",
      locality: a.locality ?? p.locality,
      city: a.city ?? p.city,
      district: a.district ?? p.district,
      state: a.state ?? p.state,
      country: a.country ?? p.country,
      country_code: a.country_code ?? p.country_code,
      postal_code: a.postal_code ?? p.postal_code,
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (v.lat == null || v.lng == null) return setErr("Please drop the pin on your shop's location (step 2).");
    if (!v.city.trim()) return setErr("Please enter the city or town.");
    setBusy(true);
    try {
      await onSubmit({ ...v, whatsapp: sameWa ? v.phone : v.whatsapp });
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Section n={1} title="Your business" note={liveShop ? "Changing the shop name or business type sends it to our team for a quick check. Everything else updates instantly." : undefined}>
        <div>
          <label className="label" htmlFor="f-name">Shop / business name *</label>
          <input id="f-name" className="input" required minLength={2} maxLength={120} value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Sri Lakshmi Silk House" />
        </div>
        <fieldset>
          <legend className="label">What best describes you? *</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SHOP_KINDS.map((k) => (
              <label key={k.value} className={`cursor-pointer rounded-xl border px-3 py-2 text-sm ${v.kind === k.value ? "border-brand-700 bg-brand-50 font-semibold" : "border-line bg-white"}`}>
                <input type="radio" name="kind" value={k.value} checked={v.kind === k.value} onChange={() => set("kind", k.value)} className="sr-only" />
                {k.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="f-phone">Phone for customers *</label>
            <input id="f-phone" className="input" required inputMode="tel" pattern="\+?[0-9 ()\-]{6,20}" value={v.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+91 98480 12345" />
            <label className="mt-1.5 flex items-center gap-2 text-xs">
              <input type="checkbox" checked={sameWa} onChange={(e) => setSameWa(e.target.checked)} /> Same number on WhatsApp
            </label>
          </div>
          {!sameWa && (
            <div>
              <label className="label" htmlFor="f-wa">WhatsApp number</label>
              <input id="f-wa" className="input" inputMode="tel" value={v.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} />
            </div>
          )}
          <div>
            <label className="label" htmlFor="f-owner">Owner / contact person</label>
            <input id="f-owner" className="input" maxLength={120} value={v.owner_name} onChange={(e) => set("owner_name", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="f-email">Business email</label>
            <input id="f-email" type="email" className="input" maxLength={160} value={v.email} onChange={(e) => set("email", e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="f-tagline">One-line intro</label>
          <input id="f-tagline" className="input" maxLength={160} value={v.tagline} onChange={(e) => set("tagline", e.target.value)} placeholder="Pure Dharmavaram pattu direct from our looms since 1985" />
        </div>
        <div>
          <label className="label" htmlFor="f-desc">About your shop</label>
          <textarea id="f-desc" className="input min-h-28" maxLength={3000} value={v.description} onChange={(e) => set("description", e.target.value)} placeholder="What you sell, price range, wholesale/retail, custom orders, languages spoken…" />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="f-hours">Timings</label>
            <input id="f-hours" className="input" list="hours-presets" maxLength={200} value={v.hours} onChange={(e) => set("hours", e.target.value)} placeholder="Mon–Sat 10 AM – 9 PM" />
            <datalist id="hours-presets">{HOURS.map((h) => <option key={h} value={h} />)}</datalist>
          </div>
          <div>
            <label className="label" htmlFor="f-year">Since (year)</label>
            <input id="f-year" className="input" inputMode="numeric" pattern="(18|19|20)[0-9]{2}" value={v.established_year} onChange={(e) => set("established_year", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="f-web">Website</label>
            <input id="f-web" className="input" maxLength={300} value={v.website} onChange={(e) => set("website", e.target.value)} placeholder="www.yourshop.in" />
          </div>
          <div>
            <label className="label" htmlFor="f-ig">Instagram</label>
            <input id="f-ig" className="input" maxLength={120} value={v.instagram} onChange={(e) => set("instagram", e.target.value)} placeholder="@yourshop" />
          </div>
        </div>
      </Section>

      <Section n={2} title="Shop location" note={liveShop ? "Small pin corrections (under 300 m) apply instantly. Bigger moves are checked by our team first." : "Buyers use this pin for directions, so place it on your entrance."}>
        <LocationPicker
          value={v.lat != null && v.lng != null ? { lat: v.lat, lng: v.lng } : null}
          onChange={(p) => setV((x) => ({ ...x, lat: p.lat, lng: p.lng }))}
          onAddress={fillAddress}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="f-addr">Door no., building, street</label>
            <input id="f-addr" className="input" maxLength={300} value={v.address_line} onChange={(e) => set("address_line", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="f-land">Landmark</label>
            <input id="f-land" className="input" maxLength={160} value={v.landmark} onChange={(e) => set("landmark", e.target.value)} placeholder="Opp. bus stand" />
          </div>
          <div>
            <label className="label" htmlFor="f-loc">Area / locality</label>
            <input id="f-loc" className="input" maxLength={120} value={v.locality} onChange={(e) => set("locality", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="f-city">City / town / village *</label>
            <input id="f-city" className="input" required maxLength={120} value={v.city} onChange={(e) => set("city", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="f-dist">District</label>
            <input id="f-dist" className="input" maxLength={120} value={v.district} onChange={(e) => set("district", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="f-state">State / region</label>
            <input id="f-state" className="input" maxLength={120} value={v.state} onChange={(e) => set("state", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="f-pin">PIN / postal code</label>
            <input id="f-pin" className="input" maxLength={20} value={v.postal_code} onChange={(e) => set("postal_code", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="f-country">Country</label>
            <input id="f-country" className="input" maxLength={60} value={v.country} onChange={(e) => set("country", e.target.value)} />
          </div>
        </div>
      </Section>

      <Section n={3} title="Photos & specialities">
        <ImageUploader
          label="Shop photos"
          hint="Front of the shop first (it becomes the cover), then inside and best collections. Photos are compressed automatically."
          value={v.photos}
          onChange={(p) => set("photos", p)}
          max={maxPhotos}
          folder="shops"
        />
        <TagPicker
          label="What do you specialise in?"
          hint="Buyers filter the map by these. Pick from the list or add your own."
          value={v.tags}
          onChange={(t) => set("tags", t)}
          max={20}
        />
      </Section>

      {err && <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800" role="alert">{err}</p>}
      <div className="sticky bottom-0 z-10 -mx-4 border-t border-line bg-cream/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <button className="btn-primary w-full !py-3 text-base sm:w-auto sm:px-8" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
