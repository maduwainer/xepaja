import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { getDb } from "./db";
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  getSessionUser,
  hashPassword,
  normalizeEmail,
  requireAuth,
  toUserDTO,
  validateCpf,
  validateRadius,
  verifyPassword,
  type AppEnv,
} from "./auth";

export const usersApp = new Hono<AppEnv>();

const INVALID_LOGIN = "E-mail ou senha invalidos.";

// POST /api/auth/signup
// RF-01: conta com nome, CPF, e-mail e senha. Consumidor informa raio
// maior que zero e ate 100 km e nao cadastra endereco residencial.
usersApp.post("/auth/signup", async (c) => {
  const body = await c.req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = normalizeEmail(body?.email);
  const cpf = validateCpf(body?.cpf);
  const password = typeof body?.password === "string" ? body.password : "";
  const role = body?.role === "merchant" ? "merchant" : "consumer";

  if (!name) {
    return c.json({ ok: false, code: "invalid_name", message: "Informe o nome." }, 400);
  }
  if (!email) {
    return c.json({ ok: false, code: "invalid_email", message: "Informe um e-mail valido." }, 400);
  }
  if (!cpf) {
    return c.json({ ok: false, code: "invalid_cpf", message: "Informe um CPF valido." }, 400);
  }
  if (password.length < 8) {
    return c.json(
      { ok: false, code: "invalid_password", message: "A senha precisa de ao menos 8 caracteres." },
      400,
    );
  }

  let radius = 10;
  if (role === "consumer") {
    const parsed = validateRadius(body?.search_radius_km);
    if (parsed === null) {
      return c.json(
        { ok: false, code: "invalid_radius", message: "Escolha um raio maior que zero e de ate 100 km." },
        400,
      );
    }
    radius = parsed;
  }

  const db = getDb();
  const existing = db.query("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) {
    return c.json(
      { ok: false, code: "email_in_use", message: "Este e-mail ja esta cadastrado." },
      409,
    );
  }

  const passwordHash = await hashPassword(password);
  const row = db
    .query(
      `INSERT INTO users (name, cpf, email, password_hash, role, search_radius_km)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id, name, email, role,
       search_radius_km, misses_since_unblock, blocked_until`,
    )
    .get(name, cpf, email, passwordHash, role, radius) as Parameters<typeof toUserDTO>[0];

  const { token, expiresAt } = createSession(row.id);
  const maxAge = Math.max(60, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge,
    secure: process.env.COOKIE_SECURE === "1",
  });
  return c.json({ ok: true, user: toUserDTO(row) }, 201);
});

// POST /api/auth/login. Mensagem generica para nao revelar se o e-mail existe.
usersApp.post("/auth/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) {
    return c.json({ ok: false, code: "invalid_credentials", message: INVALID_LOGIN }, 401);
  }
  const row = getDb()
    .query("SELECT * FROM users WHERE email = ?")
    .get(email) as (Parameters<typeof toUserDTO>[0] & { password_hash: string }) | null;
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    return c.json({ ok: false, code: "invalid_credentials", message: INVALID_LOGIN }, 401);
  }
  const { token, expiresAt } = createSession(row.id);
  const maxAge = Math.max(60, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge,
    secure: process.env.COOKIE_SECURE === "1",
  });
  return c.json({ ok: true, user: toUserDTO(row) });
});

// POST /api/auth/logout. RF-02: encerrar a sessao.
usersApp.post("/auth/logout", (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) destroySession(token);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

usersApp.get("/auth/me", requireAuth, (c) => {
  return c.json({ ok: true, user: c.get("user") });
});

// PATCH /api/users/me. RF-03: consultar e atualizar nome e dados de contato.
// Contato editavel aqui: nome e, para o consumidor, o raio de busca.
usersApp.patch("/users/me", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ ok: false, code: "invalid_body", message: "Nada para atualizar." }, 400);
  }

  const updates: string[] = [];
  const params: (string | number)[] = [];

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return c.json({ ok: false, code: "invalid_name", message: "Informe o nome." }, 400);
    }
    updates.push("name = ?");
    params.push(name);
  }

  if (body.search_radius_km !== undefined) {
    if (user.role !== "consumer") {
      return c.json(
        { ok: false, code: "radius_consumer_only", message: "Raio de busca e do perfil consumidor." },
        400,
      );
    }
    const radius = validateRadius(body.search_radius_km);
    if (radius === null) {
      return c.json(
        { ok: false, code: "invalid_radius", message: "Escolha um raio maior que zero e de ate 100 km." },
        400,
      );
    }
    updates.push("search_radius_km = ?");
    params.push(radius);
  }

  if (updates.length === 0) {
    return c.json({ ok: false, code: "invalid_body", message: "Nada para atualizar." }, 400);
  }

  params.push(user.id);
  const updated = getDb()
    .query(
      `UPDATE users SET ${updates.join(", ")},
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ? RETURNING id, name, email, role,
       search_radius_km, misses_since_unblock, blocked_until`,
    )
    .get(...params) as Parameters<typeof toUserDTO>[0];
  return c.json({ ok: true, user: toUserDTO(updated) });
});

export { getSessionUser };
