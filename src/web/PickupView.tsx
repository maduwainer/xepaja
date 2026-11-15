import { useState } from "react";
import { ApiError, PickupApi } from "./api";

type Preview = Awaited<ReturnType<typeof PickupApi.preview>>["preview"];

export function PickupView() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [code, setCode] = useState("");
  const [done, setDone] = useState<{ offer_title: string; consumer_name: string; confirmed_at: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function formatNoSeconds(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function price(cents: number, free: boolean): string {
    if (free || cents === 0) return "Grátis";
    return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
  }

  async function handleVerify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setDone(null);
    setPreview(null);
    setBusy(true);
    try {
      const res = await PickupApi.preview(code);
      setPreview(res.preview);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao verificar. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const res = await PickupApi.confirm(code);
      setDone({ offer_title: res.pickup.offer_title, consumer_name: res.pickup.consumer_name, confirmed_at: res.pickup.confirmed_at });
      setPreview(null);
      setCode("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao confirmar. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="ret-titulo" className="card narrow-sm">
      <h1 id="ret-titulo">Retirada</h1>
      <p className="muted">Peça o código de retirada ao comprador e insira aqui para confirmar a entrega. Você tem até 15 minutos após o fim do horário de retirada para confirmar. Depois desse prazo, a ausência do comprador será registrada automaticamente.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {done && <p className="note" aria-live="polite">Retirada confirmada: {done.offer_title} para {done.consumer_name}.</p>}
      {!preview && (
        <form className="stack" onSubmit={handleVerify}>
          <div className="field code">
            <label htmlFor="pickup-code">Código de retirada</label>
            <input id="pickup-code" name="code" required minLength={6} maxLength={6} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="ABC123" style={{ textTransform: "uppercase" }} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          </div>
          <button type="submit" className="btn primary" disabled={busy || !code}>{busy ? "Verificando..." : "Verificar"}</button>
        </form>
      )}
      {preview && (
        <article className="offer">
          <div className="offer-head"><strong>{preview.offer_title}</strong><span className="badge">{preview.offer_kind === "caixa" ? "Caixa surpresa" : "Item"}</span></div>
          <p>{preview.consumer_name} · {price(preview.price_cents, preview.is_free)}</p>
          <p className="muted">Retirada: {formatNoSeconds(preview.pickup_from)} até {formatNoSeconds(preview.pickup_until)}</p>
          <p className="muted">{preview.address_snapshot}</p>
          {preview.box_description && <p>{preview.box_description}</p>}
          {preview.items.length > 0 && (
            <ul>{preview.items.map((it) => <li key={it.item_id}>{it.qty_per_unit} {it.unit} de {it.name}</li>)}</ul>
          )}
          <div className="row actions">
            <button type="button" className="btn primary" disabled={busy} onClick={handleConfirm}>{busy ? "Confirmando..." : "Confirmar retirada"}</button>
            <button type="button" className="btn" disabled={busy} onClick={() => { setPreview(null); }}>Verificar outro código</button>
          </div>
        </article>
      )}
    </section>
  );
}
