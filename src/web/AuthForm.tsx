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

function PasswordField({ id, name, label, autoComplete, minLength, value, onChange }: {
  id: string;
  name: string;
  label: string;
  autoComplete: string;
  minLength?: number;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-wrap">
        <input
          id={id}
          name={name}
          type={show ? "text" : "password"}
          required
          autoComplete={autoComplete}
          minLength={minLength}
          value={value}
          onChange={onChange}
        />
        <button
          type="button"
          className="password-toggle"
          aria-pressed={show}
          aria-label={show ? "Ocultar senha" : "Mostrar senha"}
          onClick={() => setShow((s) => !s)}
        >
          {show ? "Ocultar" : "Mostrar"}
        </button>
      </div>
    </div>
  );
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
    mode === "login" ? "Bem-vindo de volta"
    : mode === "signup" ? "Crie sua conta"
    : mode === "forgot" ? "Esqueci a senha"
    : "Trocar a senha";

  return (
    <section aria-labelledby="auth-titulo" className="card narrow-sm">
      {(mode === "login" || mode === "signup") && (
      <div className="tabs auth-tabs" role="tablist" aria-label="Acesso">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "login"}
          tabIndex={mode === "login" ? 0 : -1}
          className={mode === "login" ? "tab active" : "tab"}
          onClick={() => go("login")}
        >
          Entrar
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "signup"}
          tabIndex={mode === "signup" ? 0 : -1}
          className={mode === "signup" ? "tab active" : "tab"}
          onClick={() => go("signup")}
        >
          Criar conta
        </button>
      </div>
      )}
      <h1 id="auth-titulo">{title}</h1>
      {(mode === "forgot" || mode === "reset") && (
        <div>
          <button type="button" className="btn small" onClick={() => go("login")}>
            Voltar a entrar
          </button>
        </div>
      )}
      {mode === "forgot" && (
        <form onSubmit={handleForgot} className="stack auth-form">
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
        <form onSubmit={handleReset} className="stack auth-form">
          <div className="field code">
            <label htmlFor="reset-token">Codigo recebido (5 letras e numeros)</label>
            <input
              id="reset-token"
              name="token"
              required
              minLength={5}
              maxLength={5}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="A3K9P"
              style={{ textTransform: "uppercase" }}
            />
          </div>
          <PasswordField
            id="reset-password"
            name="new_password"
            label="Nova senha (min 8 caracteres)"
            autoComplete="new-password"
            minLength={8}
          />
          {info && <p className="note" aria-live="polite">{info}</p>}
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? "Aguarde..." : "Trocar a senha"}
          </button>
        </form>
      )}
      {(mode === "login" || mode === "signup") && (
      <form onSubmit={handleSubmit} className="stack auth-form">
        {mode === "signup" && (
          <>
            <div className="tabs auth-tabs" role="tablist" aria-label="Perfil da conta">
              <button
                type="button"
                role="tab"
                aria-selected={role === "consumer"}
                tabIndex={role === "consumer" ? 0 : -1}
                className={role === "consumer" ? "tab active" : "tab"}
                onClick={() => setRole("consumer")}
              >
                Consumidor
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={role === "merchant"}
                tabIndex={role === "merchant" ? 0 : -1}
                className={role === "merchant" ? "tab active" : "tab"}
                onClick={() => setRole("merchant")}
              >
                Comerciante
              </button>
            </div>
            <div className="field medium">
              <label htmlFor="auth-name">Nome</label>
              <input id="auth-name" name="name" required autoComplete="name" maxLength={120} />
            </div>
            <div className="row">
            <div className="field short">
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
              <div className="field short">
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
            </div>
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
        <PasswordField
          id="auth-password"
          name="password"
          label="Senha"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          minLength={mode === "signup" ? 8 : undefined}
          value={mode === "login" ? loginPassword : undefined}
          onChange={mode === "login" ? (e) => setLoginPassword(e.target.value) : undefined}
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "Aguarde..." : mode === "login" ? "Entrar na conta" : "Criar minha conta"}
        </button>
        {mode === "login" && (
          <button type="button" className="btn" onClick={() => go("forgot")}>
            Esqueci a senha
          </button>
        )}
      </form>
      )}
      {mode === "login" && isLocalDemo() && (
        <details className="demo">
          <summary>Contas de demonstracao: toque para preencher e depois Entrar na conta.</summary>
          <div className="demo-grid" role="group" aria-label="Contas de demonstracao">
            {DEMO_ACCOUNTS.map((d) => (
              <button
                key={d.email}
                type="button"
                className="btn small"
                title={`${d.email} / ${d.password}`}
                onClick={() => {
                  setLoginEmail(d.email);
                  setLoginPassword(d.password);
                  setError(null);
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
