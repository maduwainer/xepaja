import { Hono } from "hono";
import { createHash, randomInt } from "node:crypto";
import { Resend } from "resend";
import { getDb } from "./db";
import { hashPassword, normalizeEmail, type AppEnv } from "./auth";

export const passwordApp = new Hono<AppEnv>();

const TOKEN_TTL_MS = 60 * 60_000;
// Codigo curto de 5 caracteres para digitar (sem 0/O nem 1/I/l para nao confundir).
const RESET_CODE_LENGTH = 5;
const RESET_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateResetCode(): string {
  let code = "";
  for (let i = 0; i < RESET_CODE_LENGTH; i++) {
    code += RESET_CODE_ALPHABET[randomInt(RESET_CODE_ALPHABET.length)];
  }
  return code;
}

function hashResetCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}
const GENERIC_FORGOT =
  "Se o e-mail estiver cadastrado, enviamos as instrucoes de redefinicao.";
const RESET_URL_BASE = process.env.XEPAJA_URL ?? "http://localhost:3000";
const RESEND_FROM = process.env.RESEND_FROM ?? "contato@xepaja.com";

let resend: Resend | null = null;
function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY ?? "";
  if (!key) return null;
  if (!resend) resend = new Resend(key);
  return resend;
}

async function sendResetEmail(email: string, token: string): Promise<void> {
  const client = getResend();
  if (!client) {
    console.log(`[xepaja] reset de senha para ${email}: use o codigo ${token}`);
    return;
  }
  try {
    const { error } = await client.emails.send({
      from: RESEND_FROM,
      to: email,
      subject: "XepaJa: redefinicao de senha",
      text: `Voce pediu para redefinir sua senha no XepaJa.\n\nSeu codigo (vale por 1 hora):\n${token}\n\nAbra ${RESET_URL_BASE}, vá em Entrar > Esqueci a senha e digite o codigo com a nova senha.\n\nSe nao foi voce, ignore esta mensagem.`,
    });
    if (error) console.error(`[xepaja] falha no envio de reset para ${email}:`, error.message);
  } catch (err) {
    console.error(`[xepaja] falha no envio de reset para ${email}:`, err);
  }
}

function nowISO(): string {
  return new Date().toISOString();
}

// Envio via Resend quando configurado (RESEND_API_KEY); sem chave, o token
// vai para o log do servidor (modo demo/dev). Falha de envio nunca vaza
// existencia da conta: a resposta segue identica (no-oracle).
passwordApp.post("/auth/password/forgot", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const email = normalizeEmail(body?.email);
  if (email) {
    const userRows = await getDb()`SELECT id FROM users WHERE email = ${email}`;
    const user = (userRows[0] as { id: number } | undefined) ?? null;
    if (user) {
      const db = getDb();
      await db`DELETE FROM password_resets WHERE user_id = ${user.id} AND used_at IS NULL`;
      // Garante codigo inedito entre pendentes (a busca do reset e global, sem email).
      let code = "";
      let codeHash = "";
      for (let i = 0; i < 8; i++) {
        code = generateResetCode();
        codeHash = hashResetCode(code);
        const clash = await db`SELECT 1 FROM password_resets WHERE token_hash = ${codeHash} AND used_at IS NULL`;
        if (clash.length === 0) break;
        codeHash = "";
      }
      if (!codeHash) throw new Error("nao foi possivel gerar codigo de reset unico");
      await db`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (${user.id}, ${codeHash}, ${new Date(Date.now() + TOKEN_TTL_MS).toISOString()})`;
      await db`INSERT INTO audit_log (entity, entity_id, action, actor_id) VALUES ('user', ${user.id}, 'password_forgot', ${null})`;
      await sendResetEmail(email, code);
    }
  }
  return c.json({ ok: true, message: GENERIC_FORGOT });
});

// Token unico de uso unico: apos o uso, sessoes antigas morrem.
passwordApp.post("/auth/password/reset", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const token = body && typeof body.token === "string" ? body.token.trim() : "";
  const resetRows = token
    ? await getDb()`SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ${hashResetCode(token)}`
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
  if (password.length > 128) {
    return c.json(
      { ok: false, code: "invalid_password", message: "A senha precisa ter ate 128 caracteres." },
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
