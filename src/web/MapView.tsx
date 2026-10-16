import { useEffect, useRef, useState } from "react";

export interface MapMarker {
  lat: number;
  lng: number;
  label: string;
}

declare global {
  interface Window {
    L?: any;
  }
}

// Mapa Leaflet com ladrilhos do OpenStreetMap. A posicao do consumidor
// vive so na memoria desta tela e nunca e enviada a outro lugar alem
// da busca nearby. Sem rede para o CDN ou para os ladrilhos, mostra
// texto em vez do mapa; o resto do app segue funcionando.
export function MapView({
  center,
  markers,
  zoom = 14,
  ariaLabel,
  caption,
}: {
  center: { lat: number; lng: number };
  markers: MapMarker[];
  zoom?: number;
  ariaLabel: string;
  caption?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  const key = `${center.lat},${center.lng},${zoom}|${markers.map((m) => `${m.lat},${m.lng},${m.label}`).join(";")}`;

  useEffect(() => {
    if (!ref.current) return;
    if (!window.L) {
      setUnavailable(true);
      return;
    }
    const map = window.L.map(ref.current).setView([center.lat, center.lng], zoom);
    window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a>",
    }).addTo(map);
    for (const m of markers) {
      window.L.marker([m.lat, m.lng]).addTo(map).bindPopup(m.label);
    }
    const fix = window.setTimeout(() => map.invalidateSize(), 120);
    return () => {
      window.clearTimeout(fix);
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (unavailable) {
    return <p className="muted map-caption">Mapa indisponivel aqui (sem acesso a rede para o mapa).</p>;
  }
  return (
    <>
      <div ref={ref} className="map" role="img" aria-label={ariaLabel} />
      {caption && <p className="muted map-caption">{caption}</p>}
    </>
  );
}
