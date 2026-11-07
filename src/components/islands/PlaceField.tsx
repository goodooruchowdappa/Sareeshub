import { useEffect, useRef, useState } from "react";
import { currentPosition, reverseGeocode, searchPlaces, type Place } from "../../lib/geo";

export type PlaceValue = { lat: number; lng: number; city: string; state?: string; country?: string; label: string };

/** Pick an area: "use my current location" or search a city/area (Zepto-style), no map needed. */
export default function PlaceField({ value, onChange, id = "place" }: { value: PlaceValue | null; onChange: (v: PlaceValue) => void; id?: string }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const ab = useRef<AbortController | null>(null);

  useEffect(() => {
    if (q.trim().length < 3) {
      setItems([]);
      return;
    }
    const t = setTimeout(async () => {
      ab.current?.abort();
      ab.current = new AbortController();
      try {
        setItems(await searchPlaces(q, undefined, ab.current.signal));
        setOpen(true);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setMsg("Place search is unavailable right now. Try your current location.");
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  async function locate() {
    setMsg(null);
    setBusy(true);
    try {
      const p = await currentPosition();
      const a = await reverseGeocode(p.lat, p.lng).catch(() => null);
      const city = a?.city ?? a?.district ?? a?.locality ?? "Current location";
      onChange({ lat: +p.lat.toFixed(5), lng: +p.lng.toFixed(5), city, state: a?.state, country: a?.country,
                 label: [a?.locality, city, a?.state].filter(Boolean).join(", ") });
      setQ("");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't get your location.");
    } finally {
      setBusy(false);
    }
  }

  function pick(p: Place) {
    const city = p.address.city ?? p.label;
    onChange({ lat: +p.lat.toFixed(5), lng: +p.lng.toFixed(5), city, state: p.address.state, country: p.address.country,
               label: [p.label, p.sub].filter(Boolean).join(", ") });
    setQ("");
    setOpen(false);
  }

  return (
    <div className="space-y-2">
      {value && (
        <div className="flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
          <span aria-hidden>📍</span>
          <span className="min-w-0 flex-1 truncate font-medium text-brand-800" data-testid="place-label">{value.label}</span>
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" className="btn-outline shrink-0" onClick={locate} disabled={busy}>
          {busy ? "Finding you…" : "📍 Use my current location"}
        </button>
        <div className="relative min-w-0 flex-1">
          <input
            id={id}
            className="input"
            placeholder={value ? "Change area — search city or locality" : "Or search your city / area"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => items.length && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            role="combobox"
            aria-expanded={open}
            aria-controls={`${id}-list`}
            autoComplete="off"
          />
          {open && items.length > 0 && (
            <ul id={`${id}-list`} role="listbox" className="card absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-auto p-1 text-sm">
              {items.map((p) => (
                <li key={p.id} role="option" aria-selected={false}>
                  <button type="button" className="block w-full rounded-lg px-3 py-2 text-left hover:bg-sand" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)}>
                    <span className="font-medium">{p.label}</span>
                    {p.sub && <span className="block truncate text-xs text-muted">{p.sub}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {msg && <p className="text-xs text-brand-800" role="alert">{msg}</p>}
    </div>
  );
}
