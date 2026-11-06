import { PUBLIC_SUPABASE_URL, PUBLIC_SITE_URL } from "astro:env/client";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
export const rupees = (n: number | null | undefined) => (n == null ? "Price on request" : inr.format(n));
export const paise = (n: number | null | undefined) => inr.format((n ?? 0) / 100);

export const discountPct = (price?: number | null, mrp?: number | null) =>
  price && mrp && mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0;

/** Public URL for a file in the "media" bucket. size "thumb" uses the 480px variant created at upload. */
export function mediaUrl(path: string | null | undefined, size: "full" | "thumb" = "full"): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  const p = size === "thumb" && /\.(webp|jpg)$/.test(path) && !path.startsWith("seed/") ? path.replace(/\.(webp|jpg)$/, "_t.$1") : path;
  return `${PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/${p}`;
}

export const absoluteUrl = (path: string) => new URL(path, PUBLIC_SITE_URL).toString();

export const digits = (phone: string | null | undefined) => (phone ?? "").replace(/[^\d+]/g, "");

/** WhatsApp needs the full international number without "+". Indian 10-digit numbers get 91 added. */
export function waNumber(phone: string | null | undefined, countryCode = "IN") {
  let d = (phone ?? "").replace(/\D/g, "");
  if (countryCode === "IN") {
    if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
    if (d.length === 10) d = `91${d}`;
  }
  return d;
}

export const whatsappLink = (phone: string | null | undefined, text: string, countryCode = "IN") =>
  `https://wa.me/${waNumber(phone, countryCode)}?text=${encodeURIComponent(text)}`;

export const telLink = (phone: string | null | undefined) => `tel:${digits(phone)}`;

export const directionsLink = (lat: number, lng: number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

export const formatKm = (km: number | null | undefined) =>
  km == null ? "" : km < 1 ? `${Math.round(km * 1000)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;

export const placeLine = (s: { locality?: string | null; city?: string | null; state?: string | null }) =>
  [s.locality, s.city, s.state].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ");

export const truncate = (s: string | null | undefined, n: number) =>
  !s ? "" : s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;

export const dateIN = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
