import { beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { app } from "../src/api/index";
import { getDb, migrate } from "../src/api/db";

let counter = 7000;
function uniqueEmail(): string {
  counter += 1;
  return `fase6-senha-${Date.now()}-${counter}@exemplo.com`;
}

const GENERIC = "Se o e-mail estiver cadastrado, enviamos as instrucoes de redefinicao.";

async function signup(password = "senha-segura-70"): Promise<{ cookie: string; id: number; email: string }> {
  const email = uniqueEmail();
  const res = await app.request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Esquecido",
      cpf: "39053344705",
      email,
      password,
      role: "consumer",
      search_radius_km: 10,
    }),
  });
  expect(res.status).toBe(201);
  return { cookie: (res.headers.get("set-cookie") ?? "").split(";")[0], id: (await res.json()).user.id, email };
}

function forgot(email: string) {
  return app.request("/api/auth/password/forgot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

function reset(token: string, newPassword: string) {
  return app.request("/api/auth/password/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, new_password: newPassword }),
  });
}

function login(email: string, password: string) {
  return app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

function pendingTokenCount(userId: number): number {
  const row = getDb()
    .query("SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND used_at IS NULL")
    .get(userId) as { n: number };
  return row.n;
}

beforeAll(() => migrate());

describe("recuperacao de senha", () => {
  test("forgot nao revela se o e-mail existe (sem oraculo)", async () => {
    const user = await signup();
    const yes = await forgot(user.email);
    const no = await forgot("ninguem-deste-app@exemplo.com");
    expect(yes.status).toBe(200);
    expect(no.status).toBe(200);
    // Mesma forma de resposta nos dois casos.
    expect(await yes.json()).toEqual({ ok: true, message: GENERIC });
    expect(await no.json()).toEqual({ ok: true, message: GENERIC });
    // So o existente gerou token.
    expect(pendingTokenCount(user.id)).toBe(1);
    const ghost = getDb().query("SELECT id FROM users WHERE email = ?").get("ninguem-deste-app@exemplo.com");
    expect(ghost).toBeNull();
  });

  test("reset com token valido troca a senha, usa uma vez e mata sessoes", async () => {
    const user = await signup();
    await forgot(user.email);
    // Recupera o token real pelo log interno: recria o fluxo lendo o ultimo
    // registro e usando um token invalido antes para provar uso unico depois.
    const row = getDb()
      .query("SELECT token_hash FROM password_resets WHERE user_id = ? ORDER BY id DESC LIMIT 1")
      .get(user.id) as { token_hash: string };
    expect(row.token_hash).toHaveLength(64);

    // Token errado nao revela nada util e nao consome o verdadeiro.
    const wrong = await reset("0".repeat(64), "nova-senha-71");
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).code).toBe("invalid_token");

    // Para concluir o fluxo, gera-se um token conhecido via linha direta:
    // (o token real saiu no log do servidor, fora do alcance do teste)
    const known = "a".repeat(64);
    getDb().query("DELETE FROM password_resets WHERE user_id = ?").run(user.id);
    getDb()
      .query("INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)")
      .run(user.id, createHash("sha256").update(known).digest("hex"), new Date(Date.now() + 3600_000).toISOString());

    const short = await reset(known, "curta");
    expect(short.status).toBe(400);
    expect((await short.json()).code).toBe("invalid_password");

    const ok = await reset(known, "nova-senha-71");
    expect(ok.status).toBe(200);

    // Uso unico.
    const reuse = await reset(known, "outra-senha-72");
    expect(reuse.status).toBe(400);

    // Sessoes antigas morreram; senha nova entra, antiga nao.
    const me = await app.request("/api/auth/me", { headers: { Cookie: user.cookie } });
    expect(me.status).toBe(401);
    expect((await login(user.email, "senha-segura-70")).status).toBe(401);
    const fresh = await login(user.email, "nova-senha-71");
    expect(fresh.status).toBe(200);
  });

  test("token expirado e rejeitado", async () => {
    const user = await signup();
    const known = "b".repeat(64);
    getDb()
      .query("INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)")
      .run(user.id, createHash("sha256").update(known).digest("hex"), new Date(Date.now() - 1000).toISOString());
    const res = await reset(known, "nova-senha-73");
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_token");
  });
});
