import { useState } from "react";
import { ApiError, PickupApi } from "./api";

interface Done {
  offer_title: string;
  consumer_name: string;
  price_cents: number;
  confirmed_at: string;
}

export function PickupView() {
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // currentTarget so vale sincrono: captura o form antes do await.
    const form = e.currentTarget;
    const code = String(new FormData(form).get("code") ?? "");
    setError(null);
    setBusy(true);
    try {
      const res = await PickupApi.confirm(code);
      setDone(res.pickup);
      form.reset();
    } catch (err) {
      setDone(null);
      setError(err instanceof ApiError ? err.message : "Falha ao confirmar. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="ret-titulo" className="card">
      <h1 id="ret-titulo">Confirmar retirada</h1>
      <p className="muted">
        Peca o codigo ao consumidor e confirme uma vez. Vale ate 15 minutos
        depois do fim da janela; depois disso conta falta automatica.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {done && (
        <div className="note" aria-live="polite">
          <p>
            Retirada confirmada: {done.offer_title} para {done.consumer_name} em{" "}
            {new Date(done.confirmed_at).toLocaleString("pt-BR")}.
          </p>
        </div>
      )}
      <form className="stack" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="pickup-code">Codigo de retirada</label>
          <input
            id="pickup-code"
            name="code"
            required
            minLength={6}
            maxLength={6}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="ABC123"
            style={{ textTransform: "uppercase" }}
          />
        </div>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "Confirmando..." : "Confirmar retirada"}
        </button>
      </form>
    </section>
  );
}
