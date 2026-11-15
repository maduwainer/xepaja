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

// Mascara 000.000.000-00 para exibicao; o servidor salva so digitos (texto,
// preservando zero a esquerda). Usada no cadastro e coberta por teste unitario.
export function maskCpf(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 11);
  const p1 = d.slice(0, 3);
  const p2 = d.slice(3, 6);
  const p3 = d.slice(6, 9);
  const p4 = d.slice(9, 11);
  let out = p1;
  if (p2) out += `.${p2}`;
  if (p3) out += `.${p3}`;
  if (p4) out += `-${p4}`;
  return out;
}

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
  const [signupCpf, setSignupCpf] = useState("");

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
        const res = await AuthApi.signup(input);
        onAuth(res.user);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha na requisição. Tente de novo.");
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
      setError(err instanceof ApiError ? err.message : "Falha na requisição. Tente de novo.");
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
      setError(err instanceof ApiError ? err.message : "Falha na requisição. Tente de novo.");
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
    mode === "login" ? "Entre no XepaJá"
    : mode === "signup" ? "Crie sua conta"
    : mode === "forgot" ? "Esqueci a senha"
    : "Trocar a senha";
  const subtitle =
    mode === "login" ? "Bom ter você por aqui de novo."
    : mode === "signup" ? "Leva menos de um minuto."
    : mode === "forgot" ? "Vamos te ajudar a voltar."
    : "Use o código de 5 caracteres.";

  return (
    <section aria-labelledby="auth-titulo" className="auth-screen">
      <div className="auth-hero">
        <div className="auth-brand">
          <img src="/logo-x.png" alt="XepaJá" className="auth-x" />
          <span className="auth-name">XepaJá</span>
        </div>
        <p className="auth-slogan">Comida boa. Desperdício zero.</p>
        <p className="auth-sub">Sua feira, mais perto e mais barata.</p>
      </div>
      <div className="card narrow-sm auth-card">
      <h1 id="auth-titulo">{title}</h1>
      <p className="muted auth-subtitle">{subtitle}</p>
      {(mode === "forgot" || mode === "reset") && (
        <div>
          <button type="button" className="btn small" onClick={() => go("login")}>
            Voltar a entrar
          </button>
        </div>
      )}
      {mode === "forgot" && (
        <form onSubmit={handleForgot} className="stack auth-form">
          <p className="muted">Informe o e-mail da conta. A resposta é sempre a mesma, exista a conta ou não.</p>
          <div className="field">
            <label htmlFor="forgot-email">E-mail</label>
            <input id="forgot-email" name="email" type="email" required autoComplete="email" />
          </div>
          {info && <p className="note" aria-live="polite">{info}</p>}
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? "Aguarde..." : "Enviar instruções"}
          </button>
          <button type="button" className="btn" onClick={() => go("reset")}>
            Já tenho um código
          </button>
        </form>
      )}
      {mode === "reset" && (
        <form onSubmit={handleReset} className="stack auth-form">
          <div className="field code">
            <label htmlFor="reset-token">Código recebido (5 letras e números)</label>
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
            <fieldset className="auth-profile">
              <legend>Perfil da conta</legend>
              <label><input type="radio" name="account_role" checked={role === "consumer"} onChange={() => setRole("consumer")} /> Consumidor</label>
              <label><input type="radio" name="account_role" checked={role === "merchant"} onChange={() => setRole("merchant")} /> Comerciante</label>
            </fieldset>
            <div className="field medium">
              <label htmlFor="auth-name">Nome</label>
              <input id="auth-name" name="name" required autoComplete="name" maxLength={120} />
            </div>
            <div className="field short">
              <label htmlFor="auth-cpf">CPF</label>
              <input
                id="auth-cpf"
                name="cpf"
                required
                inputMode="numeric"
                autoComplete="off"
                placeholder="000.000.000-00"
                maxLength={14}
                value={signupCpf}
                onChange={(e) => setSignupCpf(maskCpf(e.target.value))}
              />
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
            placeholder="voce@exemplo.com"
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
        {mode === "login" && (
          <button type="button" className="auth-forgot" onClick={() => go("forgot")}>
            Esqueci minha senha
          </button>
        )}
        <button type="submit" className="btn primary auth-submit" disabled={busy}>
          {busy ? "Aguarde..." : mode === "login" ? "Entrar" : "Criar minha conta"}
        </button>
        <div className="auth-switch">
          <p className="muted">{mode === "login" ? "Ainda não tem conta?" : "Já tem conta?"}</p>
          <button type="button" className="btn auth-switch-button" onClick={() => go(mode === "login" ? "signup" : "login")}>
            {mode === "login" ? "Criar conta" : "Voltar a entrar"}
          </button>
        </div>
      </form>
      )}
      {mode === "login" && isLocalDemo() && (
        <details className="demo">
          <summary>Contas de demonstração: toque para preencher e depois Entrar.</summary>
          <div className="demo-grid" role="group" aria-label="Contas de demonstração">
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
    </div>
    </section>
  );
}
