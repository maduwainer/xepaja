import { useEffect, useState } from "react";
import type { ItemDTO, OfferDTO } from "../shared/types";
import { ApiError, ItemsApi, OffersApi } from "./api";
import { ItemThumbs } from "./ItemThumbs";

function toISO(local: string): string {
  return new Date(local).toISOString();
}

function formatPrice(offer: OfferDTO): string {
  if (offer.is_free) return "Gratis";
  return `R$ ${(offer.price_cents / 100).toFixed(2).replace(".", ",")}`;
}

const STATE_LABEL: Record<string, string> = {
  rascunho: "Rascunho",
  publicada: "Publicada",
  esgotada: "Esgotada",
  encerrada: "Encerrada",
  cancelada: "Cancelada",
  expirada: "Expirada",
};

export function OffersView() {
  const [offers, setOffers] = useState<OfferDTO[]>([]);
  const [catalog, setCatalog] = useState<ItemDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [formKey, setFormKey] = useState(0);

  async function refresh() {
    const [mine, items] = await Promise.all([OffersApi.mine(), ItemsApi.list()]);
    setOffers(mine.offers);
    setCatalog(items.items);
  }

  useEffect(() => {
    refresh().catch((err) =>
      setError(err instanceof ApiError ? err.message : "Falha ao carregar ofertas."),
    );
  }, []);

  async function run(action: () => Promise<OfferDTO | void>, okMsg: string) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await action();
      await refresh();
      setNotice(okMsg);
      setCancelId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha na requisicao. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const items = catalog
      .map((item) => {
        const qty = Number(String(form.get(`qty-${item.id}`) ?? "").replace(",", "."));
        return { item_id: item.id, qty_per_unit: qty };
      })
      .filter((it) => Number.isFinite(it.qty_per_unit) && it.qty_per_unit > 0);
    const isFree = form.get("is_free") === "on";
    const body: Record<string, unknown> = {
      title: String(form.get("title") ?? ""),
      kind: String(form.get("kind") ?? "item"),
      items,
      total_units: Number(String(form.get("total") ?? "")),
      price_cents: isFree ? 0 : Math.round(Number(String(form.get("price") ?? "").replace(",", ".")) * 100),
      is_free: isFree,
      available_from: toISO(String(form.get("available_from") ?? "")),
      pickup_from: toISO(String(form.get("pickup_from") ?? "")),
      pickup_until: toISO(String(form.get("pickup_until") ?? "")),
      storage_notes: String(form.get("notes") ?? ""),
    };
    await run(async () => {
      await OffersApi.create(body);
      setFormKey((k) => k + 1);
    }, "Oferta criada como rascunho. Envie a foto e publique.");
  }

  async function handlePhoto(offerId: number, file: File | undefined) {
    if (!file) return;
    await run(async () => {
      await OffersApi.uploadPhoto(offerId, file);
    }, "Foto enviada.");
  }

  return (
    <section aria-labelledby="ofertas-titulo" className="card">
      <h1 id="ofertas-titulo">Minhas ofertas</h1>
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
      {offers.length === 0 && (
        <p className="muted">Nenhuma oferta ainda. Crie a primeira abaixo.</p>
      )}
      <ul className="list">
        {offers.map((offer) => (
          <li key={offer.id} className="offer">
            <div className="offer-head">
              {offer.photo_path && (
                <img
                  className="thumb"
                  src={`/api/offers/${offer.id}/photo`}
                  alt={`Foto da oferta ${offer.title}`}
                  loading="lazy"
                />
              )}
              <strong>{offer.title}</strong>
              <span className="badge" data-state={offer.effective_state}>
                {STATE_LABEL[offer.effective_state] ?? offer.effective_state}
              </span>
            </div>
            <p className="muted">
              {offer.kind === "caixa" ? "Caixa surpresa" : "Item"} - {formatPrice(offer)} -{" "}
              {offer.remaining_units} de {offer.total_units} restantes
            </p>
            <p className="muted">
              {offer.items.map((it) => `${it.name} (${it.qty_per_unit} ${it.unit})`).join(", ")}
            </p>
            <ItemThumbs items={offer.items} />
            <div className="row">
              <label className="btn small" htmlFor={`foto-${offer.id}`}>
                {offer.photo_path ? "Trocar foto" : "Enviar foto"}
              </label>
              <input
                id={`foto-${offer.id}`}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="visually-hidden"
                disabled={busy}
                onChange={(e) => handlePhoto(offer.id, e.target.files?.[0])}
              />
              {offer.state === "rascunho" && (
                <button
                  type="button"
                  className="btn small primary"
                  disabled={busy || !offer.photo_path}
                  title={!offer.photo_path ? "Envie a foto antes de publicar." : undefined}
                  onClick={() => run(() => OffersApi.publish(offer.id).then((r) => r.offer), "Oferta publicada.")}
                >
                  Publicar
                </button>
              )}
              {(offer.state === "rascunho" || offer.state === "publicada") && (
                <>
                  <button
                    type="button"
                    className="btn small"
                    disabled={busy}
                    onClick={() => run(() => OffersApi.encerrar(offer.id).then((r) => r.offer), "Oferta encerrada.")}
                  >
                    Encerrar
                  </button>
                  <button
                    type="button"
                    className="btn small danger"
                    disabled={busy}
                    onClick={() => setCancelId(cancelId === offer.id ? null : offer.id)}
                  >
                    Cancelar
                  </button>
                </>
              )}
            </div>
            {cancelId === offer.id && (
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
                    () => OffersApi.cancel(offer.id, reason).then((r) => r.offer),
                    "Oferta cancelada e afetados avisados, sem falta.",
                  );
                }}
              >
                <div className="field">
                  <label htmlFor={`motivo-${offer.id}`}>Motivo do cancelamento</label>
                  <input id={`motivo-${offer.id}`} name="reason" required maxLength={200} />
                </div>
                <button type="submit" className="btn small danger" disabled={busy}>
                  Confirmar cancelamento
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>

      <form key={formKey} onSubmit={handleCreate} className="stack">
        <h2 className="sub">Nova oferta</h2>
        {catalog.length === 0 && (
          <p className="note">Cadastre itens em Itens antes de montar a oferta.</p>
        )}
        <div className="field">
          <label htmlFor="oferta-titulo">Titulo</label>
          <input id="oferta-titulo" name="title" required maxLength={120} />
        </div>
        <div className="field">
          <label htmlFor="oferta-tipo">Tipo</label>
          <select id="oferta-tipo" name="kind" defaultValue="item">
            <option value="item">Item</option>
            <option value="caixa">Caixa surpresa</option>
          </select>
        </div>
        <fieldset className="gps">
          <legend>Composicao (quantidade por unidade)</legend>
          {catalog.map((item) => (
            <div className="field" key={item.id}>
              <label htmlFor={`qty-${item.id}`}>
                {item.name} ({item.unit})
              </label>
              <input id={`qty-${item.id}`} name={`qty-${item.id}`} inputMode="decimal" autoComplete="off" placeholder="0" />
            </div>
          ))}
        </fieldset>
        <div className="row">
          <div className="field">
            <label htmlFor="oferta-total">Unidades ofertadas</label>
            <input id="oferta-total" name="total" required inputMode="numeric" autoComplete="off" placeholder="5" />
          </div>
          <div className="field">
            <label htmlFor="oferta-preco">Preco (R$)</label>
            <input id="oferta-preco" name="price" inputMode="decimal" autoComplete="off" placeholder="10,00" />
          </div>
        </div>
        <div className="field check">
          <input id="oferta-gratis" name="is_free" type="checkbox" />
          <label htmlFor="oferta-gratis">Oferta gratuita</label>
        </div>
        <div className="field">
          <label htmlFor="oferta-ini">Inicio da oferta</label>
          <input id="oferta-ini" name="available_from" type="datetime-local" required />
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="oferta-ret-ini">Inicio da retirada</label>
            <input id="oferta-ret-ini" name="pickup_from" type="datetime-local" required />
          </div>
          <div className="field">
            <label htmlFor="oferta-ret-fim">Fim da retirada</label>
            <input id="oferta-ret-fim" name="pickup_until" type="datetime-local" required />
          </div>
        </div>
        <div className="field">
          <label htmlFor="oferta-notas">Conservacao e orientacoes</label>
          <input id="oferta-notas" name="notes" maxLength={200} placeholder="ex. manter refrigerado" />
        </div>
        <button type="submit" className="btn primary" disabled={busy || catalog.length === 0}>
          {busy ? "Salvando..." : "Criar rascunho"}
        </button>
      </form>
    </section>
  );
}
