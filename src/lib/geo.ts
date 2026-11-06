import { PUBLIC_GEOCODER_URL } from "astro:env/client";

// Photon (OpenStreetMap data) — free, supports search-as-you-type, worldwide.
export type Place = {
  id: string;
  label: string;
  sub: string;
  lat: number;
  lng: number;
  bbox?: [number, number, number, number];
  address: Address;
};
export type Address = {
  address_line?: string;
  locality?: string;
  city?: string;
  district?: string;
  state?: string;
  country?: string;
  country_code?: string;
  postal_code?: string;
};

type Feature = {
  geometry: { coordinates: [number, number] };
  properties: Record<string, string | number | number[] | undefined> & { extent?: number[] };
};

function toAddress(p: Feature["properties"]): Address {
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : undefined);
  const street = [s("housenumber"), s("street")].filter(Boolean).join(" ");
  const isPlace = ["city", "town", "village", "hamlet", "suburb", "neighbourhood", "locality"].includes(s("osm_value") ?? "");
  return {
    address_line: [s("type") === "house" || !isPlace ? s("name") : undefined, street].filter(Boolean).join(", ") || undefined,
    locality: s("district") ?? s("locality") ?? (s("osm_value") === "suburb" ? s("name") : undefined),
    city: s("city") ?? (isPlace ? s("name") : undefined) ?? s("county"),
    district: s("county"),
    state: s("state"),
    country: s("country"),
    country_code: s("countrycode")?.toUpperCase(),
    postal_code: s("postcode"),
  };
}

function toPlace(f: Feature, i: number): Place {
  const p = f.properties;
  const a = toAddress(p);
  const name = (p.name as string) ?? a.address_line ?? a.city ?? "Unnamed place";
  const sub = [a.locality, a.city !== name ? a.city : undefined, a.state, a.country].filter(Boolean).join(", ");
  const e = p.extent;
  return {
    id: `${p.osm_type ?? ""}${p.osm_id ?? i}`,
    label: name,
    sub,
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    bbox: Array.isArray(e) && e.length === 4 ? [e[0], e[3], e[2], e[1]] : undefined,
    address: a,
  };
}

export async function searchPlaces(q: string, near?: { lat: number; lng: number }, signal?: AbortSignal): Promise<Place[]> {
  if (q.trim().length < 3) return [];
  const u = new URL(`${PUBLIC_GEOCODER_URL.replace(/\/$/, "")}/api`);
  u.searchParams.set("q", q.trim());
  u.searchParams.set("limit", "6");
  u.searchParams.set("lang", "en");
  if (near) {
    u.searchParams.set("lat", near.lat.toFixed(3));
    u.searchParams.set("lon", near.lng.toFixed(3));
  }
  const r = await fetch(u, { signal });
  if (!r.ok) throw new Error("Place search is unavailable right now.");
  const j = (await r.json()) as { features: Feature[] };
  return j.features.map(toPlace);
}

export async function reverseGeocode(lat: number, lng: number, signal?: AbortSignal): Promise<Address | null> {
  const u = new URL(`${PUBLIC_GEOCODER_URL.replace(/\/$/, "")}/reverse`);
  u.searchParams.set("lat", String(lat));
  u.searchParams.set("lon", String(lng));
  u.searchParams.set("lang", "en");
  const r = await fetch(u, { signal });
  if (!r.ok) return null;
  const j = (await r.json()) as { features: Feature[] };
  return j.features[0] ? toAddress(j.features[0].properties) : null;
}

export function currentPosition(timeout = 12000): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("Location is not available on this device."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) =>
        reject(
          new Error(
            e.code === e.PERMISSION_DENIED
              ? "Location permission is blocked. Allow it in your browser settings, or search for your area."
              : "Couldn't get your location. Try again or search for your area.",
          ),
        ),
      { enableHighAccuracy: true, timeout, maximumAge: 60000 },
    );
  });
}

export async function locationAlreadyAllowed(): Promise<boolean> {
  try {
    const p = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    return p?.state === "granted";
  } catch {
    return false;
  }
}
