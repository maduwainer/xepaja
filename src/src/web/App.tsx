import { useEffect, useState } from "react";
import type { UserDTO } from "../shared/types";
import { AuthApi, ApiError, ReservationsApi } from "./api";
import { AuthForm } from "./AuthForm";
import { AccountView } from "./AccountView";
import { EstablishmentView } from "./EstablishmentView";
import { ItemsView } from "./ItemsView";
import { OffersView } from "./OffersView";
import { SearchView } from "./SearchView";
import { ReservationView } from "./ReservationView";
import { IncomingView } from "./IncomingView";
import { NoticesView } from "./NoticesView";
import { PickupView } from "./PickupView";

type View =
  | "buscar"
  | "reserva"
  | "publicar"
  | "solicitacoes"
  | "avisos"
  | "retirada"
  | "conta"
  | "estabelecimento"
  | "itens";

const PHASE_NOTE: Record<string, string> = {
  buscar: "Busca por raio entra na Fase 3.",
  reserva: "Reservas entram na Fase 4.",
  publicar: "Publicacao de ofertas entra na Fase 2.",
  retirada: "Retirada com codigo entra na Fase 5.",
};

export function App() {
  const [me, setMe] = useState<UserDTO | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [view, setView] = useState<View>("buscar");
  const [activeReservations, setActiveReservations] = useState(0);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    AuthApi.me()
      .then((res) => {
        setMe(res.user);
        setApiOnline(true);
        setView(defaultViewFor(res.user.role));
      })
      .catch((err) => {
        // 401 significa API no ar sem sessao; so falha de rede e API fora do ar.
        setApiOnline(err instanceof ApiError ? true : false);
      })
      .finally(() => setCheckingSession(false));
  }, []);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  async function handleLogout() {
    try {
      await AuthApi.logout();
    } catch {
      // Mesmo com falha de rede, sai da tela local.
    }
    setMe(null);
    setView("buscar");
  }

  function defaultViewFor(role: UserDTO["role"]): View {
    return role === "merchant" ? "publicar" : "buscar";
  }

  const merchant = me?.role === "merchant";

  useEffect(() => {
    // Selo de ativas no nav do consumidor: no maximo 1 por regra de negocio.
    if (!me || me.role !== "consumer") {
      setActiveReservations(0);
      return;
    }
    ReservationsApi.active()
      .then((res) => setActiveReservations(res.reservation ? 1 : 0))
      .catch(() => setActiveReservations(0));
  }, [me, view]);
  const views: { id: View; label: string; merchantOnly?: boolean; consumerOnly?: boolean }[] = [
    { id: "buscar", label: "Buscar", consumerOnly: true },
    { id: "reserva", label: activeReservations > 0 ? `Minha reserva (${activeReservations})` : "Minha reserva", consumerOnly: true },
    { id: "publicar", label: "Ofertas", merchantOnly: true },
    { id: "solicitacoes", label: "Solicitacoes", merchantOnly: true },
    { id: "avisos", label: "Avisos" },
    { id: "retirada", label: "Retirada", merchantOnly: true },
    { id: "conta", label: "Conta" },
    { id: "estabelecimento", label: "Estabelecimento", merchantOnly: true },
    { id: "itens", label: "Itens", merchantOnly: true },
  ];
  const visibleViews = views.filter(
    (v) =>
      (!v.merchantOnly || merchant) &&
      (!v.consumerOnly || !merchant) &&
      (me || v.id === "buscar"),
  );

  return (
    <>
      <a className="skip-link" href="#conteudo">
        Pular para o conteudo
      </a>
      <header className="topbar">
        <div className="wrap topbar-inner">
          <p className="brand">XepaJá</p>
          <p className="tagline">Ofertas perto de voce, retire no local</p>
        </div>
      </header>

      <main id="conteudo" className="wrap">
        <div className="status" role="status" aria-live="polite">
          {apiOnline === null && "Verificando API..."}
          {apiOnline === true && "API conectada."}
          {apiOnline === false && "API fora do ar. Verifique o backend."}
          {!online && " Voce esta sem conexao: reservas exigem confirmacao online."}
        </div>

        {checkingSession ? (
          <section className="card" aria-live="polite">
            <p>Carregando sessao...</p>
          </section>
        ) : !me ? (
          <>
            <AuthForm
              onAuth={(user) => {
                setMe(user);
                setApiOnline(true);
                setView(defaultViewFor(user.role));
              }}
            />
            <section aria-labelledby="como-titulo" className="card">
              <h2 id="como-titulo">Como funciona</h2>
              <ol className="steps">
                <li>Comerciante publica oferta com foto, preco e janela de retirada.</li>
                <li>Consumidor busca num raio de ate 100 km e reserva uma unidade.</li>
                <li>Retirada presencial com codigo unico, no endereco informado.</li>
              </ol>
              <p className="muted">Pagamento, quando houver, e presencial fora do aplicativo.</p>
            </section>
          </>
        ) : (
          <>
            <nav className="card nav" aria-label="Navegacao principal">
              <div className="row" role="group" aria-label="Telas">
                {visibleViews.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className={view === v.id ? "btn primary" : "btn"}
                    aria-pressed={view === v.id}
                    onClick={() => setView(v.id)}
                  >
                    {v.label}
                  </button>
                ))}
                <button type="button" className="btn" onClick={handleLogout}>
                  Sair ({me.name.split(" ")[0]})
                </button>
              </div>
            </nav>

            {view === "conta" && (
              <AccountView user={me} onUser={(u) => setMe(u)} />
            )}
            {view === "estabelecimento" && merchant && <EstablishmentView />}
            {view === "itens" && merchant && <ItemsView />}
            {view === "publicar" && merchant && <OffersView />}
            {view === "buscar" && !merchant && <SearchView user={me} onReserved={() => { setActiveReservations(1); setView("reserva"); }} />}
            {view === "reserva" && !merchant && <ReservationView user={me} />}
            {view === "solicitacoes" && merchant && <IncomingView />}
            {view === "avisos" && <NoticesView />}
            {view === "retirada" && merchant && <PickupView />}
            {view === "retirada" && !merchant && (
              <section className="card" aria-live="polite">
                <h1>Confirmar retirada</h1>
                <p className="muted">A confirmacao e feita pelo comerciante no local.</p>
              </section>
            )}
          </>
        )}
      </main>

      <footer className="wrap footer">
        <p>XepaJá, Fase 7. Sem rede nao ha confirmacao de reserva.</p>
      </footer>
    </>
  );
}
