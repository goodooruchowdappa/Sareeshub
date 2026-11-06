import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as MLMap, Popup } from "maplibre-gl";
import { attachResize, INDIA_CENTER, loadMapLibre, MAP_STYLE } from "../../lib/map";
import { rpc, supabase } from "../../lib/supabase";
import { currentPosition, locationAlreadyAllowed, searchPlaces, type Place } from "../../lib/geo";
import { SHOP_KINDS, kindLabel } from "../../lib/config";
import { directionsLink, formatKm, mediaUrl, placeLine, telLink, whatsappLink } from "../../lib/format";
import { trackShop } from "../../lib/track";
import type { ShopCard, TagRef } from "../../lib/types";

type Filters = { q: string; kind: string; tag: string };
const LAST_VIEW = "sh:map:view";

function readUrl() {
  const sp = new URLSearchParams(window.location.search);
  const n = (k: string) => {
    const v = sp.get(k);
    return v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined;
  };
  return {
    filters: { q: sp.get("q") ?? "", kind: sp.get("kind") ?? "", tag: sp.get("tag") ?? "" },
    lat: n("lat"),
    lng: n("lng"),
    z: n("z"),
    near: sp.get("near") === "1",
  };
}

export default function MapExplorer() {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const mlRef = useRef<typeof import("maplibre-gl") | null>(null);
  const reqId = useRef(0);
  const init = useMemo(() => (typeof window === "undefined" ? null : readUrl()), []);

  const [filters, setFilters] = useState<Filters>(init?.filters ?? { q: "", kind: "", tag: "" });
  const [shops, setShops] = useState<ShopCard[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tags, setTags] = useState<TagRef[]>([]);
  const [sheet, setSheet] = useState<"list" | "map">("map");
  const [locMsg, setLocMsg] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);

  // Popular tags for the filter
  useEffect(() => {
    rpc<TagRef[]>(supabase(), "list_tags")
      .then((t) => setTags(t.filter((x) => x.is_default || (x.count ?? 0) > 0)))
      .catch(() => {});
  }, []);

  // ── Load shops for the visible area ─────────────────────────────
  const fetchShops = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    const c = map.getCenter();
    const origin = me ?? { lat: c.lat, lng: c.lng };
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await rpc<{ total: number; items: ShopCard[] }>(supabase(), "search_shops", {
        p_q: filters.q || null,
        p_kind: filters.kind || null,
        p_tag: filters.tag || null,
        p_lat: origin.lat,
        p_lng: origin.lng,
        p_min_lat: b.getSouth(),
        p_max_lat: b.getNorth(),
        p_min_lng: b.getWest(),
        p_max_lng: b.getEast(),
        p_limit: 300,
      });
      if (id !== reqId.current) return;
      setShops(res.items);
      setTotal(res.total);
      const src = map.getSource("shops") as GeoJSONSource | undefined;
      src?.setData({
        type: "FeatureCollection",
        features: res.items.map((s) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [s.lng, s.lat] },
          properties: { id: s.id, name: s.name, featured: s.featured ? 1 : 0 },
        })),
      });
    } catch (e) {
      if (id === reqId.current) setError(e instanceof Error ? e.message : "Could not load shops.");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [filters, me]);

  const fetchRef = useRef(fetchShops);
  fetchRef.current = fetchShops;

  // ── Keep the URL shareable ──────────────────────────────────────
  const syncUrl = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    const sp = new URLSearchParams();
    if (filters.q) sp.set("q", filters.q);
    if (filters.kind) sp.set("kind", filters.kind);
    if (filters.tag) sp.set("tag", filters.tag);
    sp.set("lat", c.lat.toFixed(4));
    sp.set("lng", c.lng.toFixed(4));
    sp.set("z", map.getZoom().toFixed(1));
    history.replaceState(null, "", `/map?${sp}`);
    try {
      localStorage.setItem(LAST_VIEW, JSON.stringify({ lat: c.lat, lng: c.lng, z: map.getZoom() }));
    } catch {
      /* ignore */
    }
  }, [filters]);
  const syncRef = useRef(syncUrl);
  syncRef.current = syncUrl;

  // ── Create the map once ─────────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    let off = () => {};
    (async () => {
      const ml = await loadMapLibre();
      if (disposed || !mapEl.current) return;
      mlRef.current = ml;
      let center: [number, number] = INDIA_CENTER;
      let zoom = 4.2;
      if (init?.lat != null && init.lng != null) {
        center = [init.lng, init.lat];
        zoom = init.z ?? 12;
      } else {
        try {
          const v = JSON.parse(localStorage.getItem(LAST_VIEW) ?? "null");
          if (v && !init?.near) {
            center = [v.lng, v.lat];
            zoom = v.z;
          }
        } catch {
          /* ignore */
        }
      }
      const map = new ml.Map({ container: mapEl.current, style: MAP_STYLE, center, zoom, attributionControl: { compact: true } });
      mapRef.current = map;
      map.addControl(new ml.NavigationControl({ showCompass: false }), "bottom-right");
      off = attachResize(map, mapEl.current);

      // If the map style can't load (offline, tile service down), keep the list working.
      let loaded = false;
      const fallback = () => {
        if (loaded) return;
        setTilesFailed(true);
        setMapReady(true);
        fetchRef.current();
      };
      map.on("error", (e) => {
        if (!loaded && /style|Failed to fetch|NetworkError/i.test(String(e.error?.message ?? ""))) fallback();
      });
      setTimeout(fallback, 10000);
      map.on("moveend", () => {
        if (loaded) return;
        fetchRef.current();
        syncRef.current();
      });

      map.on("load", () => {
        loaded = true;
        setTilesFailed(false);
        map.addSource("shops", { type: "geojson", data: { type: "FeatureCollection", features: [] }, cluster: true, clusterRadius: 46, clusterMaxZoom: 13 });
        map.addLayer({
          id: "clusters",
          type: "circle",
          source: "shops",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": "#2f4938",
            "circle-opacity": 0.9,
            "circle-radius": ["step", ["get", "point_count"], 18, 10, 24, 50, 32],
            "circle-stroke-width": 3,
            "circle-stroke-color": "#e6b374",
          },
        });
        map.addLayer({
          id: "cluster-count",
          type: "symbol",
          source: "shops",
          filter: ["has", "point_count"],
          layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 13, "text-font": ["Noto Sans Bold"] },
          paint: { "text-color": "#f9f5ee" },
        });
        map.addLayer({
          id: "shop-points",
          type: "circle",
          source: "shops",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": ["case", ["==", ["get", "featured"], 1], "#b0792a", "#2f4938"],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 6, 14, 10],
            "circle-stroke-width": 2.5,
            "circle-stroke-color": "#ffffff",
          },
        });
        map.addLayer({
          id: "shop-selected",
          type: "circle",
          source: "shops",
          filter: ["==", ["get", "id"], ""],
          paint: { "circle-color": "rgba(0,0,0,0)", "circle-radius": 18, "circle-stroke-width": 3, "circle-stroke-color": "#b0792a" },
        });
        map.addLayer({
          id: "shop-labels",
          type: "symbol",
          source: "shops",
          minzoom: 12.5,
          filter: ["!", ["has", "point_count"]],
          layout: { "text-field": ["get", "name"], "text-size": 12, "text-offset": [0, 1.3], "text-anchor": "top", "text-font": ["Noto Sans Bold"], "text-optional": true },
          paint: { "text-color": "#17261c", "text-halo-color": "#fff", "text-halo-width": 1.5 },
        });

        map.on("click", "clusters", async (e) => {
          const f = map.queryRenderedFeatures(e.point, { layers: ["clusters"] })[0];
          if (!f) return;
          const src = map.getSource("shops") as GeoJSONSource;
          const z = await src.getClusterExpansionZoom(f.properties!.cluster_id as number);
          map.easeTo({ center: (f.geometry as { coordinates: [number, number] }).coordinates, zoom: z + 0.3 });
        });
        map.on("click", "shop-points", (e) => {
          const id = e.features?.[0]?.properties?.id as string | undefined;
          if (id) setSelected(id);
        });
        for (const l of ["clusters", "shop-points"]) {
          map.on("mouseenter", l, () => (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", l, () => (map.getCanvas().style.cursor = ""));
        }
        let t: ReturnType<typeof setTimeout>;
        map.on("moveend", () => {
          clearTimeout(t);
          t = setTimeout(() => {
            fetchRef.current();
            syncRef.current();
          }, 300);
        });
        setMapReady(true);
        fetchRef.current();
      });

      // Start at the user's location when asked, or when they already allowed it before.
      if (init?.near || (init?.lat == null && !localStorage.getItem(LAST_VIEW) && (await locationAlreadyAllowed()))) {
        locate(map, 12.5);
      }
    })();
    return () => {
      disposed = true;
      off();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch when filters change
  useEffect(() => {
    if (mapReady) {
      fetchShops();
      syncUrl();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, me, mapReady]);

  // Highlight selection + popup
  useEffect(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!map || !ml || !map.getLayer("shop-selected")) return;
    map.setFilter("shop-selected", ["==", ["get", "id"], selected ?? ""]);
    popupRef.current?.remove();
    const s = shops.find((x) => x.id === selected);
    if (!s) return;
    const el = document.createElement("div");
    el.className = "w-60";
    el.innerHTML = popupHtml(s);
    popupRef.current = new ml.Popup({ offset: 14, maxWidth: "260px", closeButton: true })
      .setLngLat([s.lng, s.lat])
      .setDOMContent(el)
      .addTo(map);
    popupRef.current.on("close", () => setSelected((cur) => (cur === s.id ? null : cur)));
    document.getElementById(`shop-${s.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected, shops]);

  async function locate(map = mapRef.current, zoom = 13) {
    if (!map) return;
    setLocMsg("Finding your location…");
    try {
      const p = await currentPosition();
      setMe({ lat: p.lat, lng: p.lng });
      setLocMsg(null);
      map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), zoom), essential: true, maxDuration: 2000 });
      const ml = mlRef.current!;
      const dot = document.createElement("div");
      dot.className = "h-4 w-4 rounded-full border-2 border-white bg-blue-600 shadow-[0_0_0_6px_rgba(37,99,235,0.25)]";
      (map as MLMap & { _meMarker?: import("maplibre-gl").Marker })._meMarker?.remove();
      (map as MLMap & { _meMarker?: import("maplibre-gl").Marker })._meMarker = new ml.Marker({ element: dot }).setLngLat([p.lng, p.lat]).addTo(map);
    } catch (e) {
      setLocMsg(e instanceof Error ? e.message : "Couldn't get your location.");
    }
  }

  function goToPlace(p: Place) {
    const map = mapRef.current;
    if (!map) return;
    if (p.bbox) map.fitBounds([[p.bbox[0], p.bbox[1]], [p.bbox[2], p.bbox[3]]], { padding: 40, maxZoom: 14 });
    else map.flyTo({ center: [p.lng, p.lat], zoom: 13, maxDuration: 2000 });
  }

  function focusShop(s: ShopCard) {
    setSelected(s.id);
    setSheet("map");
    mapRef.current?.flyTo({ center: [s.lng, s.lat], zoom: Math.max(mapRef.current.getZoom(), 14) });
  }

  const tooMany = total > shops.length;

  return (
    <div className="absolute inset-0 flex">
      {/* List panel */}
      <aside
        className={`${sheet === "list" ? "flex" : "hidden"} absolute inset-0 z-20 flex-col bg-cream md:static md:z-auto md:flex md:w-[380px] md:shrink-0 md:border-r md:border-line`}
        aria-label="Shops in this area"
      >
        <div className="space-y-2 border-b border-line p-3">
          <SearchBox
            value={filters.q}
            near={me ?? (mapRef.current ? { lat: mapRef.current.getCenter().lat, lng: mapRef.current.getCenter().lng } : undefined)}
            onSearch={(q) => setFilters((f) => ({ ...f, q }))}
            onPlace={(p) => {
              goToPlace(p);
              setSheet("map");
            }}
          />
          <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
            <button className={`chip shrink-0 ${!filters.kind ? "chip-active" : ""}`} onClick={() => setFilters((f) => ({ ...f, kind: "" }))}>
              All
            </button>
            {SHOP_KINDS.map((k) => (
              <button
                key={k.value}
                className={`chip shrink-0 ${filters.kind === k.value ? "chip-active" : ""}`}
                onClick={() => setFilters((f) => ({ ...f, kind: f.kind === k.value ? "" : k.value }))}
              >
                {k.plural}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <select
              className="input !py-2"
              value={filters.tag}
              onChange={(e) => setFilters((f) => ({ ...f, tag: e.target.value }))}
              aria-label="Speciality"
            >
              <option value="">Any speciality</option>
              {tags.map((t) => (
                <option key={t.id} value={t.slug}>
                  {t.name}
                </option>
              ))}
            </select>
            <button className="btn-gold shrink-0 !py-2" onClick={() => locate()} title="Near me">
              📍 <span className="hidden sm:inline">Near me</span>
            </button>
          </div>
          {(filters.q || filters.kind || filters.tag) && (
            <button className="text-xs font-semibold text-brand-700 underline" onClick={() => setFilters({ q: "", kind: "", tag: "" })}>
              Clear filters
            </button>
          )}
        </div>

        <div className="flex items-center justify-between px-3 py-2 text-xs text-muted">
          <span aria-live="polite">
            {loading ? "Loading…" : `${total} ${total === 1 ? "place" : "places"} in this area`}
            {tooMany && ` · showing ${shops.length}, zoom in for more`}
          </span>
          <button className="btn-ghost !px-2 !py-1 text-xs md:hidden" onClick={() => setSheet("map")}>
            Show map
          </button>
        </div>
        {locMsg && <p className="mx-3 mb-2 rounded-lg bg-zari-100 px-3 py-2 text-xs text-zari-700">{locMsg}</p>}
        {error && <p className="mx-3 mb-2 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-800">{error}</p>}

        <ul className="flex-1 space-y-2 overflow-y-auto px-3 pb-24 md:pb-4">
          {!loading && shops.length === 0 && (
            <li className="rounded-2xl border border-dashed border-line bg-white p-5 text-center text-sm">
              <p className="font-semibold">No shops in this area yet</p>
              <p className="mt-1 text-muted">Zoom out or move the map. Know a good saree shop here? Tell them to register — it's free.</p>
              <a href="/seller/register" className="btn-outline mt-3">Register a shop</a>
            </li>
          )}
          {shops.map((s) => (
            <li key={s.id} id={`shop-${s.id}`}>
              <div
                className={`card flex gap-3 p-2.5 transition ${selected === s.id ? "border-brand-500 ring-2 ring-brand-100" : ""}`}
              >
                <button onClick={() => focusShop(s)} className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-sand" aria-label={`Show ${s.name} on map`}>
                  {s.cover ? <img src={mediaUrl(s.cover, "thumb")!} alt="" loading="lazy" className="h-full w-full object-cover" /> : <span className="border-pattern block h-full w-full opacity-70" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <a href={`/shops/${s.slug}`} className="truncate font-semibold leading-tight hover:text-brand-700">
                      {s.name}
                    </a>
                    {s.distance_km != null && <span className="shrink-0 text-xs text-muted">{formatKm(s.distance_km)}</span>}
                  </div>
                  <p className="truncate text-xs text-muted">
                    {kindLabel(s.kind)} · {placeLine(s)}
                  </p>
                  <p className="mt-0.5 text-xs">
                    {s.rating_count > 0 ? (
                      <>
                        <span className="text-zari-600">★</span> {Number(s.rating_avg).toFixed(1)} <span className="text-muted">({s.rating_count})</span>
                      </>
                    ) : (
                      <span className="text-muted">New</span>
                    )}
                    {s.featured && <span className="badge ml-2 bg-zari-100 text-zari-700">Featured</span>}
                  </p>
                  <div className="mt-1.5 flex gap-1.5">
                    <a href={telLink(s.phone)} onClick={() => trackShop(s.id, "call")} className="btn-outline !px-2.5 !py-1 text-xs">Call</a>
                    <a
                      href={whatsappLink(s.whatsapp || s.phone, `Hi ${s.name}, I found you on Sarees Hub.`)}
                      target="_blank"
                      rel="noopener"
                      onClick={() => trackShop(s.id, "whatsapp")}
                      className="btn-outline !px-2.5 !py-1 text-xs"
                    >
                      WhatsApp
                    </a>
                    <a href={directionsLink(s.lat, s.lng)} target="_blank" rel="noopener" onClick={() => trackShop(s.id, "directions")} className="btn-outline !px-2.5 !py-1 text-xs">
                      Go
                    </a>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </aside>

      {/* Map */}
      <div className="relative min-w-0 flex-1">
        <div ref={mapEl} className="h-full w-full" />
        {!mapReady && <div className="absolute inset-0 grid place-items-center bg-sand text-sm text-muted">Loading map…</div>}
        {tilesFailed && (
          <div className="absolute inset-0 grid place-items-center bg-sand p-6 text-center text-sm text-muted">
            <p>The map couldn't load right now. The list still shows shops for this area — <button className="underline" onClick={() => setSheet("list")}>open the list</button>.</p>
          </div>
        )}
        {loading && mapReady && (
          <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-white/95 px-3 py-1 text-xs shadow">Searching this area…</div>
        )}
        <div className="absolute left-3 top-3 z-10 md:hidden">
          <button className="btn-gold !py-2 shadow" onClick={() => locate()}>📍 Near me</button>
        </div>
        <button
          className="btn-primary absolute bottom-6 left-1/2 z-10 -translate-x-1/2 shadow-lg md:hidden"
          onClick={() => setSheet("list")}
        >
          ☰ List · {total}
        </button>
      </div>
    </div>
  );
}

function popupHtml(s: ShopCard) {
  const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const img = mediaUrl(s.cover, "thumb");
  return `
    ${img ? `<img src="${img}" alt="" style="width:100%;height:110px;object-fit:cover;border-radius:14px 14px 0 0" />` : ""}
    <div style="padding:10px 12px 12px">
      <div style="font-size:11px;font-weight:600;color:#78521c;text-transform:uppercase;letter-spacing:.04em">${esc(kindLabel(s.kind))}</div>
      <a href="/shops/${encodeURIComponent(s.slug)}" style="display:block;font-family:Georgia,serif;font-size:17px;line-height:1.2;color:#18130e;margin-top:2px">${esc(s.name)}</a>
      <div style="font-size:12px;color:#655c52;margin-top:2px">${esc(placeLine(s))}${s.distance_km != null ? ` · ${formatKm(s.distance_km)}` : ""}</div>
      <div style="font-size:12px;margin-top:4px">${s.rating_count ? `★ ${Number(s.rating_avg).toFixed(1)} (${s.rating_count})` : "New listing"}</div>
      <a href="/shops/${encodeURIComponent(s.slug)}" style="display:block;margin-top:8px;text-align:center;background:#2f4938;color:#fff;border-radius:10px;padding:7px;font-size:13px;font-weight:600">View shop & sarees</a>
    </div>`;
}

function SearchBox({
  value,
  near,
  onSearch,
  onPlace,
}: {
  value: string;
  near?: { lat: number; lng: number };
  onSearch: (q: string) => void;
  onPlace: (p: Place) => void;
}) {
  const [text, setText] = useState(value);
  const [places, setPlaces] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const nearRef = useRef(near);
  nearRef.current = near;

  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text.trim().length < 3) {
      setPlaces([]);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      searchPlaces(text, nearRef.current, ctl.signal).then(setPlaces).catch(() => setPlaces([]));
    }, 350);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [text]);

  const options = [{ kind: "q" as const }, ...places.map((p) => ({ kind: "place" as const, p }))];
  function choose(i: number) {
    const o = options[i];
    setOpen(false);
    if (!o) return;
    if (o.kind === "q") onSearch(text.trim());
    else {
      onPlace(o.p);
      setText("");
      onSearch("");
    }
  }

  return (
    <div className="relative">
      <input
        type="search"
        className="input pr-9"
        placeholder="Shop, saree type, or area / city"
        value={text}
        role="combobox"
        aria-expanded={open}
        aria-controls="map-search-list"
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(-1);
          if (!e.target.value) onSearch("");
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, options.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            choose(active >= 0 ? active : 0);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && text.trim() && (
        <ul id="map-search-list" role="listbox" className="card absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto p-1 text-sm">
          <li role="option" aria-selected={active === 0}>
            <button type="button" onMouseDown={() => choose(0)} className={`w-full rounded-lg px-3 py-2 text-left hover:bg-sand ${active === 0 ? "bg-sand" : ""}`}>
              🔎 Shops & sarees matching “<strong>{text.trim()}</strong>”
            </button>
          </li>
          {places.length > 0 && <li className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Go to place</li>}
          {places.map((p, i) => (
            <li key={p.id + i} role="option" aria-selected={active === i + 1}>
              <button type="button" onMouseDown={() => choose(i + 1)} className={`w-full rounded-lg px-3 py-2 text-left hover:bg-sand ${active === i + 1 ? "bg-sand" : ""}`}>
                <span className="block font-medium">📍 {p.label}</span>
                <span className="block truncate text-xs text-muted">{p.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
