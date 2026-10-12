import { useEffect, useState } from "react";
import type { ReservationDTO, UserDTO } from "../shared/types";
import { ApiError, ReservationsApi } from "./api";
import { MapView } from "./MapView";
import { ItemThumbs, ReservationCover } from "./ItemThumbs";

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR");
}

export function ReservationView({ user }: { user: UserDTO }) {
  const [active, setActive] = useState<ReservationDTO | null>(null);
  const [history, setHistory] = useState<ReservationDTO[]>([]);
  const [misses, setMisses] = useState(user.misses_since_unblock);
  const [blockedUntil, setBlockedUntil] = useState<string | null>(user.blocked_until);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [a, h] = await Promise.all([ReservationsApi.active(), ReservationsApi.history()]);
    setActive(a.reservation);
    setHistory(h.reservations);
    setMisses(a.misses_since_unblock);
    setBlockedUntil(a.blocked_until);
  }

  useEffect(() => {
    refresh().catch((err) =>
      setError(err instanceof ApiError ? err.message : "Falha ao carregar reserva."),
    );
  }, []);

  async function handleCancel() {
    if (!active) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await ReservationsApi.cancel(active.id);
      await refresh();
      setNotice("Reserva cancelada sem falta, dentro do prazo.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao cancelar.");
    } finally {
      setBusy(false);
    }
  }

  const blocked = blockedUntil && new Date(blockedUntil).getTime() > Date.now();

  return (
    <section aria-labelledby="reserva-titulo" className="card">
      <h1 id="reserva-titulo">Minha reserva{active ? " (1)" : " (0)"}</h1>
      {blocked && (
        <p className="error" role="alert">
          Novas reservas bloqueadas ate {formatDate(blockedUntil)}. Ao fim do prazo a contagem recomeça.
        </p>
      )}
      {misses > 0 && !blocked && (
        <p className="note" aria-live="polite">
          Voce tem {misses} falta(s) desde o ultimo desbloqueio. Novos pedidos ficam pendentes de aceite.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="note" aria-live="polite">
          {notice}
        </p>
      )}
      {!active && !blocked && (
        <p className="muted">Nenhuma reserva ativa. Busque ofertas para pedir.</p>
      )}
      {active && (
        <div className="offer">
          <div className="offer-head">
            <ReservationCover offerId={active.offer_id} hasPhoto={active.has_photo} title={active.offer_title} />
            <strong>{active.offer_title}</strong>
            <span className="badge" data-state={active.state}>
              {active.state === "pendente" ? "Pendente" : "Confirmada"}
            </span>
          </div>
          <dl className="facts">
            <div>
              <dt>Retirada</dt>
              <dd>{active.address_snapshot}</dd>
            </div>
            <div>
              <dt>Prazo</dt>
              <dd>
                {formatDate(active.pickup_from)} ate {formatDate(active.pickup_until)}
              </dd>
            </div>
            {active.state === "pendente" && (
              <div>
                <dt>Decisao ate</dt>
                <dd>{formatDate(active.pending_expires_at)}</dd>
              </div>
            )}
            <div>
              <dt>Cancelamento sem falta ate</dt>
              <dd>{formatDate(active.cancel_before)}</dd>
            </div>
          </dl>
          {active.gps_lat !== null && active.gps_lng !== null && (
            <MapView
              center={{ lat: active.gps_lat, lng: active.gps_lng }}
              markers={[{ lat: active.gps_lat, lng: active.gps_lng, label: active.address_snapshot }]}
              zoom={15}
              ariaLabel={`Mapa do local de retirada: ${active.address_snapshot}`}
              caption="Ponto de retirada da sua reserva."
            />
          )}
          <button type="button" className="btn danger" disabled={busy} onClick={handleCancel}>
            {busy ? "Cancelando..." : "Cancelar reserva"}
          </button>
        </div>
      )}
      {history.length > 0 && (
        <>
          <h2 className="sub">Historico ({history.length})</h2>
          <ul className="list">
            {history.map((r) => (
              <li key={r.id} className="list-row">
                <ReservationCover offerId={r.offer_id} hasPhoto={r.has_photo} title={r.offer_title} />
                <span>
                  {r.offer_title} <span className="muted">({r.state})</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
