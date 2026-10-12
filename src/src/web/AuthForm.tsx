import { useState } from "react";
import type { Role, UserDTO } from "../shared/types";
import { ApiError, AuthApi, PasswordApi, type SignupInput } from "./api";

const DEMO_ACCOUNTS = [
  { label: "Comercio banca", email: "comercio-banca@exemplo.com", password: "comercio-banca-123" },
  { label: "Comercio feira", email: "comercio-feira@exemplo.com", password: "comercio-feira-123" },
  { label: "Comercio padaria", email: "comercio-padaria@exemplo.com", password: "comercio-padaria-123" },
  { label: "Cliente zeca", email: "cliente-zeca@exemplo.com", password: "cliente-zeca-123" },
  { label: "Cliente maria", email: "cliente-maria@exemplo.com", password: "cliente-maria-123" },
  { label: "Cliente joao", email: "cliente-joao@exemplo.com", password: "cliente-joao-123" },
  { label: "Cliente ana", email: "cliente-ana@exemplo.com", password: "cliente-ana-123" },
  { label: "Cliente beto", email: "cliente-beto@exemplo.com", password: "cliente-beto-123" },
  { label: "Cliente duda", email: "cliente-duda@exemplo.com", password: "cliente-duda-123" },
  { label: "Cliente carlos", email: "cliente-carlos@exemplo.com", password: "cliente-carlos-123" },
];

function isLocalDemo(): boolean {
  // Conveniencia para demonstracao local: em producao o bloco nem aparece.
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

export function AuthForm({ onAuth }: { onAuth: (user: UserDTO) => void }) {
  const [mode, setMode] = useState<"login" | "signup" | "forgot" | "reset">("login");
  const [role, setRole] = useState<Role>("consumer");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const form = new FormData(e.currentTarget);
      if (mode === "login") {
        const res = await AuthApi.login(
          String(form.get("email") ?? ""),
          String(form.get("password") ?? ""),
        );
        onAuth(res.user);
      } else {
        const input: SignupInput = {
          name: String(form.get("name") ?? ""),
          cpf: String(form.get("cpf") ?? ""),
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? ""),
          role,
        };
        if (role === "consumer") {
          const radius = Number(String(form.get("radius") ?? "").replace(",", "."));
          input.search_radius_km = radius;
        }
        const res = await AuthApi.signup(input);
        onAuth(res.user);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha na requisicao. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  async function handleForgot(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const res = await PasswordApi.forgot(String(new FormData(form).get("email") ?? ""));
      setInfo(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha na requisicao. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReset(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await PasswordApi.reset(
        String(data.get("token") ?? ""),
        String(data.get("new_password") ?? ""),
      );
      setInfo("Senha trocada. Entre com a nova senha.");
      form.reset();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha na requisicao. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  function go(m: "login" | "signup" | "forgot" | "reset") {
    setMode(m);
    setError(null);
    setInfo(null);
  }

  const title =
    mode === "login" ? "Entrar"
    : mode === "signup" ? "Criar conta"
    : mode === "forgot" ? "Esqueci a senha"
    : "Trocar a senha";

  return (
    <section aria-labelledby="auth-titulo" className="card">
      <h1 id="auth-titulo">{title}</h1>
      {(mode === "forgot" || mode === "reset") && (
        <div className="row" role="group" aria-label="Voltar ao acesso">
          <button type="button" className="btn" onClick={() => go("login")}>
            Voltar a entrar
          </button>
        </div>
      )}
      {(mode === "login" || mode === "signup") && (
      <div className="row" role="group" aria-label="Acao de acesso">
        <button
          type="button"
          className={mode === "login" ? "btn primary" : "btn"}
          aria-pressed={mode === "login"}
          onClick={() => go("login")}
        >
          Entrar
        </button>
        <button
          type="button"
          className={mode === "signup" ? "btn primary" : "btn"}
          aria-pressed={mode === "signup"}
          onClick={() => go("signup")}
        >
          Criar conta
        </button>
      </div>
      )}
      {mode === "forgot" && (
        <form onSubmit={handleForgot} className="stack">
          <p className="muted">Informe o e-mail da conta. A resposta e sempre a mesma, exista a conta ou nao.</p>
          <div className="field">
            <label htmlFor="forgot-email">E-mail</label>
            <input id="forgot-email" name="email" type="email" required autoComplete="email" />
          </div>
          {info && <p className="note" aria-live="polite">{info}</p>}
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? "Aguarde..." : "Enviar instrucoes"}
          </button>
          <button type="button" className="btn" onClick={() => go("reset")}>
            Ja tenho um codigo
          </button>
        </form>
      )}
      {mode === "reset" && (
        <form onSubmit={handleReset} className="stack">
          <div className="field">
            <label htmlFor="reset-token">Codigo recebido</label>
            <input id="reset-token" name="token" required autoComplete="off" spellCheck={false} />
          </div>
          <div className="field">
            <label htmlFor="reset-password">Nova senha (min 8 caracteres)</label>
            <input id="reset-password" name="new_password" type="password" required minLength={8} autoComplete="new-password" />
          </div>
          {info && <p className="note" aria-live="polite">{info}</p>}
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? "Aguarde..." : "Trocar a senha"}
          </button>
        </form>
      )}
      {(mode === "login" || mode === "signup") && (
      <form onSubmit={handleSubmit} className="stack">
        {mode === "signup" && (
          <>
            <div className="row" role="group" aria-label="Perfil da conta">
              <button
                type="button"
                className={role === "consumer" ? "btn primary" : "btn"}
                aria-pressed={role === "consumer"}
                onClick={() => setRole("consumer")}
              >
                Consumidor
              </button>
              <button
                type="button"
                className={role === "merchant" ? "btn primary" : "btn"}
                aria-pressed={role === "merchant"}
                onClick={() => setRole("merchant")}
              >
                Comerciante
              </button>
            </div>
            <div className="field">
              <label htmlFor="auth-name">Nome</label>
              <input id="auth-name" name="name" required autoComplete="name" maxLength={120} />
            </div>
            <div className="field">
              <label htmlFor="auth-cpf">CPF</label>
              <input
                id="auth-cpf"
                name="cpf"
                required
                inputMode="numeric"
                autoComplete="off"
                placeholder="somente numeros"
              />
            </div>
            {role === "consumer" && (
              <div className="field">
                <label htmlFor="auth-radius">Raio de busca (km, max 100)</label>
                <input
                  id="auth-radius"
                  name="radius"
                  required
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="10"
                />
              </div>
            )}
          </>
        )}
        <div className="field">
          <label htmlFor="auth-email">E-mail</label>
          <input
            id="auth-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={mode === "login" ? loginEmail : undefined}
            onChange={mode === "login" ? (e) => setLoginEmail(e.target.value) : undefined}
          />
        </div>
        <div className="field">
          <label htmlFor="auth-password">Senha</label>
          <input
            id="auth-password"
            name="password"
            type="password"
            required
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={mode === "signup" ? 8 : undefined}
            value={mode === "login" ? loginPassword : undefined}
            onChange={mode === "login" ? (e) => setLoginPassword(e.target.value) : undefined}
          />
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "Aguarde..." : mode === "login" ? "Entrar" : "Criar conta"}
        </button>
        {mode === "login" && (
          <button type="button" className="btn" onClick={() => go("forgot")}>
            Esqueci a senha
          </button>
        )}
      </form>
      )}
      {mode === "login" && isLocalDemo() && (
        <div className="note">
          <p className="muted">Contas de demonstracao: toque para preencher e depois Entrar.</p>
          <div className="row" role="group" aria-label="Contas de demonstracao">
            {DEMO_ACCOUNTS.map((d) => (
              <button
                key={d.email}
                type="button"
                className="btn small"
                onClick={() => {
                  setLoginEmail(d.email);
                  setLoginPassword(d.password);
                  setError(null);
                }}
              >
                {d.label}: {d.email} / {d.password}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
