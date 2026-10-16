import { beforeAll, describe, expect, test } from "bun:test";
import { app } from "../src/api/index";
import { migrate, truncateAll } from "../src/api/db";

let counter = 1000;
function uniqueEmail(): string {
  counter += 1;
  return `fase1-estab-${Date.now()}-${counter}@exemplo.com`;
}

async function merchantCookie(): Promise<string> {
  const res = await app.request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Feirante Teste",
      cpf: "39053344705",
      email: uniqueEmail(),
      password: "senha-segura-11",
      role: "merchant",
    }),
  });
  expect(res.status).toBe(201);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

async function authed(cookie: string, path: string, init?: RequestInit): Promise<Response> {
  return app.request(path, {
    ...init,
    headers: { "Content-Type": "application/json", Cookie: cookie, ...(init?.headers ?? {}) },
  });
}

beforeAll(async () => { await migrate(); await truncateAll(); });

describe("estabelecimento e itens", () => {
  test("sem estabelecimento, can_publish e falso com motivo", async () => {
    const cookie = await merchantCookie();
    const res = await authed(cookie, "/api/establishments/mine");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.establishment).toBeNull();
    expect(body.can_publish).toBe(false);
    expect(typeof body.publish_block_reason).toBe("string");
  });

  test("cria sem GPS: can_publish continua falso", async () => {
    const cookie = await merchantCookie();
    const res = await authed(cookie, "/api/establishments", {
      method: "POST",
      body: JSON.stringify({
        name: "Banca Central",
        kind: "feira",
        address_text: "Rua das Flores, 100",
        reference: "perto da praca",
        hours: "seg a sab, 7h as 13h",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.can_publish).toBe(false);
  });

  test("cria com GPS: can_publish verdadeiro", async () => {
    const cookie = await merchantCookie();
    const res = await authed(cookie, "/api/establishments", {
      method: "POST",
      body: JSON.stringify({
        name: "Mercearia Boa",
        kind: "mercearia",
        cnpj: "11222333000181",
        address_text: "Av. Central, 200",
        gps_lat: -15.6,
        gps_lng: -56.1,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.can_publish).toBe(true);
    expect(body.establishment.gps_lat).toBe(-15.6);
  });

  test("segundo estabelecimento retorna 409", async () => {
    const cookie = await merchantCookie();
    const payload = { name: "Banca", kind: "feira", address_text: "Rua A, 1" };
    const first = await authed(cookie, "/api/establishments", { method: "POST", body: JSON.stringify(payload) });
    expect(first.status).toBe(201);
    const second = await authed(cookie, "/api/establishments", { method: "POST", body: JSON.stringify(payload) });
    expect(second.status).toBe(409);
  });

  test("trocar endereco sem GPS retorna 422; com GPS funciona", async () => {
    const cookie = await merchantCookie();
    await authed(cookie, "/api/establishments", {
      method: "POST",
      body: JSON.stringify({ name: "Banca", kind: "feira", address_text: "Rua A, 1", gps_lat: -15.6, gps_lng: -56.1 }),
    });
    const noGps = await authed(cookie, "/api/establishments/mine", {
      method: "PATCH",
      body: JSON.stringify({ address_text: "Rua B, 2" }),
    });
    expect(noGps.status).toBe(422);

    const withGps = await authed(cookie, "/api/establishments/mine", {
      method: "PATCH",
      body: JSON.stringify({ address_text: "Rua B, 2", gps_lat: -15.61, gps_lng: -56.11 }),
    });
    expect(withGps.status).toBe(200);
    expect((await withGps.json()).establishment.address_text).toBe("Rua B, 2");
  });

  test("CNPJ invalido retorna 400", async () => {
    const cookie = await merchantCookie();
    const res = await authed(cookie, "/api/establishments", {
      method: "POST",
      body: JSON.stringify({ name: "Banca", kind: "feira", address_text: "Rua A, 1", cnpj: "123" }),
    });
    expect(res.status).toBe(400);
  });

  test("itens: exige estabelecimento, CRUD funciona, outro comerciante nao enxerga", async () => {
    const cookieA = await merchantCookie();
    const noEstab = await authed(cookieA, "/api/items");
    expect(noEstab.status).toBe(404);

    await authed(cookieA, "/api/establishments", {
      method: "POST",
      body: JSON.stringify({ name: "Banca", kind: "feira", address_text: "Rua A, 1" }),
    });
    const created = await authed(cookieA, "/api/items", {
      method: "POST",
      body: JSON.stringify({ name: "banana", unit: "kg" }),
    });
    expect(created.status).toBe(201);
    const item = (await created.json()).item;

    const list = await authed(cookieA, "/api/items");
    expect((await list.json()).items).toHaveLength(1);

    const updated = await authed(cookieA, `/api/items/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ unit: "duzia" }),
    });
    expect((await updated.json()).item.unit).toBe("duzia");

    const cookieB = await merchantCookie();
    await authed(cookieB, "/api/establishments", {
      method: "POST",
      body: JSON.stringify({ name: "Outra", kind: "feira", address_text: "Rua C, 3" }),
    });
    const foreign = await authed(cookieB, `/api/items/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ unit: "un" }),
    });
    expect(foreign.status).toBe(404);

    const removed = await authed(cookieA, `/api/items/${item.id}`, { method: "DELETE" });
    expect(removed.status).toBe(200);
    const after = await authed(cookieA, "/api/items");
    expect((await after.json()).items).toHaveLength(0);
  });
});
