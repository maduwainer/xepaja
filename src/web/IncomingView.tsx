import { useEffect, useState } from "react";
import { ApiError, ReservationsApi } from "./api";

export function IncomingView() {
  const [items, setItems] = useState<Awaited<ReturnType<typeof ReservationsApi.incoming>>["reservations"]>([]);
  const [detail, setDetail] = useState<(Awaited<ReturnType<typeof ReservationsApi.incomingDetail>>["solicitation"]) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelId, setCancelId] = useState<number | null>(null);

  async function refresh() {
    const res = await ReservationsApi.incoming();
    setItems(res.reservations);
  }

  useEffect(() => {
    refresh().catch((err) =>
      setError(err instanceof ApiError ? err.message : "Falha ao carregar solicitações."),
    );
  }, []);

  async function openDetail(id: number) {
    setError(null);
    setBusy(true);
    try {
      const res = await ReservationsApi.incomingDetail(id);
      setDetail(res.solicitation);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao abrir a solicitação.");
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<unknown>, okMsg: string) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await action();
      await refresh();
      setNotice(okMsg);
      setCancelId(null);
      setDetail(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha na requisição. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  if (detail) {
    return (
      <section aria-labelledby="sol-detalhe-titulo" className="card">
        <h1 id="sol-detalhe-titulo">Solicitação #{detail.id}</h1>
        <dl className="facts">
          <div><dt>Oferta</dt><dd>{detail.offer_title}</dd></div>
          <div><dt>Tipo</dt><dd>{detail.offer_kind === "caixa" ? "Caixa surpresa" : "Item"}</dd></div>
          <div><dt>Valor</dt><dd>{detail.price_cents === 0 ? "Grátis" : `R$ ${(detail.price_cents / 100).toFixed(2).replace(".", ",")}`}</dd></div>
          <div><dt>Retirada até</dt><dd>{new Date(detail.pickup_until).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</dd></div>
          <div><dt>Nome</dt><dd>{detail.consumer_name}</dd></div>
          <div><dt>E-mail</dt><dd>{detail.consumer_email}</dd></div>
          <div><dt>Faltas</dt><dd>{detail.consumer_misses}</dd></div>
        </dl>
        {detail.box_description && <p className="note">{detail.box_description}</p>}
        {detail.items?.length > 0 && (
          <ul className="list">
            {detail.items.map((it) => (
              <li key={it.item_id} className="list-row"><span>{it.name} ({it.qty_per_unit} {it.unit})</span></li>
            ))}
          </ul>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="note" aria-live="polite">{notice}</p>}
        <div className="row actions">
          <button type="button" className="btn small danger" disabled={busy} onClick={() => setCancelId(detail.id)}>Cancelar reserva</button>
          <button type="button" className="btn" disabled={busy} onClick={() => setDetail(null)}>Voltar para solicitações</button>
        </div>
        {cancelId === detail.id && (
          <form className="stack" onSubmit={(e) => {
            e.preventDefault();
            const reason = String(new FormData(e.currentTarget).get("reason") ?? "").trim();
            if (!reason) { setError("Informe o motivo do cancelamento."); return; }
            run(() => ReservationsApi.merchantCancel(detail.id, reason), "Reserva cancelada e consumidor avisado.");
          }}>
            <div className="field">
              <label htmlFor="mcancel-reason">Motivo do cancelamento</label>
              <input id="mcancel-reason" name="reason" required maxLength={200} />
            </div>
            <button type="submit" className="btn small danger" disabled={busy}>Confirmar cancelamento</button>
          </form>
        )}
      </section>
    );
  }

  return (
    <section aria-labelledby="sol-titulo" className="card">
      <h1 id="sol-titulo">Solicitações</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="note" aria-live="polite">{notice}</p>}
      {items.length === 0 && <p className="muted">Nenhuma solicitação confirmada agora.</p>}
      <ul className="list">
        {items.map((r) => (
          <li key={r.id} className="offer">
            <div className="offer-head">
              <strong>{r.offer_title}</strong>
              <span className="badge" data-state="confirmada">Confirmada</span>
            </div>
            <p className="muted">{r.consumer_name} pediu em {new Date(r.created_at).toLocaleString("pt-BR")}.</p>
            <div className="row">
              <button type="button" className="btn small" disabled={busy} aria-label={`Ver detalhes da solicitação ${r.id}`} onClick={() => openDetail(r.id)}>👁️ Ver detalhes</button>
              <button type="button" className="btn small danger" disabled={busy} onClick={() => { setCancelId(r.id); }}>Cancelar</button>
            </div>
          </li>
        ))}
      </ul>
      {cancelId !== null && !detail && (
        <form className="stack" onSubmit={(e) => {
          e.preventDefault();
          const reason = String(new FormData(e.currentTarget).get("reason") ?? "").trim();
          if (!reason) { setError("Informe o motivo do cancelamento."); return; }
          run(() => ReservationsApi.merchantCancel(cancelId, reason), "Reserva cancelada e consumidor avisado.");
        }}>
          <div className="field">
            <label htmlFor="mcancel-reason">Motivo do cancelamento</label>
            <input id="mcancel-reason" name="reason" required maxLength={200} />
          </div>
          <button type="submit" className="btn small danger" disabled={busy}>Confirmar cancelamento</button>
        </form>
      )}
    </section>
  );
}
