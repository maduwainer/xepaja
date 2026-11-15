import { useEffect, useRef, useState } from "react";
import type { ReservationDTO, UserDTO } from "../shared/types";
import { ApiError, ReservationsApi } from "./api";
import { MapView } from "./MapView";
import { ItemThumbs, ReservationCover } from "./ItemThumbs";

const LABELS: Record<string, string> = {
  confirmada: "Confirmada", recusada: "Recusada",
  retirada: "Retirada", cancelada: "Cancelada", expirada: "Expirada",
};
const FINAL_STATES = ["recusada", "retirada", "cancelada", "expirada"];
type Filters = { from: string; to: string; state: string };
const EMPTY: Filters = { from: "", to: "", state: "" };
function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("pt-BR") : "Não registrado";
}
function price(cents: number): string {
  return cents === 0 ? "Grátis" : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function params(filters: Filters) {
  const from = filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : undefined;
  const end = filters.to ? new Date(`${filters.to}T00:00:00`) : null;
  if (end) end.setDate(end.getDate() + 1); // inclui o último dia inteiro no fuso local, inclusive horário de verão
  return { state: filters.state, from, until: end?.toISOString() };
}
function message(err: unknown) { return err instanceof ApiError ? err.message : "Não foi possível carregar as reservas. Tente novamente."; }

function Summary({ r }: { r: ReservationDTO }) {
  return <>
    <div className="offer-head">
      <ReservationCover offerId={r.offer_id} reservationId={r.id} hasPhoto={r.has_photo} title={r.offer_title} />
      <span className="badge" data-state={r.state}>{LABELS[r.state] ?? r.state}</span>
    </div>
    <h3 className="sub">{r.offer_title}</h3>
    <p>{r.establishment_name ?? "Estabelecimento não registrado"} · {price(r.price_cents)}</p>
    <p className="muted">Solicitada em {formatDate(r.created_at)}</p>
  </>;
}
function Code({ r }: { r: ReservationDTO }) {
  if (r.state !== "confirmada") return null;
  return <div className="pickup-code-box">
    <p>Código de retirada</p>
    {r.pickup_code ? <>
      <strong className="pickup-code">{r.pickup_code}</strong>
      <p>Mostre este código no local. Ele só pode ser usado uma vez.</p>
    </> : <p>Código indisponível para consulta. Use o código anotado na confirmação desta reserva.</p>}
  </div>;
}

export function ReservationView({ user, onActiveChange }: { user: UserDTO; onActiveChange?: (count: number) => void }) {
  const [active, setActive] = useState<ReservationDTO | null>(null);
  const [history, setHistory] = useState<ReservationDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [more, setMore] = useState(false);
  const [misses, setMisses] = useState(user.misses_since_unblock);
  const [blockedUntil, setBlockedUntil] = useState(user.blocked_until);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [screen, setScreen] = useState<"list" | "filters" | "detail">("list");
  const [detail, setDetail] = useState<ReservationDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeLoading, setActiveLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const historyRequest = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);

  async function refreshActive() {
    setActiveLoading(true);
    try {
      const a = await ReservationsApi.active();
      setActive(a.reservation); setMisses(a.misses_since_unblock); setBlockedUntil(a.blocked_until);
      onActiveChange?.(a.reservation ? 1 : 0);
    } catch (err) { setError(message(err)); }
    finally { setActiveLoading(false); }
  }
  async function loadHistory(f: Filters, offset = 0) {
    const request = ++historyRequest.current;
    setLoading(true); setHistoryError(null);
    try {
      const result = await ReservationsApi.history({ ...params(f), offset });
      if (request !== historyRequest.current) return;
      setHistory(prev => offset ? [...prev, ...result.reservations] : result.reservations);
      setTotal(result.total); setMore(result.has_more);
    } catch (err) { if (request === historyRequest.current) setHistoryError(message(err)); }
    finally { if (request === historyRequest.current) setLoading(false); }
  }
  useEffect(() => { void refreshActive(); }, []);
  useEffect(() => { setHistory([]); setTotal(0); setMore(false); void loadHistory(filters); }, [filters]);
  useEffect(() => { heading.current?.focus(); }, [screen]);

  async function openDetail(r: ReservationDTO) {
    setBusy(true); setError(null); setNotice(null); setConfirming(false);
    try {
      const result = await ReservationsApi.detail(r.id);
      setDetail(result.reservation); setScreen("detail");
      if (r.state === "confirmada" && result.reservation.state !== "confirmada") {
        await refreshActive(); await loadHistory(filters);
      }
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!detail || busy) return;
    setBusy(true); setError(null);
    try {
      await ReservationsApi.cancel(detail.id);
      setDetail((await ReservationsApi.detail(detail.id)).reservation);
      setConfirming(false); setNotice("Reserva cancelada sem registro de falta.");
      await refreshActive(); await loadHistory(filters);
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }
  const blocked = blockedUntil && new Date(blockedUntil).getTime() > Date.now();
  const hasFilters = !!(filters.from || filters.to || filters.state);
  const filterCount = Number(!!(filters.from || filters.to)) + Number(!!filters.state);
  const filterSummary = `${filters.from ? filters.from.split("-").reverse().join("/") : "Todas as datas iniciais"} – ${filters.to ? filters.to.split("-").reverse().join("/") : "Todas as datas finais"} · ${filters.state ? LABELS[filters.state] : "Todos os status"}`;

  if (screen === "filters") return <section className="card narrow reservations-view" aria-labelledby="filtros-titulo">
    <h1 id="filtros-titulo" ref={heading} tabIndex={-1}>Filtrar reservas</h1>
    <p>Encontre uma reserva pela data em que ela foi solicitada e pelo status.</p>
    <form className="stack" onSubmit={e => {
      e.preventDefault();
      if (draft.from && draft.to && draft.from > draft.to) { setError("A data final não pode ser anterior à data inicial."); return; }
      setError(null); setFilters({ ...draft }); setScreen("list");
    }}>
      <fieldset className="gps"><legend>Data da solicitação</legend>
        <div className="cols-2">
          <div className="field"><label htmlFor="history-from">De</label><input id="history-from" type="date" value={draft.from} onChange={e => { setError(null); setDraft({ ...draft, from: e.target.value }); }} aria-describedby="history-dates-note" aria-invalid={!!error} /></div>
          <div className="field"><label htmlFor="history-to">Até</label><input id="history-to" type="date" value={draft.to} onChange={e => { setError(null); setDraft({ ...draft, to: e.target.value }); }} aria-describedby={error ? "history-filter-error history-dates-note" : "history-dates-note"} aria-invalid={!!error} /></div>
        </div>
        <p id="history-dates-note" className="muted">O período inclui a data inicial e a final.</p>
      </fieldset>
      <fieldset className="gps"><legend>Status da reserva</legend>
        {["", ...FINAL_STATES].map(state => <label className="history-radio" key={state || "all"}>
          <input type="radio" name="history-state" value={state} checked={draft.state === state} onChange={() => setDraft({ ...draft, state })} />
          {state ? LABELS[state] : "Todos os status"}
        </label>)}
      </fieldset>
      {error && <p id="history-filter-error" className="error" role="alert">{error}</p>}
      <button className="btn primary" type="submit">Aplicar filtros</button>
      <button className="btn" type="button" onClick={() => { setDraft(EMPTY); setFilters({ ...EMPTY }); setError(null); setScreen("list"); }}>Limpar filtros</button>
      <button className="btn" type="button" onClick={() => { setError(null); setScreen("list"); }}>Voltar sem aplicar</button>
    </form>
  </section>;

  if (screen === "detail" && detail) {
    const isActive = detail.state === "confirmada";
    const canCancel = isActive && Date.now() < new Date(detail.cancel_before).getTime();
    return <section className="card narrow reservations-view" aria-labelledby="reserva-detalhe-titulo">
      <h1 id="reserva-detalhe-titulo" ref={heading} tabIndex={-1}>{isActive ? "Sua reserva ativa" : "Histórico da reserva"}</h1>
      <p className="muted">Reserva #{detail.id}</p>
      <article className={`offer reservation-summary ${isActive ? "reservation-active" : ""}`}>
        <Summary r={detail} /><Code r={detail} />
        <dl className="facts">
          <div><dt>Retirada</dt><dd>{formatDate(detail.pickup_from)} até {formatDate(detail.pickup_until)}</dd></div>
          <div><dt>Endereço</dt><dd>{detail.address_snapshot}</dd></div>
          {detail.reference && <div><dt>Referência</dt><dd>{detail.reference}</dd></div>}
          {detail.state === "pendente" && <div><dt>Decisão até</dt><dd>{formatDate(detail.pending_expires_at)}</dd></div>}
          {isActive && <div><dt>Cancelamento sem falta até</dt><dd>{formatDate(detail.state === "pendente" ? detail.pending_expires_at : detail.cancel_before)}</dd></div>}
        </dl>
        {detail.cancel_reason && <p className="note">Motivo: {detail.cancel_reason}</p>}
      </article>
      <h2 className="sub">O que você reservou</h2>
      <div className="offer">
        <h3 className="sub">{detail.offer_title}</h3>
        <p>Quantidade reservada: {detail.quantity} unidade da oferta.</p>
        {detail.items ? <><ItemThumbs items={detail.items} /><ul>{detail.items.map(it => <li key={it.item_id}>{it.qty_per_unit} {it.unit} de {it.name}</li>)}</ul></> : <p className="muted">Composição não registrada nesta reserva antiga.</p>}
        <p><strong>Valor total: {price(detail.price_cents)}</strong></p>
        <p className="muted">Pagamento, quando houver, é presencial na retirada. Nada é cobrado pelo aplicativo.</p>
        {detail.storage_notes && <><h3 className="sub">Conservação e orientações</h3><p>{detail.storage_notes}</p></>}
        {!detail.snapshot_available && <p className="note">Algumas informações não foram registradas nesta reserva antiga.</p>}
      </div>
      {detail.gps_lat !== null && detail.gps_lng !== null && <MapView center={{ lat: detail.gps_lat, lng: detail.gps_lng }} markers={[{ lat: detail.gps_lat, lng: detail.gps_lng, label: detail.address_snapshot }]} zoom={15} ariaLabel="Mapa do local de retirada da reserva" caption="Ponto de retirada registrado na reserva." />}
      {notice && <p className="note" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {canCancel && <div className="stack">
        {!confirming ? <button className="btn danger" disabled={busy} onClick={() => setConfirming(true)}>Cancelar reserva</button> : <>
          <p className="note">Deseja realizar o cancelamento da reserva?</p>
          <button className="btn danger" disabled={busy} onClick={cancel}>{busy ? "Cancelando..." : "Confirmar cancelamento"}</button>
          <button className="btn" disabled={busy} onClick={() => setConfirming(false)}>Manter reserva</button>
        </>}
      </div>}
      {isActive && !canCancel && <p className="muted">O prazo de cancelamento terminou.</p>}
      <button className="btn primary" disabled={busy} onClick={() => { setScreen("list"); setError(null); setNotice(null); }}>Voltar para minhas reservas</button>
    </section>;
  }

  return <section className="card narrow reservations-view" aria-labelledby="reserva-titulo">
    <h1 id="reserva-titulo" ref={heading} tabIndex={-1}>Minhas reservas</h1>
    <p className="muted">Acompanhe sua reserva e consulte o histórico.</p>
    <div className="stack">
      <button className="btn" onClick={() => { setDraft({ ...filters }); setError(null); setScreen("filters"); }}>{hasFilters ? `Editar filtros · ${filterCount} ${filterCount === 1 ? "aplicado" : "aplicados"}` : "Filtrar por data e status"}</button>
      <p className="muted">{hasFilters ? filterSummary : "Todas as datas · Todos os status"}</p>
      {hasFilters && <button className="btn" onClick={() => setFilters({ ...EMPTY })}>Limpar filtros</button>}
    </div>
    {blocked && <p className="error" role="alert">Novas reservas bloqueadas até {formatDate(blockedUntil)}. Ao fim do prazo, a contagem recomeça.</p>}
    {misses > 0 && !blocked && <p className="note">Você tem {misses} {misses === 1 ? "falta" : "faltas"} desde o último desbloqueio.</p>}
    {error && <p className="error" role="alert">{error} <button className="btn small" onClick={() => { setError(null); void refreshActive(); }}>Tentar novamente</button></p>}
    <h2 className="sub">Sua reserva ativa</h2>
    {activeLoading ? <p role="status">Carregando reserva ativa...</p> : active ? <article className="offer reservation-active">
      <Summary r={active} /><Code r={active} />
      <p>Retirada: {formatDate(active.pickup_from)} até {formatDate(active.pickup_until)}</p>
      <p>{active.address_snapshot}</p>
      {active.state === "pendente" && <p>Decisão até {formatDate(active.pending_expires_at)}</p>}
      <button className="btn primary" disabled={busy} onClick={() => openDetail(active)}>{busy ? "Carregando..." : "Ver reserva ativa"}</button>
    </article> : !error && <p className="muted">Nenhuma reserva ativa. Busque ofertas para reservar.</p>}
    {hasFilters && active && <p className="muted">A reserva ativa fica sempre visível, mesmo com filtros.</p>}
    <h2 className="sub">Histórico de reservas{!loading && !historyError ? ` · ${total} ${total === 1 ? "resultado" : "resultados"}` : ""}</h2>
    <ul className="list">{history.map(r => <li className="offer" key={r.id}>
      <Summary r={r} />
      <button className="btn" disabled={busy} onClick={() => openDetail(r)}>Ver detalhes da reserva #{r.id}</button>
    </li>)}</ul>
    {loading && <p role="status">Carregando histórico...</p>}
    {historyError && <div><p className="error" role="alert">{historyError}</p><button className="btn" onClick={() => loadHistory(filters, history.length)}>Tentar novamente</button></div>}
    {!loading && !historyError && history.length === 0 && <p className="muted">{hasFilters ? "Nenhuma reserva encontrada com esses filtros." : "Você ainda não tem reservas no histórico."}</p>}
    {more && !historyError && <button className="btn" disabled={loading} onClick={() => loadHistory(filters, history.length)}>{loading ? "Carregando..." : "Carregar mais"}</button>}
  </section>;
}
