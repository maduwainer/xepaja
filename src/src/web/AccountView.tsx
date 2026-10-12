import { useState } from "react";
import type { UserDTO } from "../shared/types";
import { ApiError, AuthApi } from "./api";

export function AccountView({ user, onUser }: { user: UserDTO; onUser: (u: UserDTO) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(null);
    setBusy(true);
    try {
      const form = new FormData(e.currentTarget);
      const body: { name?: string; search_radius_km?: number } = {};
      const name = String(form.get("name") ?? "").trim();
      if (name && name !== user.name) body.name = name;
      if (user.role === "consumer") {
        const radius = Number(String(form.get("radius") ?? "").replace(",", "."));
        if (Number.isFinite(radius) && radius !== user.search_radius_km) {
          body.search_radius_km = radius;
        }
      }
      if (Object.keys(body).length === 0) {
        setSaved("Nada para atualizar.");
        return;
      }
      const res = await AuthApi.updateMe(body);
      onUser(res.user);
      setSaved("Dados atualizados.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha na requisicao. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  const blocked = user.blocked_until && new Date(user.blocked_until).getTime() > Date.now();

  return (
    <section aria-labelledby="conta-titulo" className="card">
      <h1 id="conta-titulo">Minha conta</h1>
      <dl className="facts">
        <div>
          <dt>E-mail</dt>
          <dd>{user.email}</dd>
        </div>
        <div>
          <dt>Perfil</dt>
          <dd>{user.role === "merchant" ? "Comerciante" : "Consumidor"}</dd>
        </div>
        {user.role === "consumer" && (
          <div>
            <dt>Faltas desde o ultimo desbloqueio</dt>
            <dd>{user.misses_since_unblock}</dd>
          </div>
        )}
        {blocked && (
          <div>
            <dt>Bloqueio ate</dt>
            <dd>{new Date(user.blocked_until as string).toLocaleString("pt-BR")}</dd>
          </div>
        )}
      </dl>
      <form onSubmit={handleSubmit} className="stack">
        <div className="field">
          <label htmlFor="conta-nome">Nome</label>
          <input id="conta-nome" name="name" defaultValue={user.name} maxLength={120} />
        </div>
        {user.role === "consumer" && (
          <div className="field">
            <label htmlFor="conta-raio">Raio de busca (km, max 100)</label>
            <input
              id="conta-raio"
              name="radius"
              inputMode="decimal"
              autoComplete="off"
              defaultValue={String(user.search_radius_km)}
            />
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="note" aria-live="polite">
            {saved}
          </p>
        )}
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "Salvando..." : "Salvar"}
        </button>
      </form>
    </section>
  );
}
