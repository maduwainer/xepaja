import { createHash, randomBytes } from "node:crypto";
import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { getDb } from "./db";
import type { Role } from "../shared/types";

export const SESSION_COOKIE = "xepaja_session";
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 7);
const SESSION_TTL_MS = SESSION_TTL_DAYS * 86_400_000;

export type AppEnv = { Variables: { user: SessionUser } };

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  search_radius_km: number;
  misses_since_unblock: number;
  blocked_until: string | null;
}

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: Role;
  search_radius_km: number;
  misses_since_unblock: number;
  blocked_until: string | null;
}

export function toUserDTO(row: UserRow): SessionUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    search_radius_km: row.search_radius_km,
    misses_since_unblock: row.misses_since_unblock,
    blocked_until: row.blocked_until,
  };
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function checkDigits(digits: string, weights: number[]): boolean {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += Number(digits[i]) * weights[i];
  const mod = sum % 11;
  const expected = mod < 2 ? 0 : 11 - mod;
  return Number(digits[weights.length]) === expected;
}

// CPF com digitos verificadores. Retorna so digitos ou null se invalido.
export function validateCpf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  if (!/^\d{11}$/.test(digits)) return null;
  if (/^(\d)\1{10}$/.test(digits)) return null;
  if (!checkDigits(digits, [10, 9, 8, 7, 6, 5, 4, 3, 2])) return null;
  if (!checkDigits(digits, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2])) return null;
  return digits;
}

// CNPJ opcional com digitos verificadores. String vazia conta como ausente.
export function validateCnpj(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  if (!/^\d{14}$/.test(digits)) return null;
  if (/^(\d)\1{13}$/.test(digits)) return null;
  if (!checkDigits(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])) return null;
  if (!checkDigits(digits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])) return null;
  return digits;
}

// Raio de busca do consumidor: maior que zero e ate 100 km.
export function validateRadius(value: unknown): number | null {
  const num = typeof value === "string" ? Number(value) : value;
  if (typeof num !== "number" || !Number.isFinite(num)) return null;
  if (num <= 0 || num > 100) return null;
  return num;
}

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

export function createSession(userId: number): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  getDb()
    .query(
      "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
    )
    .run(userId, tokenHash, expiresAt.toISOString());
  return { token, expiresAt };
}

export function destroySession(token: string): void {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  getDb().query("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

export function getSessionUser(c: Context): SessionUser | null {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = getDb()
    .query(
      `SELECT u.id, u.name, u.email, u.role, u.search_radius_km,
              u.misses_since_unblock, u.blocked_until, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(tokenHash) as (UserRow & { expires_at: string }) | null;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    destroySession(token);
    return null;
  }
  return toUserDTO(row);
}

export async function requireAuth(c: Context<AppEnv>, next: Next) {
  const user = getSessionUser(c);
  if (!user) {
    return c.json(
      { ok: false, code: "unauthorized", message: "Sessao encerrada. Entre novamente." },
      401,
    );
  }
  c.set("user", user);
  await next();
}

export async function requireMerchant(c: Context<AppEnv>, next: Next) {
  const user = getSessionUser(c);
  if (!user) {
    return c.json(
      { ok: false, code: "unauthorized", message: "Sessao encerrada. Entre novamente." },
      401,
    );
  }
  if (user.role !== "merchant") {
    return c.json(
      { ok: false, code: "forbidden", message: "Operacao restrita ao comerciante." },
      403,
    );
  }
  c.set("user", user);
  await next();
}
