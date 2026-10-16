import { Hono } from "hono";
import { createHash, randomBytes } from "node:crypto";
import { getDb } from "./db";
import { hashPassword, normalizeEmail, type AppEnv } from "./auth";

export const passwordApp = new Hono<AppEnv>();

const TOKEN_TTL_MS = 60 * 60_000;
const GENERIC_FORGOT =
  "Se o e-mail estiver cadastrado, enviamos as instrucoes de redefinicao.";

function nowISO(): string {
  return new Date().toISOString();
}

// Sem oraculo de e-mail: existente ou nao, mesma resposta e mesmo formato.
// Sem provedor de e-mail no MVP, o token vai para o log do servidor;
// em producao, trocar pelo envio de e-mail.
passwordApp.post("/auth/password/forgot", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const email = normalizeEmail(body?.email);
  if (email) {
    const userRows = await getDb()`SELECT id FROM users WHERE email = ${email}`;
    const user = (userRows[0] as { id: number } | undefined) ?? null;
    if (user) {
      const db = getDb();
      await db`DELETE FROM password_resets WHERE user_id = ${user.id} AND used_at IS NULL`;
      const token = randomBytes(32).toString("hex");
      await db`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (${user.id}, ${createHash("sha256").update(token).digest("hex")}, ${new Date(Date.now() + TOKEN_TTL_MS).toISOString()})`;
      await db`INSERT INTO audit_log (entity, entity_id, action, actor_id) VALUES ('user', ${user.id}, 'password_forgot', ${null})`;
      console.log(`[xepaja] reset de senha para ${email}: use o codigo ${token}`);
    }
  }
  return c.json({ ok: true, message: GENERIC_FORGOT });
});

// Token unico de uso unico: apos o uso, sessoes antigas morrem.
passwordApp.post("/auth/password/reset", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const token = body && typeof body.token === "string" ? body.token.trim() : "";
  const resetRows = token
    ? await getDb()`SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ${createHash("sha256").update(token).digest("hex")}`
    : [];
  const row = (resetRows[0] as {
    id: number;
    user_id: number;
    expires_at: string;
    used_at: string | null;
  } | undefined) ?? null;
  if (!row || row.used_at || row.expires_at <= nowISO()) {
    return c.json(
      { ok: false, code: "invalid_token", message: "Codigo invalido ou expirado." },
      400,
    );
  }
  const password = body && typeof body.new_password === "string" ? body.new_password : "";
  if (password.length < 8) {
    return c.json(
      { ok: false, code: "invalid_password", message: "A senha precisa de ao menos 8 caracteres." },
      400,
    );
  }
  const db = getDb();
  await db`UPDATE users SET password_hash = ${await hashPassword(password)} WHERE id = ${row.user_id}`;
  await db`UPDATE password_resets SET used_at = ${nowISO()}::timestamptz WHERE id = ${row.id}`;
  await db`DELETE FROM sessions WHERE user_id = ${row.user_id}`;
  await db`INSERT INTO audit_log (entity, entity_id, action, actor_id) VALUES ('user', ${row.user_id}, 'password_reset', ${row.user_id})`;
  return c.json({ ok: true });
});
