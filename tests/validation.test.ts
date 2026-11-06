import { beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { app } from "../src/api/index";
import { getDb, migrate, truncateAll } from "../src/api/db";

// Varredura de validacoes do servidor: todo campo importante rejeita entrada
// invalida com 4xx e codigo estavel. Nao duplica os fluxos felizes das outras
// suites; aqui o foco e fronteira (vazio, longo, enorme, tipo errado).

let counter = 9000;
function uniqueEmail(): string {
  counter += 1;
  return `fase9-val-${Date.now()}-${counter}@exemplo.com`;
}
const CPF_OK = "52998224725";

function post(path: string, body: unknown, cookie?: string) {
  return app.request(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}
function patch(path: string, body: unknown, cookie: string) {
  return app.request(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
}
function cookieOf(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

async function signupConsumer(extra: Record<string, unknown> = {}) {
  const res = await post("/api/auth/signup", {
    name: "Validador",
    cpf: CPF_OK,
    email: uniqueEmail(),
    password: "senha-segura-90",
    role: "consumer",
    ...extra,
  });
  return res;
}

async function merchantFixture() {
  const signup = await post("/api/auth/signup", {
    name: "Dono Val",
    cpf: CPF_OK,
    email: uniqueEmail(),
    password: "senha-segura-91",
    role: "merchant",
  });
  expect(signup.status).toBe(201);
  const cookie = cookieOf(signup);
  const json = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const estab = await json("POST", "/api/establishments", {
    name: "Banca Val",
    kind: "feira",
    address_text: "Rua Val, 1",
    gps_lat: -15.6,
    gps_lng: -56.1,
  });
  expect(estab.status).toBe(201);
  const item = await json("POST", "/api/items", { name: "caju", unit: "kg" });
  expect(item.status).toBe(201);
  return { cookie, itemId: (await item.json()).item.id as number };
}

function vigenteDates() {
  const now = Date.now();
  return {
    available_from: new Date(now - 3600_000).toISOString(),
    pickup_from: new Date(now - 1800_000).toISOString(),
    pickup_until: new Date(now + 7200_000).toISOString(),
  };
}

function offerBody(itemId: number, extra: Record<string, unknown> = {}) {
  return {
    title: "Oferta Val",
    kind: "item",
    items: [{ item_id: itemId, qty_per_unit: 1 }],
    total_units: 5,
    price_cents: 800,
    ...vigenteDates(),
    ...extra,
  };
}

function pngFile(name = "foto.png", type = "image/png", size = 67): File {
  const bytes = new Uint8Array(Math.max(size, 67));
  bytes.set([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1,
    0, 0, 0, 1, 8, 2, 0, 0, 0, 144, 119, 83, 222, 0, 0, 0, 12, 73, 68, 65, 84,
    8, 215, 99, 248, 15, 0, 1, 1, 1, 0, 27, 182, 238, 86, 0, 0, 0, 0, 73, 69,
    78, 68, 174, 66, 96, 130,
  ]);
  return new File([bytes], name, { type });
}

async function publishedOffer(cookie: string, itemId: number): Promise<number> {
  const created = await post("/api/offers", offerBody(itemId), cookie);
  expect(created.status).toBe(201);
  const offer = (await created.json()).offer;
  const form = new FormData();
  form.set("photo", pngFile());
  const up = await app.request(`/api/offers/${offer.id}/photo`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: form,
  });
  expect(up.status).toBe(200);
  const pub = await app.request(`/api/offers/${offer.id}/publish`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  expect(pub.status).toBe(200);
  return offer.id as number;
}

async function consumerWithMisses(misses: number): Promise<{ cookie: string; id: number }> {
  const res = await signupConsumer();
  expect(res.status).toBe(201);
  const user = (await res.json()).user;
  if (misses > 0) {
    await getDb()`UPDATE users SET misses_since_unblock = ${misses} WHERE id = ${user.id}`;
  }
  return { cookie: cookieOf(res), id: user.id as number };
}

beforeAll(async () => { await migrate(); await truncateAll(); });

describe("cadastro valida tudo no servidor", () => {
  test("nome vazio e nome com 121 caracteres falham", async () => {
    for (const name of ["", "   ", "n".repeat(121)]) {
      const res = await signupConsumer({ name, email: uniqueEmail() });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_name");
    }
  });
  test("e-mail invalido e e-mail gigante falham", async () => {
    for (const email of ["sem-arroba", "a@b", "", `a@${"b".repeat(250)}.com`]) {
      const res = await signupConsumer({ email });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_email");
    }
  });
  test("senha com 7 e com 129 caracteres falham", async () => {
    const short = await signupConsumer({ password: "curta-1" });
    expect(short.status).toBe(400);
    expect((await short.json()).code).toBe("invalid_password");
    const long = await signupConsumer({ password: "s".repeat(129) });
    expect(long.status).toBe(400);
    expect((await long.json()).code).toBe("invalid_password");
  });
  test("role desconhecida nao eleva privilegio", async () => {
    const res = await signupConsumer({ role: "admin" });
    expect(res.status).toBe(201);
    expect((await res.json()).user.role).toBe("consumer");
  });
  test("raio abaixo de 10, acima de 100 e nao numerico falham", async () => {
    for (const search_radius_km of [9, 9.9, 101, "grande", NaN]) {
      const res = await signupConsumer({ search_radius_km });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_radius");
    }
  });
});

describe("PATCH /users/me valida tudo", () => {
  test("nome vazio e com 121 caracteres falham", async () => {
    const { cookie } = await consumerWithMisses(0);
    for (const name of ["", "n".repeat(121)]) {
      const res = await patch("/api/users/me", { name }, cookie);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_name");
    }
  });
  test("raio fora de 10..100 falha e comerciante nao usa raio", async () => {
    const { cookie } = await consumerWithMisses(0);
    for (const search_radius_km of [9, 101, "longe"]) {
      const res = await patch("/api/users/me", { search_radius_km }, cookie);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_radius");
    }
    const ok = await patch("/api/users/me", { search_radius_km: 10 }, cookie);
    expect(ok.status).toBe(200);
    const merchant = await post("/api/auth/signup", {
      name: "Dono",
      cpf: CPF_OK,
      email: uniqueEmail(),
      password: "senha-segura-92",
      role: "merchant",
    });
    const mcookie = cookieOf(merchant);
    const denied = await patch("/api/users/me", { search_radius_km: 50 }, mcookie);
    expect(denied.status).toBe(403);
  });
});

describe("estabelecimento e itens validam tudo", () => {
  test("nome, tipo, cnpj, endereco e gps invalidos falham", async () => {
    const signup = await post("/api/auth/signup", {
      name: "Dono Val",
      cpf: CPF_OK,
      email: uniqueEmail(),
      password: "senha-segura-93",
      role: "merchant",
    });
    const cookie = cookieOf(signup);
    const base = { name: "Banca", kind: "feira", address_text: "Rua A, 1" };
    const bad: Record<string, unknown>[] = [
      { ...base, name: "" },
      { ...base, name: "n".repeat(121) },
      { ...base, kind: "bar" },
      { ...base, cnpj: "11111111111111" },
      { ...base, address_text: "  " },
      { ...base, gps_lat: 200, gps_lng: 0 },
      { ...base, gps_lat: "aqui", gps_lng: 0 },
    ];
    for (const body of bad) {
      const res = await post("/api/establishments", body, cookie);
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
    const good = await post("/api/establishments", { ...base, gps_lat: -15.6, gps_lng: -56.1 }, cookie);
    expect(good.status).toBe(201);
    const patchBad = await app.request("/api/establishments/mine", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "n".repeat(121) }),
    });
    expect(patchBad.status).toBe(400);
  });
  test("item sem nome/unidade, longo e delete em uso", async () => {
    const { cookie, itemId } = await merchantFixture();
    const json = (method: string, path: string, body?: unknown) =>
      app.request(path, {
        method,
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    for (const body of [
      { name: "", unit: "kg" },
      { name: "n".repeat(81), unit: "kg" },
      { name: "caju", unit: "" },
      { name: "caju", unit: "u".repeat(21) },
    ]) {
      const res = await json("POST", "/api/items", body);
      expect(res.status).toBe(400);
    }
    const patchLong = await json("PATCH", `/api/items/${itemId}`, { unit: "u".repeat(21) });
    expect(patchLong.status).toBe(400);
    await publishedOffer(cookie, itemId);
    const del = await json("DELETE", `/api/items/${itemId}`);
    expect(del.status).toBe(409);
    expect((await del.json()).code).toBe("item_in_use");
  });
});

describe("ofertas validam tudo", () => {
  test("titulo, tipo, unidades, preco, datas e composicao", async () => {
    const { cookie, itemId } = await merchantFixture();
    const cases: { extra: Record<string, unknown>; code: string }[] = [
      { extra: { title: "  " }, code: "invalid_offer" },
      { extra: { title: "t".repeat(121) }, code: "invalid_offer" },
      { extra: { kind: "servico" }, code: "invalid_offer" },
      { extra: { total_units: 0 }, code: "invalid_offer" },
      { extra: { total_units: 2 ** 31 }, code: "invalid_offer" },
      { extra: { price_cents: -1 }, code: "invalid_offer" },
      { extra: { price_cents: 2 ** 31 }, code: "invalid_offer" },
      { extra: { price_cents: 100, is_free: true }, code: "invalid_offer" },
      { extra: { storage_notes: "n".repeat(201) }, code: "invalid_offer" },
      { extra: { available_from: "ontem" }, code: "invalid_offer" },
      { extra: { items: [] }, code: "invalid_items" },
      { extra: { items: [{ item_id: 999999, qty_per_unit: 1 }] }, code: "invalid_items" },
      { extra: { items: [{ item_id: itemId, qty_per_unit: 0 }] }, code: "invalid_items" },
      { extra: { items: [{ item_id: itemId, qty_per_unit: 1e9 }] }, code: "invalid_items" },
    ];
    for (const { extra, code } of cases) {
      const res = await post("/api/offers", offerBody(itemId, extra), cookie);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe(code);
    }
  });
  test("PATCH com titulo/unidades/preco/notas fora do limite", async () => {
    const { cookie, itemId } = await merchantFixture();
    const created = await post("/api/offers", offerBody(itemId), cookie);
    const id = (await created.json()).offer.id as number;
    for (const [body, code] of [
      [{ title: "t".repeat(121) }, "invalid_title"],
      [{ total_units: 2 ** 31 }, "invalid_units"],
      [{ price_cents: -5 }, "invalid_price"],
      [{ storage_notes: "n".repeat(201) }, "invalid_notes"],
    ] as [Record<string, unknown>, string][]) {
      const res = await app.request(`/api/offers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe(code);
    }
  });
  test("foto com mime errado e gigante, cancel sem motivo e longo", async () => {
    const { cookie, itemId } = await merchantFixture();
    const created = await post("/api/offers", offerBody(itemId), cookie);
    const id = (await created.json()).offer.id as number;
    const txt = new File(["nao-e-imagem"], "foto.txt", { type: "text/plain" });
    const badMime = await app.request(`/api/offers/${id}/photo`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: (() => { const f = new FormData(); f.set("photo", txt); return f; })(),
    });
    expect(badMime.status).toBe(400);
    expect((await badMime.json()).code).toBe("invalid_photo");
    const big = await app.request(`/api/offers/${id}/photo`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: (() => { const f = new FormData(); f.set("photo", pngFile("g.png", "image/png", 6 * 1024 * 1024)); return f; })(),
    });
    expect(big.status).toBe(400);
    expect((await big.json()).code).toBe("photo_too_large");
    const noReason = await app.request(`/api/offers/${id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({}),
    });
    expect(noReason.status).toBe(400);
    const longReason = await app.request(`/api/offers/${id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ reason: "m".repeat(201) }),
    });
    expect(longReason.status).toBe(400);
    expect((await longReason.json()).code).toBe("invalid_reason");
  });
  test("busca com raio 5 e 101 falha", async () => {
    const consumer = await signupConsumer();
    expect(consumer.status).toBe(201);
    const ccookie = cookieOf(consumer);
    for (const radius_km of ["5", "101"]) {
      const res = await app.request(
        `/api/offers/nearby?lat=-15.6&lng=-56.1&radius_km=${radius_km}`,
        { headers: { Cookie: ccookie } },
      );
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_radius");
    }
  });
});

describe("reservas validam tudo", () => {
  test("oferta invalida, sem chave e chave gigante", async () => {
    const { cookie, itemId } = await merchantFixture();
    const offerId = await publishedOffer(cookie, itemId);
    const { cookie: ccookie } = await consumerWithMisses(0);
    const json = (body: unknown) =>
      app.request("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: ccookie },
        body: JSON.stringify(body),
      });
    const badOffer = await json({ offer_id: "abc", idempotency_key: "k1" });
    expect(badOffer.status).toBe(400);
    const noKey = await json({ offer_id: offerId });
    expect((await noKey.json()).code).toBe("idempotency_required");
    const bigKey = await json({ offer_id: offerId, idempotency_key: "k".repeat(121) });
    expect(bigKey.status).toBe(400);
    expect((await bigKey.json()).code).toBe("invalid_idempotency");
  });
  test("recusa e cancelamento exigem motivo de ate 200", async () => {
    const { cookie, itemId } = await merchantFixture();
    const pendente = await publishedOffer(cookie, itemId);
    const c1 = await consumerWithMisses(1);
    const r1 = await app.request("/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: c1.cookie },
      body: JSON.stringify({ offer_id: pendente, idempotency_key: `val-r-${Date.now()}-1` }),
    });
    expect(r1.status).toBe(201);
    const created1 = (await r1.json()).reservation as { state: string; id: number };
    expect(created1.state).toBe("pendente");
    const incomingRes = await app.request("/api/reservations/incoming", { headers: { Cookie: cookie } });
    const pendingId = (await incomingRes.json()) as { reservations: { id: number; state: string }[] };
    const target = pendingId.reservations.find((x) => x.state === "pendente");
    expect(target).toBeDefined();
    for (const body of [{}, { reason: "m".repeat(201) }]) {
      const res = await app.request(`/api/reservations/${target!.id}/refuse`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
    const confirmada = await publishedOffer(cookie, itemId);
    const c2 = await consumerWithMisses(0);
    const r2 = await app.request("/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: c2.cookie },
      body: JSON.stringify({ offer_id: confirmada, idempotency_key: `val-r-${Date.now()}-2` }),
    });
    expect(r2.status).toBe(201);
    const cid = (await r2.json()).reservation.id as number;
    for (const body of [{}, { reason: "m".repeat(201) }]) {
      const res = await app.request(`/api/reservations/${cid}/merchant-cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
  });
  test("retirada com codigo errado falha e minusculo passa", async () => {
    const { cookie, itemId } = await merchantFixture();
    const offerId = await publishedOffer(cookie, itemId);
    const { cookie: ccookie } = await consumerWithMisses(0);
    const r = await app.request("/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ccookie },
      body: JSON.stringify({ offer_id: offerId, idempotency_key: `val-p-${Date.now()}` }),
    });
    expect(r.status).toBe(201);
    const code = (await r.json()).reservation.pickup_code as string;
    expect(code).toHaveLength(6);
    const wrong = await app.request("/api/reservations/pickup/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ code: "XXXXXX" }),
    });
    expect(wrong.status).toBe(404);
    const lower = await app.request("/api/reservations/pickup/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ code: code.toLowerCase() }),
    });
    expect(lower.status).toBe(200);
  });
});

describe("senha e push validam tudo", () => {
  test("forgot com e-mail invalido responde igual e reset com senha gigante falha", async () => {
    const bad = await post("/api/auth/password/forgot", { email: "nao-e-email" });
    expect(bad.status).toBe(200);
    const user = await signupConsumer();
    expect(user.status).toBe(201);
    const uid = (await user.json()).user.id as number;
    const known = "QW7ZX";
    await getDb()`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (${uid}, ${createHash("sha256").update(known).digest("hex")}, ${new Date(Date.now() + 3600_000).toISOString()})`;
    const long = await app.request("/api/auth/password/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: known, new_password: "s".repeat(129) }),
    });
    expect(long.status).toBe(400);
    expect((await long.json()).code).toBe("invalid_password");
  });
  test("push sem endpoint https falha", async () => {
    const { cookie } = await consumerWithMisses(0);
    const res = await post(
      "/api/push/subscribe",
      { endpoint: "http://inseguro/x", keys: { p256dh: "a", auth: "b" } },
      cookie,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_subscription");
  });
});
