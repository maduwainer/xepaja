import { useState } from "react";

// Fotos dos itens do seed, servidas estaticas de public/seed-photos.
// So os nomes do seed tem foto; item de comerciante real sem foto
// correspondente mostra o placeholder com a inicial.
export function itemPhotoUrl(name: string): string {
  const slug = name.trim().toLowerCase().replace(/\s+/g, "-");
  return `/seed-photos/${slug}.jpg`;
}

function ItemThumb({ name }: { name: string }) {
  const [missing, setMissing] = useState(false);
  if (missing) {
    return (
      <span className="photo-placeholder" role="img" aria-label={`Sem foto para ${name}`}>
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      className="thumb"
      src={itemPhotoUrl(name)}
      alt={`Foto de ${name}`}
      loading="lazy"
      onError={() => setMissing(true)}
    />
  );
}

export function ItemThumbs({ items }: { items: { name: string }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="item-thumbs" role="list" aria-label="Fotos dos itens">
      {items.map((it) => (
        <span key={it.name} role="listitem" title={it.name} className="item-thumb">
          <ItemThumb name={it.name} />
        </span>
      ))}
    </div>
  );
}

// Capa da reserva: foto da oferta quando houver, placeholder quando nao.
export function ReservationCover({
  offerId,
  hasPhoto,
  title,
}: {
  offerId: number;
  hasPhoto: boolean;
  title: string;
}) {
  const [broken, setBroken] = useState(false);
  if (!hasPhoto || broken) {
    return (
      <span className="photo-placeholder" role="img" aria-label={`Sem foto para ${title}`}>
        {title.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      className="thumb"
      src={`/api/offers/${offerId}/photo`}
      alt={`Foto da oferta ${title}`}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}
