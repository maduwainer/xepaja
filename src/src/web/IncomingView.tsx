import { useEffect, useState } from "react";
import type { IncomingReservation } from "../shared/types";
import { ApiError, ReservationsApi } from "./api";

export function IncomingView() {
  const [items, setItems] = useState<IncomingReservation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refuseId, setRefuseId] = useState<number | null>(null);
  const [cancelId, setCancelId] = useState<number | null>(null);

  async function refresh() {
    const res = await ReservationsApi.incoming();
    setItems(res.reservations);
  }

  useEffect(() => {
    refresh().catch((err) =>
      setError(err instanceof ApiError ? err.message : "Falha ao carregar solicitacoes."),
    );
  }, []);

  async function run(action: () => Promise<unknown>, okMsg: string) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await action();
      await refresh();
      setNotice(okMsg);
      setRefuseId(null);
      setCancelId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha na requisicao. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  const pendents = items.filter((i) => i.state === "pendente");
  const confirmed = items.filter((i) => i.state === "confirmada");

  return (
    <section aria-labelledby="sol-titulo" className="card">
      <h1 id="sol-titulo">Solicitacoes</h1>
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
      <h2 className="sub">Pendentes de decisao ({pendents.length})</h2>
      {pendents.length === 0 && <p className="muted">Nenhum pedido pendente.</p>}
      <ul className="list">
        {pendents.map((r) => (
          <li key={r.id} className="offer">
            <div className="offer-head">
              <strong>{r.offer_title}</strong>
              <span className="badge" data-state="pendente">
                {r.consumer_misses > 0 ? `${r.consumer_misses} falta(s)` : "sem faltas"}
              </span>
            </div>
            <p className="muted">
              {r.consumer_name} pediu em {new Date(r.created_at).toLocaleString("pt-BR")}.
              Decisao ate {new Date(r.pending_expires_at as string).toLocaleString("pt-BR")}.
            </p>
            <div className="row">
              <button
                type="button"
                className="btn small primary"
                disabled={busy}
                onClick={() => run(() => ReservationsApi.accept(r.id), "Pedido aceito. Codigo gerado ao consumidor.")}
              >
                Aceitar
              </button>
              <button
                type="button"
                className="btn small danger"
                disabled={busy}
                onClick={() => { setRefuseId(refuseId === r.id ? null : r.id); setCancelId(null); }}
              >
                Recusar
              </button>
            </div>
            {refuseId === r.id && (
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  const reason = String(new FormData(e.currentTarget).get("reason") ?? "").trim();
                  if (!reason) {
                    setError("Informe o motivo da recusa.");
                    return;
                  }
                  run(() => ReservationsApi.refuse(r.id, reason), "Pedido recusado e consumidor avisado.");
                }}
              >
                <div className="field">
                  <label htmlFor={`recusa-${r.id}`}>Motivo da recusa</label>
                  <input id={`recusa-${r.id}`} name="reason" required maxLength={200} />
                </div>
                <button type="submit" className="btn small danger" disabled={busy}>
                  Confirmar recusa
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
      <h2 className="sub">Confirmadas ({confirmed.length})</h2>
      {confirmed.length === 0 && <p className="muted">Nenhuma reserva confirmada.</p>}
      <ul className="list">
        {confirmed.map((r) => (
          <li key={r.id} className="list-row">
            <span>
              {r.offer_title} - {r.consumer_name}
            </span>
            <span className="row">
              <button
                type="button"
                className="btn small danger"
                disabled={busy}
                onClick={() => { setCancelId(cancelId === r.id ? null : r.id); setRefuseId(null); }}
              >
                Cancelar
              </button>
            </span>
          </li>
        ))}
      </ul>
      {cancelId !== null && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const reason = String(new FormData(e.currentTarget).get("reason") ?? "").trim();
            if (!reason) {
              setError("Informe o motivo do cancelamento.");
              return;
            }
            run(
              () => ReservationsApi.merchantCancel(cancelId, reason),
              "Reserva cancelada e consumidor avisado, sem falta.",
            );
          }}
        >
          <div className="field">
            <label htmlFor="mcancel-reason">Motivo do cancelamento</label>
            <input id="mcancel-reason" name="reason" required maxLength={200} />
          </div>
          <button type="submit" className="btn small danger" disabled={busy}>
            Confirmar cancelamento
          </button>
        </form>
      )}
    </section>
  );
}
