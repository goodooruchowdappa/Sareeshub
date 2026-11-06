import { useEffect, useRef } from "react";
import { attachResize, loadMapLibre, MAP_STYLE, markerEl } from "../../lib/map";

export default function MiniMap({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cleanup = () => {};
    let removed = false;
    loadMapLibre().then((ml) => {
      if (removed || !ref.current) return;
      const map = new ml.Map({
        container: ref.current,
        style: MAP_STYLE,
        center: [lng, lat],
        zoom: 14.5,
        cooperativeGestures: true,
        attributionControl: { compact: true },
      });
      map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
      new ml.Marker({ element: markerEl({ label }) }).setLngLat([lng, lat]).addTo(map);
      const off = attachResize(map, ref.current);
      cleanup = () => {
        off();
        map.remove();
      };
    });
    return () => {
      removed = true;
      cleanup();
    };
  }, [lat, lng, label]);
  return <div ref={ref} className="h-full w-full" role="img" aria-label={`Map showing ${label}`} />;
}
