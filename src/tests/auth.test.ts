import { beforeAll, describe, expect, test } from "bun:test";
import { app } from "../src/api/index";
import { migrate, truncateAll } from "../src/api/db";

let counter = 0;
function uniqueEmail(): string {
  counter += 1;
  return `fase1-auth-${Date.now()}-${counter}@exemplo.com`;
}

const CPF_OK = "52998224725";

async function signup(body: Record<string, unknown>) {
  return app.request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sessionCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  return setCookie.split(";")[0];
}

beforeAll(async () => { await migrate(); await truncateAll(); });

describe("contas e sessao", () => {
  test("consumidor cria conta com raio e ja sai autenticado", async () => {
    const res = await signup({
      name: "Maria Consumidor",
      cpf: CPF_OK,
      email: uniqueEmail(),
      password: "senha-segura-1",
      role: "consumer",
      search_radius_km: 25,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.role).toBe("consumer");
    expect(body.user.search_radius_km).toBe(25);
    expect(sessionCookie(res)).toMatch(/^xepaja_session=/);

    const me = await app.request("/api/auth/me", {
      headers: { Cookie: sessionCookie(res) },
    });
    expect(me.status).toBe(200);
  });

  test("comerciante cria conta sem raio", async () => {
    const res = await signup({
      name: "Joao Feirante",
      cpf: "11144477735",
      email: uniqueEmail(),
      password: "senha-segura-2",
      role: "merchant",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.role).toBe("merchant");
  });

  test("e-mail duplicado retorna 409", async () => {
    const email = uniqueEmail();
    const first = await signup({ name: "A", cpf: CPF_OK, email, password: "senha-segura-3", role: "consumer", search_radius_km: 10 });
    expect(first.status).toBe(201);
    const second = await signup({ name: "B", cpf: "11144477735", email, password: "senha-segura-4", role: "consumer", search_radius_km: 10 });
    expect(second.status).toBe(409);
    expect((await second.json()).code).toBe("email_in_use");
  });

  test("CPF invalido retorna 400", async () => {
    const res = await signup({ name: "C", cpf: "11111111111", email: uniqueEmail(), password: "senha-segura-5", role: "consumer", search_radius_km: 10 });
    expect(res.status).toBe(400);
  });

  test("raio zero ou acima de 100 retorna 400", async () => {
    for (const radius of [0, -5, 101]) {
      const res = await signup({ name: "D", cpf: CPF_OK, email: uniqueEmail(), password: "senha-segura-6", role: "consumer", search_radius_km: radius });
      expect(res.status).toBe(400);
    }
  });

  test("login com senha errada nao revela o motivo", async () => {
    const email = uniqueEmail();
    await signup({ name: "E", cpf: CPF_OK, email, password: "senha-correta-7", role: "consumer", search_radius_km: 10 });
    const badPass = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "senha-errada" }),
    });
    const unknown = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: uniqueEmail(), password: "qualquer-uma" }),
    });
    expect(badPass.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect((await badPass.json()).message).toBe((await unknown.json()).message);
  });

  test("me sem sessao retorna 401 e logout encerra", async () => {
    const anon = await app.request("/api/auth/me");
    expect(anon.status).toBe(401);

    const res = await signup({ name: "F", cpf: CPF_OK, email: uniqueEmail(), password: "senha-segura-8", role: "consumer", search_radius_km: 10 });
    const cookie = sessionCookie(res);
    const out = await app.request("/api/auth/logout", { method: "POST", headers: { Cookie: cookie } });
    expect(out.status).toBe(200);
    const after = await app.request("/api/auth/me", { headers: { Cookie: cookie } });
    expect(after.status).toBe(401);
  });

  test("atualiza nome e raio; raio invalido falha", async () => {
    const res = await signup({ name: "G", cpf: CPF_OK, email: uniqueEmail(), password: "senha-segura-9", role: "consumer", search_radius_km: 10 });
    const cookie = sessionCookie(res);
    const ok = await app.request("/api/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "G Atualizada", search_radius_km: 50 }),
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).user.name).toBe("G Atualizada");

    const bad = await app.request("/api/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ search_radius_km: 101 }),
    });
    expect(bad.status).toBe(400);
  });

  test("consumidor nao acessa rotas de comerciante", async () => {
    const res = await signup({ name: "H", cpf: CPF_OK, email: uniqueEmail(), password: "senha-segura-10", role: "consumer", search_radius_km: 10 });
    const mine = await app.request("/api/establishments/mine", {
      headers: { Cookie: sessionCookie(res) },
    });
    expect(mine.status).toBe(403);
  });
});
