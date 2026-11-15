import { useEffect, useState } from "react";
import type { UserDTO } from "../shared/types";
import { AuthApi, ApiError, ReservationsApi, NoticesApi } from "./api";
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

export function App() {
  const [me, setMe] = useState<UserDTO | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [view, setView] = useState<View>("buscar");
  const [activeReservations, setActiveReservations] = useState(0);
  const [unreadNotices, setUnreadNotices] = useState(0);
  const [incomingCount, setIncomingCount] = useState(0);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [menuOpen, setMenuOpen] = useState(false);

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
    { id: "reserva", label: activeReservations > 0 ? `Minhas reservas (${activeReservations})` : "Minhas reservas", consumerOnly: true },
    { id: "publicar", label: "Ofertas", merchantOnly: true },
    { id: "solicitacoes", label: incomingCount > 0 ? `Solicitações (${incomingCount})` : "Solicitações", merchantOnly: true },
    { id: "avisos", label: unreadNotices > 0 ? `Avisos (${unreadNotices})` : "Avisos" },
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
        Pular para o conteúdo
      </a>
      <header className="topbar">
        <div className="wrap topbar-inner">
          <div className="topbar-row">
            <div className="brand-wrap">
              <img src="/logo-x.png" alt="" className="brand-x" aria-hidden="true" />
                <p className="brand">XepaJá</p>
              <p className="tagline">Ofertas perto de você, retire no local</p>
            </div>
            {me && merchant && (
              <button type="button" className="retirada-shortcut" aria-label="Ir para retirada" title="Confirmar retirada" onClick={() => { setView("retirada"); setMenuOpen(false); }}>
                <span aria-hidden="true">R</span>
              </button>
            )}
            {me && (
              <button
                type="button"
                className="menu-toggle"
                aria-expanded={menuOpen}
                aria-controls="main-nav"
                aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
                onClick={() => setMenuOpen((o) => !o)}
              >
                <span aria-hidden="true">{menuOpen ? "\u2715" : "\u2630"}</span>
              </button>
            )}
          </div>
          {me && (
            <nav id="main-nav" className={`topnav${menuOpen ? " open" : ""}`} aria-label="Navegacao principal">
              <div role="tablist" aria-label="Telas" className="tabs">
                {visibleViews.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    role="tab"
                    aria-selected={view === v.id}
                    tabIndex={view === v.id ? 0 : -1}
                    className={view === v.id ? "tab active" : "tab"}
                    onClick={() => {
                      setView(v.id);
                      setMenuOpen(false);
                    }}
                  >
                    {v.label}
                  </button>
                ))}
                <button type="button" className="tab logout" onClick={handleLogout}>
                  Sair
                </button>
              </div>
            </nav>
          )}
        </div>
      </header>

      <main id="conteudo" className="wrap">
        {(apiOnline === false || !online) && (
          <div className="status" role="status" aria-live="polite" data-state={!online ? "offline" : undefined}>
            {apiOnline === false && "API fora do ar. Verifique o backend."}
            {!online && " Você está sem conexão: reservas exigem confirmação online."}
          </div>
        )}

        {checkingSession ? (
          <section className="card" aria-live="polite">
            <p>Carregando sessão...</p>
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
            <section aria-labelledby="como-titulo" className="card narrow-sm">
              <h2 id="como-titulo">Como funciona</h2>
              <ol className="steps">
                <li>Comerciante publica oferta com foto, preço e janela de retirada.</li>
                <li>Consumidor busca num raio de até 100 km e reserva uma unidade.</li>
                <li>Retirada presencial com código único, no endereço informado.</li>
              </ol>
              <p className="muted">Pagamento, quando houver, é presencial fora do aplicativo.</p>
            </section>
          </>
        ) : (
          <>

            {view === "conta" && (
              <AccountView user={me} onUser={(u) => setMe(u)} />
            )}
            {view === "estabelecimento" && merchant && <EstablishmentView />}
            {view === "itens" && merchant && <ItemsView />}
            {view === "publicar" && merchant && (<>
              <section aria-label="Atalhos do comerciante" className="card merchant-shortcuts">
                <button type="button" className="btn primary" onClick={() => setView("publicar")}>Ofertas - Visualize todas as suas ofertas.</button>
                <button type="button" className="btn" onClick={() => setView("solicitacoes")}>Solicitações - Visualize todas as solicitações{incomingCount > 0 ? ` (${incomingCount})` : ""}.</button>
              </section>
              <OffersView />
            </>)}
            {view === "buscar" && !merchant && <SearchView user={me} onReserved={() => { setActiveReservations(1); setView("reserva"); }} />}
            {view === "reserva" && !merchant && <ReservationView user={me} onActiveChange={setActiveReservations} />}
            {view === "solicitacoes" && merchant && <IncomingView />}
            {view === "avisos" && <NoticesView />}
            {view === "retirada" && merchant && <PickupView />}
            {view === "retirada" && !merchant && (
              <section className="card" aria-live="polite">
                <h1>Confirmar retirada</h1>
                <p className="muted">A confirmação é feita pelo comerciante no local.</p>
              </section>
            )}
          </>
        )}
      </main>

      <footer className="wrap footer">
        <p>XepaJá, ofertas perto de você.</p>
        <p>© 2026 Bell8 Tecnologia. Todos os direitos reservados.</p>
      </footer>
    </>
  );
}
