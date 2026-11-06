import { PUBLIC_MAP_STYLE } from "astro:env/client";
import type { Map as MLMap } from "maplibre-gl";

// MapLibre parses tiles in a Web Worker. Bundlers don't copy that file automatically,
// so we ship it as an asset and point MapLibre at it.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

let lib: Promise<typeof import("maplibre-gl")> | null = null;
/** Loads MapLibre (and its CSS) only when a map is actually shown. */
export function loadMapLibre() {
  lib ??= Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl.css")]).then(([m]) => {
    m.setWorkerUrl(new URL(workerUrl, window.location.href).toString());
    return m;
  });
  return lib;
}

export const MAP_STYLE = PUBLIC_MAP_STYLE;
export const INDIA_CENTER: [number, number] = [78.9629, 22.5937];

export function markerEl(opts: { featured?: boolean; selected?: boolean; label?: string } = {}) {
  const el = document.createElement("div");
  el.className = "sh-pin";
  const fill = opts.featured ? "#d4a62a" : "#861a3a";
  const scale = opts.selected ? 1.25 : 1;
  el.innerHTML = `<svg width="${30 * scale}" height="${40 * scale}" viewBox="0 0 30 40" aria-hidden="true">
    <path d="M15 1C7.3 1 1 7.2 1 14.9 1 25.4 15 39 15 39s14-13.6 14-24.1C29 7.2 22.7 1 15 1z" fill="${fill}" stroke="#fff" stroke-width="2"/>
    <circle cx="15" cy="15" r="5.5" fill="#fffaf2"/></svg>`;
  el.style.cursor = "pointer";
  if (opts.label) el.setAttribute("aria-label", opts.label);
  return el;
}

export function attachResize(map: MLMap, el: HTMLElement) {
  const ro = new ResizeObserver(() => map.resize());
  ro.observe(el);
  return () => ro.disconnect();
}
