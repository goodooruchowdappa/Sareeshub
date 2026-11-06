import { useEffect, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { attachResize, INDIA_CENTER, loadMapLibre, MAP_STYLE } from "../../lib/map";
import { currentPosition, reverseGeocode, searchPlaces, type Address, type Place } from "../../lib/geo";

type Props = {
  value: { lat: number; lng: number } | null;
  onChange: (pos: { lat: number; lng: number }) => void;
  /** Called with the address found under the pin, so the form can pre-fill city/area. */
  onAddress?: (a: Address) => void;
};

/**
 * Zepto/Swiggy-style picker: the pin stays in the middle and the seller moves the map
 * under it. They can search an area, use their current location, or drag freely.
 */
export default function LocationPicker({ value, onChange, onAddress }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [moving, setMoving] = useState(false);
  const [found, setFound] = useState<string>("");
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [locating, setLocating] = useState(false);
  const cb = useRef({ onChange, onAddress });
  cb.current = { onChange, onAddress };
  const geoAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    let off = () => {};
    let dead = false;
    loadMapLibre().then((ml) => {
      if (dead || !el.current) return;
      const m = new ml.Map({
        container: el.current,
        style: MAP_STYLE,
        center: value ? [value.lng, value.lat] : INDIA_CENTER,
        zoom: value ? 17 : 4,
        attributionControl: { compact: true },
      });
      map.current = m;
      m.addControl(new ml.NavigationControl({ showCompass: false }), "bottom-right");
      off = attachResize(m, el.current);
      m.on("movestart", () => setMoving(true));
      let t: ReturnType<typeof setTimeout>;
      m.on("moveend", () => {
        setMoving(false);
        if (m.getZoom() < 12) {
          setFound("");
          return; // too far out to be a real shop location
        }
        const c = m.getCenter();
        cb.current.onChange({ lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6) });
        clearTimeout(t);
        t = setTimeout(async () => {
          geoAbort.current?.abort();
          geoAbort.current = new AbortController();
          try {
            const a = await reverseGeocode(c.lat, c.lng, geoAbort.current.signal);
            if (a) {
              setFound([a.address_line, a.locality, a.city, a.state, a.country].filter(Boolean).join(", "));
              cb.current.onAddress?.(a);
            }
          } catch {
            /* offline or aborted — the seller can type the address */
          }
        }, 600);
      });
    });
    return () => {
      dead = true;
      off();
      map.current?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (q.trim().length < 3) return setPlaces([]);
    const ctl = new AbortController();
    const t = setTimeout(() => {
      const c = map.current?.getCenter();
      searchPlaces(q, c ? { lat: c.lat, lng: c.lng } : undefined, ctl.signal).then(setPlaces).catch(() => setPlaces([]));
    }, 350);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  async function useMyLocation() {
    setMsg(null);
    setLocating(true);
    try {
      const p = await currentPosition(15000);
      map.current?.flyTo({ center: [p.lng, p.lat], zoom: 18, essential: true, maxDuration: 2000 });
      if (p.accuracy > 100) setMsg(`Location is approximate (±${Math.round(p.accuracy)} m). Move the map so the pin sits on your shop.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't get your location.");
    } finally {
      setLocating(false);
    }
  }

  function pick(p: Place) {
    setQ("");
    setPlaces([]);
    map.current?.flyTo({ center: [p.lng, p.lat], zoom: p.bbox ? 15 : 17, essential: true, maxDuration: 2000 });
  }

  const pinned = value && (map.current ? map.current.getZoom() >= 12 : true);

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white">
      <div className="flex flex-col gap-2 border-b border-line p-3 sm:flex-row">
        <div className="relative flex-1">
          <input
            className="input"
            placeholder="Search your area, street or landmark"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search location"
          />
          {places.length > 0 && (
            <ul className="card absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto p-1 text-sm">
              {places.map((p, i) => (
                <li key={p.id + i}>
                  <button type="button" className="w-full rounded-lg px-3 py-2 text-left hover:bg-sand" onClick={() => pick(p)}>
                    <span className="block font-medium">{p.label}</span>
                    <span className="block truncate text-xs text-muted">{p.sub}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="button" onClick={useMyLocation} disabled={locating} className="btn-gold shrink-0">
          {locating ? "Locating…" : "📍 Use my current location"}
        </button>
      </div>
      <div className="relative h-80 sm:h-96">
        <div ref={el} className="h-full w-full" />
        {/* Fixed centre pin */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-full">
          <div className={`transition-transform ${moving ? "-translate-y-2" : ""}`}>
            <svg width="40" height="52" viewBox="0 0 30 40" aria-hidden="true">
              <path d="M15 1C7.3 1 1 7.2 1 14.9 1 25.4 15 39 15 39s14-13.6 14-24.1C29 7.2 22.7 1 15 1z" fill="#2f4938" stroke="#fff" strokeWidth="2" />
              <circle cx="15" cy="15" r="5.5" fill="#b0792a" />
            </svg>
          </div>
          <div className="mx-auto h-1.5 w-3 rounded-full bg-black/30" />
        </div>
        <div className="pointer-events-none absolute inset-x-3 top-3 z-10 text-center">
          <span className="inline-block rounded-full bg-ink/85 px-3 py-1 text-xs font-medium text-white shadow">
            {pinned ? "Move the map to put the pin exactly on your shop" : "Search your area or use your location, then zoom in"}
          </span>
        </div>
      </div>
      <div className="space-y-1 p-3 text-sm">
        {value ? (
          <p>
            <span className="font-semibold text-leaf">✓ Pin set</span>
            <span className="ml-2 text-xs text-muted">
              {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
            </span>
          </p>
        ) : (
          <p className="text-brand-700">No pin yet — zoom in to street level to set it.</p>
        )}
        {found && <p className="text-xs text-muted">Near: {found}</p>}
        {msg && <p className="text-xs text-zari-700">{msg}</p>}
      </div>
    </div>
  );
}
