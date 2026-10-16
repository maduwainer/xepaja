import { useState } from "react";
import type { OfferDTO, ReservationDTO, UserDTO } from "../shared/types";
import { ApiError, ReservationsApi, SearchApi } from "./api";
import { MapView } from "./MapView";
import { ItemThumbs } from "./ItemThumbs";

type Status = "idle" | "locating" | "loading" | "error" | "done";

function formatPrice(offer: OfferDTO): string {
  if (offer.is_free) return "Gratis";
  return `R$ ${(offer.price_cents / 100).toFixed(2).replace(".", ",")}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR");
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
      setMessage("Este aparelho ou navegador nao tem geolocalizacao. A busca por proximidade nao funciona aqui; conta e historico seguem acessiveis.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setLastCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setStatus("loading");
        try {
          const res = await SearchApi.nearby(
            pos.coords.latitude,
            pos.coords.longitude,
            user.search_radius_km,
          );
          setOffers(res.offers);
          setStatus("done");
        } catch (err) {
          setStatus("error");
          setMessage(err instanceof ApiError ? err.message : "Falha na busca. Tente de novo.");
        }
      },
      (err) => {
        setStatus("error");
        setMessage(
          err.code === err.PERMISSION_DENIED
            ? "Sem acesso a localizacao nao ha resultados por proximidade. Libere a permissao e tente de novo; conta e historico seguem acessiveis."
            : "Nao foi possivel obter sua localizacao. Tente de novo; conta e historico seguem acessiveis.",
        );
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
    return (
      <section aria-labelledby="detalhe-titulo" className="card">
        <h1 id="detalhe-titulo">{selected.title}</h1>
        <img
          className="detail-photo"
          src={`/api/offers/${selected.id}/photo`}
          alt={`Foto da oferta ${selected.title}`}
        />
        <dl className="facts">
          <div>
            <dt>Tipo</dt>
            <dd>{selected.kind === "caixa" ? "Caixa surpresa" : "Item"}</dd>
          </div>
          <div>
            <dt>Preco</dt>
            <dd>{formatPrice(selected)}</dd>
          </div>
          <div>
            <dt>Comerciante</dt>
            <dd>
              {selected.merchant_name} - {selected.establishment_name}
            </dd>
          </div>
          <div>
            <dt>Disponiveis</dt>
            <dd>
              {selected.remaining_units} de {selected.total_units}
            </dd>
          </div>
          <div>
            <dt>Retirada</dt>
            <dd>{selected.address_snapshot}</dd>
          </div>
          <div>
            <dt>Periodo</dt>
            <dd>
              {formatDate(selected.pickup_from)} ate {formatDate(selected.pickup_until)}
            </dd>
          </div>
        </dl>
        <h2 className="sub">Composicao por unidade</h2>
        <ItemThumbs items={selected.items} />
        <ul className="list">
          {selected.items.map((it) => (
            <li key={it.item_id} className="list-row">
              <span>
                {it.name} <span className="muted">({it.qty_per_unit} {it.unit})</span>
              </span>
            </li>
          ))}
        </ul>
        {selected.storage_notes && <p className="note">{selected.storage_notes}</p>}
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
        {result && (
          <div className="note" aria-live="polite">
            <p>Reserva {result.state === "pendente" ? "pendente de aceite" : "confirmada"}: retire ate {formatDate(result.pickup_until)} em {result.address_snapshot}.</p>
            {result.pickup_code && <p>Codigo de retirada (anote, uso unico): {result.pickup_code}</p>}
            <p>Cancele sem falta ate {formatDate(result.cancel_before)} em Minha reserva.</p>
          </div>
        )}
        <div className="row">
          <button type="button" className="btn" onClick={() => { setSelected(null); setResult(null); }}>
            Voltar a lista
          </button>
          {!result && (
            <button type="button" className="btn primary" disabled={busy} onClick={handleReserve}>
              {busy ? "Reservando..." : "Reservar esta unidade"}
            </button>
          )}
          {result && (
            <button type="button" className="btn primary" onClick={onReserved}>
              Ir para Minha reserva
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="buscar-titulo" className="card">
      <h1 id="buscar-titulo">Buscar ofertas</h1>
      <p className="muted">
        Raio atual: {user.search_radius_km} km (ajuste em Conta). A sua posicao e
        usada so nesta busca e nao fica salva.
      </p>
      <button
        type="button"
        className="btn primary"
        disabled={status === "locating" || status === "loading"}
        onClick={locateAndSearch}
      >
        {status === "locating"
          ? "Obtendo localizacao..."
          : status === "loading"
            ? "Buscando..."
            : "Buscar perto de mim"}
      </button>
      {status === "error" && message && (
        <div>
          <p className="error" role="alert">
            {message}
          </p>
          <button type="button" className="btn" onClick={locateAndSearch}>
            Tentar novamente
          </button>
        </div>
      )}
      {status === "done" && offers.length === 0 && (
        <p className="note" aria-live="polite">
          Nenhuma oferta vigente neste raio agora.
        </p>
      )}
      {status === "done" && offers.length > 0 && (
        <>
          <MapView
            center={lastCoords}
            markers={[
              { lat: lastCoords.lat, lng: lastCoords.lng, label: "Voce esta aqui (so nesta busca)" },
              ...offers
              .filter((o) => o.gps_lat !== null && o.gps_lng !== null)
              .map((o) => ({
                lat: o.gps_lat as number,
                lng: o.gps_lng as number,
                label: `${o.title} (${o.distance_km} km)`,
              }))]}
            ariaLabel="Mapa das ofertas encontradas perto de voce"
            caption="Voce esta no centro; os pinos sao as ofertas da lista."
          />
          <ul className="list">
          {offers.map((offer) => (
            <li key={offer.id} className="offer">
              <div className="offer-head">
                {offer.photo_path && (
                  <button
                    type="button"
                    className="thumb-btn"
                    onClick={() => openDetail(offer.id)}
                    aria-label={`Ver detalhe de ${offer.title}`}
                  >
                    <img
                      className="thumb"
                      src={`/api/offers/${offer.id}/photo`}
                      alt=""
                      loading="lazy"
                    />
                  </button>
                )}
                <strong>{offer.title}</strong>
                <span className="muted">{offer.distance_km} km</span>
              </div>
              <p className="muted">
                {offer.kind === "caixa" ? "Caixa surpresa" : "Item"} - {formatPrice(offer)} -{" "}
                {offer.merchant_name} - {offer.remaining_units} disponiveis
              </p>
              <p className="muted">
                Retirada: {formatDate(offer.pickup_from)} ate {formatDate(offer.pickup_until)}
              </p>
              <button type="button" className="btn small" onClick={() => openDetail(offer.id)}>
                Ver detalhe
              </button>
            </li>
          ))}
        </ul>
        </>
      )}
    </section>
  );
}
