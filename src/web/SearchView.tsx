import { useState } from "react";
import type { OfferDTO, ReservationDTO, UserDTO } from "../shared/types";
import { ApiError, ReservationsApi, SearchApi } from "./api";
import { MapView } from "./MapView";

type Status = "idle" | "locating" | "loading" | "error" | "done";

function formatPrice(offer: { is_free: unknown; price_cents: number }): string {
  if (offer.is_free) return "Grátis";
  return `R$ ${(offer.price_cents / 100).toFixed(2).replace(".", ",")}`;
}
function formatShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function formatLong(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }),
    time: d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
  };
}

function OfferCarousel({ offer }: { offer: OfferDTO }) {
  const [idx, setIdx] = useState(0);
  const photos = offer.photos && offer.photos.length ? offer.photos : offer.photo_path ? [{ id: 0 }] : [];
  if (photos.length === 0) return null;
  const src = (id: number) => (id === 0 ? `/api/offers/${offer.id}/photo` : `/api/offer-photos/${id}`);
  if (photos.length === 1) {
    return <img className="detail-photo" src={src(photos[0].id)} alt={`Foto da oferta ${offer.title}`} />;
  }
  return (
    <div>
      <img className="detail-photo" src={src(photos[idx].id)} alt={`Foto ${idx + 1} da oferta ${offer.title}`} />
      <div className="row">
        <button type="button" className="btn small" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))} aria-label="Foto anterior">‹</button>
        <span className="muted">{idx + 1} de {photos.length}</span>
        <button type="button" className="btn small" disabled={idx >= photos.length - 1} onClick={() => setIdx((i) => Math.min(photos.length - 1, i + 1))} aria-label="Próxima foto">›</button>
      </div>
    </div>
  );
}

export function SearchView({ user, onReserved }: { user: UserDTO; onReserved: () => void }) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [offers, setOffers] = useState<OfferDTO[]>([]);
  const [selected, setSelected] = useState<OfferDTO | null>(null);
  const [result, setResult] = useState<ReservationDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastCoords, setLastCoords] = useState({ lat: 0, lng: 0 });

  function locateAndSearch() {
    setStatus("locating");
    setMessage(null);
    setSelected(null);
    if (!("geolocation" in navigator)) {
      setStatus("error");
      setMessage("Este aparelho ou navegador não tem geolocalização. A busca por proximidade não funciona aqui; conta e histórico seguem acessíveis.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setLastCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setStatus("loading");
        try {
          const res = await SearchApi.nearby(pos.coords.latitude, pos.coords.longitude, user.search_radius_km);
          setOffers(res.offers);
          setStatus("done");
        } catch (err) {
          setStatus("error");
          setMessage(err instanceof ApiError ? err.message : "Falha na busca. Tente de novo.");
        }
      },
      (err) => {
        setStatus("error");
        setMessage(err.code === err.PERMISSION_DENIED ? "Sem acesso à localização não há resultados por proximidade. Libere a permissão e tente de novo; conta e histórico seguem acessíveis." : "Não foi possível obter sua localização. Tente de novo; conta e histórico seguem acessíveis.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function openDetail(id: number) {
    setMessage(null);
    setResult(null);
    try {
      const res = await SearchApi.detail(id);
      setSelected(res.offer);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Falha ao abrir o detalhe.");
    }
  }

  async function handleReserve() {
    if (!selected || busy) return;
    setMessage(null);
    setBusy(true);
    try {
      const res = await ReservationsApi.create(selected.id);
      setResult(res.reservation);
      const detail = await SearchApi.detail(selected.id);
      setSelected(detail.offer);
      const list = await SearchApi.nearby(lastCoords.lat, lastCoords.lng, user.search_radius_km).catch(() => null);
      if (list) setOffers(list.offers);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Falha na reserva. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  if (selected) {
    const until = formatLong(selected.pickup_until);
    const cancel = result ? formatLong(result.cancel_before) : null;
    return (
      <section aria-labelledby="detalhe-titulo" className="card narrow">
        <h1 id="detalhe-titulo">{selected.title}</h1>
        <OfferCarousel offer={selected} />
        <div className="offer">
          <dl className="facts">
            <div><dt>Comércio</dt><dd>{selected.establishment_name}</dd></div>
            <div><dt>Endereço</dt><dd>{selected.address_snapshot}</dd></div>
            <div><dt>Tipo</dt><dd>{selected.kind === "caixa" ? "Caixa surpresa" : "Item"}</dd></div>
            <div><dt>Valor</dt><dd>{formatPrice(selected)}</dd></div>
            <div><dt>Disponíveis</dt><dd>{selected.remaining_units} de {selected.total_units}</dd></div>
            <div><dt>Retirada</dt><dd>{formatShort(selected.pickup_from)} até {formatShort(selected.pickup_until)}</dd></div>
          </dl>
          {selected.kind === "caixa" && selected.box_description && <p>{selected.box_description}</p>}
          {selected.items.length > 0 && (
            <ul className="list">
              {selected.items.map((it) => (
                <li key={it.item_id} className="list-row"><span>{it.name} <span className="muted">({it.qty_per_unit} {it.unit})</span></span></li>
              ))}
            </ul>
          )}
          {selected.storage_notes && <p className="note">{selected.storage_notes}</p>}
        </div>
        {selected.gps_lat !== null && selected.gps_lng !== null && (
          <MapView
            center={{ lat: selected.gps_lat, lng: selected.gps_lng }}
            markers={[{ lat: selected.gps_lat, lng: selected.gps_lng, label: selected.address_snapshot }]}
            zoom={15}
            ariaLabel={`Mapa do local de retirada: ${selected.address_snapshot}`}
            caption="Ponto de retirada informado pelo comerciante."
          />
        )}
        {message && <p className="error" role="alert">{message}</p>}
        {result && cancel && (
          <div className="note" aria-live="polite">
            <p><strong>Oba, sua reserva confirmada! :)</strong></p>
            <p>Retire seu pedido em <strong>{result.address_snapshot}</strong> até <strong>{until.date}</strong>, às <strong>{until.time}</strong>.</p>
            <p>Na retirada, apresente este código ao comerciante:</p>
            <p><strong className="pickup-code">{result.pickup_code}</strong></p>
            <p>Compartilhe o código apenas com o comerciante, no momento da retirada.</p>
            <p><strong>Precisa cancelar?</strong> Acesse Minhas Reservas até <strong>{cancel.date}, às {cancel.time}</strong> para cancelar sem registrar falta.</p>
            <p>Boa feira!</p>
          </div>
        )}
        <div className="row actions">
          <button type="button" className="btn" onClick={() => { setSelected(null); setResult(null); }}>Voltar à lista</button>
          {!result && (
            <button type="button" className="btn primary" disabled={busy} onClick={handleReserve}>{busy ? "Reservando..." : "Reservar esta unidade"}</button>
          )}
          {result && (
            <button type="button" className="btn primary" onClick={onReserved}>Ir para Minhas reservas</button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="buscar-titulo" className="card narrow">
      <h1 id="buscar-titulo">Buscar ofertas</h1>
      <p className="muted">Raio atual: {user.search_radius_km} km (ajuste em Conta). A sua posição é usada somente nesta busca e não fica salva.</p>
      <button type="button" className="btn primary" disabled={status === "locating" || status === "loading"} onClick={locateAndSearch}>
        {status === "locating" ? "Obtendo localização..." : status === "loading" ? "Buscando..." : "Buscar perto de mim"}
      </button>
      {status === "error" && message && (
        <div>
          <p className="error" role="alert">{message}</p>
          <button type="button" className="btn primary" onClick={locateAndSearch}>Tentar novamente</button>
        </div>
      )}
      {status === "done" && offers.length === 0 && <p className="note" aria-live="polite">Nenhuma oferta vigente neste raio agora.</p>}
      {status === "done" && offers.length > 0 && (
        <>
          <MapView
            center={lastCoords}
            markers={[{ lat: lastCoords.lat, lng: lastCoords.lng, label: "Você está aqui (só nesta busca)" }, ...offers.filter((o) => o.gps_lat !== null && o.gps_lng !== null).map((o) => ({ lat: o.gps_lat as number, lng: o.gps_lng as number, label: `${o.title} (${o.distance_km} km)` }))]}
            ariaLabel="Mapa das ofertas encontradas perto de você"
            caption="Você está no centro; os pinos são as ofertas da lista."
          />
          <ul className="list">
            {offers.map((offer) => (
              <li key={offer.id} className="offer">
                <strong>{offer.title}</strong>
                <p className="muted">{offer.establishment_name}</p>
                <p className="muted">{offer.address_snapshot}</p>
                <p className="muted">{offer.kind === "caixa" ? "Caixa surpresa" : "Item"} · {formatPrice(offer)}</p>
                <p className="muted">Retirada: {formatShort(offer.pickup_from)} até {formatShort(offer.pickup_until)}</p>
                <p className="muted">{offer.distance_km} km · {offer.remaining_units} disponíveis</p>
                <button type="button" className="btn small" onClick={() => openDetail(offer.id)}>Ver detalhe</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
