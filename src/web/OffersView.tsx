import { useEffect, useMemo, useState } from "react";
import type { ItemDTO, OfferDTO } from "../shared/types";
import { ApiError, ItemsApi, OffersApi } from "./api";

function toISO(local: string): string {
  return new Date(local).toISOString();
}
function formatPrice(offer: OfferDTO): string {
  if (offer.is_free) return "Grátis";
  return `R$ ${(offer.price_cents / 100).toFixed(2).replace(".", ",")}`;
}
function validYear(local: string): boolean {
  const m = /^(\d{4,})-/.exec(local);
  if (!m) return false;
  if (m[1].length !== 4) return false;
  const y = Number(m[1]);
  return y >= 1000 && y <= 9999;
}
const STATE_LABEL: Record<string, string> = {
  rascunho: "Rascunho",
  publicada: "Publicada",
  esgotada: "Esgotada",
  encerrada: "Encerrada",
  cancelada: "Cancelada",
  expirada: "Expirada",
};
type Tab = "ativas" | "rascunhos" | "esgotadas" | "encerradas";

function tabOf(o: OfferDTO, now: number): Tab {
  const end = new Date(o.pickup_until).getTime();
  if (o.state === "rascunho") return "rascunhos";
  if (o.state === "encerrada" || o.state === "cancelada" || o.state === "expirada" || end < now) return "encerradas";
  if (o.effective_state === "esgotada" || o.remaining_units <= 0) return "esgotadas";
  return "ativas";
}

function Carousel({ offer }: { offer: OfferDTO }) {
  const [idx, setIdx] = useState(0);
  const photos = offer.photos && offer.photos.length ? offer.photos : offer.photo_path ? [{ id: 0, item_id: null as number | null, path: "" }] : [];
  if (photos.length === 0) return null;
  const src = (p: { id: number }) => (p.id === 0 ? `/api/offers/${offer.id}/photo` : `/api/offer-photos/${p.id}`);
  if (photos.length === 1) {
    return <img className="thumb" src={src(photos[0])} alt={`Foto da oferta ${offer.title}`} loading="lazy" />;
  }
  return (
    <div className="carousel">
      <img className="thumb" src={src(photos[idx])} alt={`Foto ${idx + 1} da oferta ${offer.title}`} loading="lazy" />
      <div className="row">
        <button type="button" className="btn small" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))} aria-label="Foto anterior">‹</button>
        <span className="muted" aria-live="polite">{idx + 1} de {photos.length}</span>
        <button type="button" className="btn small" disabled={idx >= photos.length - 1} onClick={() => setIdx((i) => Math.min(photos.length - 1, i + 1))} aria-label="Próxima foto">›</button>
      </div>
    </div>
  );
}

export function OffersView() {
  const [offers, setOffers] = useState<OfferDTO[]>([]);
  const [catalog, setCatalog] = useState<ItemDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("ativas");
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState<"item" | "caixa">("item");
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [formKey, setFormKey] = useState(0);

  async function refresh() {
    const [mine, items] = await Promise.all([OffersApi.mine(), ItemsApi.list()]);
    setOffers(mine.offers);
    setCatalog(items.items);
  }
  useEffect(() => {
    refresh().catch((err) => setError(err instanceof ApiError ? err.message : "Falha ao carregar ofertas."));
  }, []);

  const now = Date.now();
  const counts = useMemo(() => {
    const c: Record<Tab, number> = { ativas: 0, rascunhos: 0, esgotadas: 0, encerradas: 0 };
    for (const o of offers) c[tabOf(o, now)]++;
    return c;
  }, [offers, now]);
  const filtered = offers.filter((o) => tabOf(o, now) === tab);

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
      setError(err instanceof ApiError ? err.message : "Falha na requisição. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const form = new FormData(e.currentTarget);
    const selected = catalog.filter((it) => form.get(`check-${it.id}`) === "on");
    if (selected.length === 0) {
      setError("Marque ao menos um item e informe a quantidade.");
      return;
    }
    const items = [];
    for (const it of selected) {
      const qty = Number(String(form.get(`qty-${it.id}`) ?? "").replace(",", "."));
      if (!Number.isFinite(qty) || qty <= 0) {
        setError(`Informe a quantidade de ${it.name}.`);
        return;
      }
      items.push({ item_id: it.id, qty_per_unit: qty });
    }
    const isFree = form.get("is_free") === "on";
    const available_from = String(form.get("available_from") ?? "");
    const pickup_from = String(form.get("pickup_from") ?? "");
    const pickup_until = String(form.get("pickup_until") ?? "");
    for (const v of [available_from, pickup_from, pickup_until]) {
      if (!validYear(v)) {
        setError("Informe datas com ano de 4 dígitos.");
        return;
      }
    }
    const body: Record<string, unknown> = {
      title: String(form.get("title") ?? ""),
      kind,
      items,
      total_units: kind === "caixa" ? Number(String(form.get("total") ?? "")) : 1,
      price_cents: isFree ? 0 : Math.round(Number(String(form.get("price") ?? "").replace(",", ".")) * 100),
      is_free: isFree,
      available_from: toISO(available_from),
      pickup_from: toISO(pickup_from),
      pickup_until: toISO(pickup_until),
      storage_notes: String(form.get("notes") ?? ""),
      box_description: kind === "caixa" ? String(form.get("box_description") ?? "") : "",
    };
    setBusy(true);
    try {
      const created = await OffersApi.create(body);
      const fd = new FormData();
      if (kind === "caixa") {
        const input = e.currentTarget.querySelector('input[name="photos"]') as HTMLInputElement | null;
        const files = input?.files;
        if (files) {
          if (files.length > 3) throw new Error("Caixa surpresa aceita até 3 imagens.");
          for (const f of Array.from(files)) fd.append("photos", f);
        }
      } else {
        for (const it of selected) {
          const inp = e.currentTarget.querySelector(`input[name="photo-${it.id}"]`) as HTMLInputElement | null;
          const f = inp?.files?.[0];
          if (f) fd.append(`photo-${it.id}`, f);
        }
      }
      if (Array.from(fd.keys()).length > 0) {
        await OffersApi.uploadPhotos(created.offer.id, fd);
      }
      await refresh();
      setTab("rascunhos");
      setCreating(false);
      setChecked({});
      setFormKey((k) => k + 1);
      setNotice("Oferta criada como rascunho. Confira as fotos e publique.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message ?? "Falha ao criar oferta.");
    } finally {
      setBusy(false);
    }
  }

  if (creating) {
    return (
      <section aria-labelledby="nova-oferta-titulo" className="card narrow-lg">
        <h1 id="nova-oferta-titulo">Nova oferta</h1>
        {error && <p className="error" role="alert">{error}</p>}
        <form key={formKey} onSubmit={handleCreate} className="stack">
          {catalog.length === 0 && <p className="note">Cadastre itens em Itens antes de montar a oferta.</p>}
          <div className="field">
            <label htmlFor="oferta-titulo">Título</label>
            <input id="oferta-titulo" name="title" required maxLength={120} />
          </div>
          <div className="field short">
            <label htmlFor="oferta-tipo">Tipo</label>
            <select id="oferta-tipo" name="kind" value={kind} onChange={(e) => setKind(e.target.value as "item" | "caixa")}>
              <option value="item">Item</option>
              <option value="caixa">Caixa surpresa</option>
            </select>
          </div>
          {kind === "caixa" && (
            <div className="field">
              <label htmlFor="oferta-desc">Descrição da caixa surpresa</label>
              <input id="oferta-desc" name="box_description" required maxLength={200} placeholder="O que vem na caixa" />
            </div>
          )}
          <fieldset className="gps">
            <legend>Itens da oferta</legend>
            {catalog.map((item) => (
              <div className="field" key={item.id}>
                <label className="history-radio">
                  <input type="checkbox" name={`check-${item.id}`} checked={!!checked[item.id]} onChange={(e) => setChecked({ ...checked, [item.id]: e.target.checked })} />
                  {item.name} ({item.unit})
                </label>
                <input id={`qty-${item.id}`} name={`qty-${item.id}`} inputMode="decimal" autoComplete="off" placeholder="Quantidade por unidade" disabled={!checked[item.id]} />
                {kind === "item" && checked[item.id] && (
                  <span>
                    <label htmlFor={`photo-${item.id}`}>Foto de {item.name} (1 por item)</label>
                    <input id={`photo-${item.id}`} name={`photo-${item.id}`} type="file" accept="image/jpeg,image/png,image/webp" />
                  </span>
                )}
              </div>
            ))}
            <p className="muted">É permitido até uma imagem por item.</p>
          </fieldset>
          {kind === "caixa" ? (
            <>
              <div className="row">
                <div className="field short">
                  <label htmlFor="oferta-total">Unidades ofertadas</label>
                  <input id="oferta-total" name="total" required inputMode="numeric" autoComplete="off" placeholder="5" />
                </div>
                <div className="field short">
                  <label htmlFor="oferta-preco">Preço (R$)</label>
                  <input id="oferta-preco" name="price" inputMode="decimal" autoComplete="off" placeholder="10,00" />
                </div>
              </div>
              <div className="field">
                <label htmlFor="oferta-fotos">Fotos da caixa (até 3)</label>
                <input id="oferta-fotos" name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple />
              </div>
            </>
          ) : (
            <>
            <p className="note">Total de itens: soma das quantidades por unidade.</p>
            <div className="field short">
              <label htmlFor="oferta-preco">Preço (R$)</label>
              <input id="oferta-preco" name="price" inputMode="decimal" autoComplete="off" placeholder="10,00" />
            </div>
            </>
          )}
          <div className="field check">
            <input id="oferta-gratis" name="is_free" type="checkbox" />
            <label htmlFor="oferta-gratis">Oferta gratuita</label>
          </div>
          <div className="field">
            <label htmlFor="oferta-ini">Início da oferta</label>
            <input id="oferta-ini" name="available_from" type="datetime-local" required />
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="oferta-ret-ini">Início da retirada</label>
              <input id="oferta-ret-ini" name="pickup_from" type="datetime-local" required />
            </div>
            <div className="field">
              <label htmlFor="oferta-ret-fim">Fim da retirada</label>
              <input id="oferta-ret-fim" name="pickup_until" type="datetime-local" required />
            </div>
          </div>
          <div className="field">
            <label htmlFor="oferta-notas">Conservação e orientações</label>
            <input id="oferta-notas" name="notes" maxLength={200} placeholder="ex. manter refrigerado" />
          </div>
          <div className="row">
            <button type="submit" className="btn primary" disabled={busy || catalog.length === 0}>{busy ? "Salvando..." : "Salvar rascunho"}</button>
            <button type="button" className="btn" disabled={busy} onClick={() => { setCreating(false); setError(null); }}>Voltar para ofertas</button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section aria-labelledby="ofertas-titulo" className="card narrow-lg">
      <h1 id="ofertas-titulo">Minhas ofertas</h1>
      <button type="button" className="btn primary" onClick={() => { setCreating(true); setError(null); setNotice(null); }}>Nova oferta</button>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="note" aria-live="polite">{notice}</p>}
      <div className="tabs" role="tablist" aria-label="Filtrar ofertas">
        {(["ativas", "rascunhos", "esgotadas", "encerradas"] as Tab[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "tab active" : "tab"} onClick={() => setTab(t)}>
            {t === "ativas" ? `Ativas (${counts.ativas})` : t === "rascunhos" ? `Rascunhos (${counts.rascunhos})` : t === "esgotadas" ? `Esgotadas (${counts.esgotadas})` : `Encerradas (${counts.encerradas})`}
          </button>
        ))}
      </div>
      {filtered.length === 0 && <p className="muted">Nenhuma oferta nesta aba.</p>}
      <ul className="list">
        {filtered.map((offer) => (
          <li key={offer.id} className="offer">
            <div className="offer-head">
              <Carousel offer={offer} />
              <strong>{offer.title}</strong>
              <span className="badge" data-state={offer.effective_state}>{STATE_LABEL[offer.effective_state] ?? offer.effective_state}</span>
            </div>
            <p className="muted">{offer.kind === "caixa" ? "Caixa surpresa" : "Item"} - {formatPrice(offer)} - {offer.remaining_units} de {offer.total_units} restantes</p>
            {offer.kind === "caixa" && offer.box_description && <p>{offer.box_description}</p>}
            <p className="muted">{offer.items.map((it) => `${it.name} (${it.qty_per_unit} ${it.unit})`).join(", ")}</p>
            <div className="row">
              {offer.state === "rascunho" && (
                <button type="button" className="btn small primary" disabled={busy || (!offer.photo_path && !(offer.photos && offer.photos.length))} title={!offer.photo_path && !(offer.photos && offer.photos.length) ? "Envie a foto no cadastro antes de publicar." : undefined} onClick={() => run(() => OffersApi.publish(offer.id).then((r) => r.offer), "Oferta publicada.")}>Publicar</button>
              )}
              {(offer.state === "rascunho" || offer.state === "publicada") && (
                <>
                  <button type="button" className="btn small" disabled={busy} onClick={() => run(() => OffersApi.encerrar(offer.id).then((r) => r.offer), "Oferta encerrada.")}>Encerrar</button>
                  <button type="button" className="btn small danger" disabled={busy} onClick={() => setCancelId(cancelId === offer.id ? null : offer.id)}>Cancelar</button>
                </>
              )}
            </div>
            {cancelId === offer.id && (
              <form className="stack" onSubmit={(e) => {
                e.preventDefault();
                const reason = String(new FormData(e.currentTarget).get("reason") ?? "").trim();
                if (!reason) { setError("Informe o motivo do cancelamento."); return; }
                run(() => OffersApi.cancel(offer.id, reason).then((r) => r.offer), "Oferta cancelada e afetados avisados, sem falta.");
              }}>
                <div className="field">
                  <label htmlFor={`motivo-${offer.id}`}>Motivo do cancelamento</label>
                  <input id={`motivo-${offer.id}`} name="reason" required maxLength={200} />
                </div>
                <button type="submit" className="btn small danger" disabled={busy}>Confirmar cancelamento</button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
