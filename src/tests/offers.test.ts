import { beforeAll, describe, expect, test } from "bun:test";
import { app } from "../src/api/index";
import { migrate } from "../src/api/db";

let counter = 2000;
function uniqueEmail(): string {
  counter += 1;
  return `fase2-offer-${Date.now()}-${counter}@exemplo.com`;
}

async function merchantCookie(opts?: { gps?: boolean }): Promise<{ cookie: string; itemId: number }> {
  const signup = await app.request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Ofertante",
      cpf: "52998224725",
      email: uniqueEmail(),
      password: "senha-segura-20",
      role: "merchant",
    }),
  });
  expect(signup.status).toBe(201);
  const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0];
  const json = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const estabBody: Record<string, unknown> = {
    name: "Banca Ofertas",
    kind: "feira",
    address_text: "Rua das Ofertas, 10",
  };
  if (opts?.gps !== false) {
    estabBody.gps_lat = -15.6;
    estabBody.gps_lng = -56.1;
  }
  const estab = await json("POST", "/api/establishments", estabBody);
  expect(estab.status).toBe(201);
  const item = await json("POST", "/api/items", { name: "banana", unit: "kg" });
  expect(item.status).toBe(201);
  return { cookie, itemId: (await item.json()).item.id };
}

const DATES = {
  available_from: "2026-11-01T07:00:00.000Z",
  pickup_from: "2026-11-01T12:00:00.000Z",
  pickup_until: "2026-11-01T13:00:00.000Z",
};

function offerBody(itemId: number, extra?: Record<string, unknown>) {
  return {
    title: "Caixa da xepa",
    kind: "caixa",
    items: [{ item_id: itemId, qty_per_unit: 2 }],
    total_units: 5,
    price_cents: 1000,
    ...DATES,
    storage_notes: "Manter refrigerado.",
    ...extra,
  };
}

function pngFile(): File {
  // PNG minimo valido de 1x1.
  const bytes = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1,
    0, 0, 0, 1, 8, 2, 0, 0, 0, 144, 119, 83, 222, 0, 0, 0, 12, 73, 68, 65, 84,
    8, 215, 99, 248, 15, 0, 1, 1, 1, 0, 27, 182, 238, 86, 0, 0, 0, 0, 73, 69,
    78, 68, 174, 66, 96, 130,
  ]);
  return new File([bytes], "foto.png", { type: "image/png" });
}

beforeAll(() => migrate());

describe("ofertas", () => {
  test("sem GPS nao cria oferta (422)", async () => {
    const { cookie, itemId } = await merchantCookie({ gps: false });
    const res = await app.request("/api/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(offerBody(itemId)),
    });
    expect(res.status).toBe(422);
  });

  test("cria rascunho e publicar sem foto falha", async () => {
    const { cookie, itemId } = await merchantCookie();
    const created = await app.request("/api/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(offerBody(itemId)),
    });
    expect(created.status).toBe(201);
    const offer = (await created.json()).offer;
    expect(offer.state ?? offer).toBeDefined();
    const pub = await app.request(`/api/offers/${offer.id}/publish`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(pub.status).toBe(422);
    expect((await pub.json()).code).toBe("photo_required");
  });

  test("com foto publica e congela snapshot", async () => {
    const { cookie, itemId } = await merchantCookie();
    const created = await app.request("/api/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(offerBody(itemId)),
    });
    const offer = (await created.json()).offer;
    const form = new FormData();
    form.set("photo", pngFile());
    const photo = await app.request(`/api/offers/${offer.id}/photo`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: form,
    });
    expect(photo.status).toBe(200);
    const pub = await app.request(`/api/offers/${offer.id}/publish`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(pub.status).toBe(200);
    const published = (await pub.json()).offer;
    expect(published.effective_state).toBe("publicada");
    expect(published.remaining_units).toBe(5);
    expect(published.address_snapshot).toBe("Rua das Ofertas, 10");
    expect(published.gps_lat).toBe(-15.6);
    expect(published.items).toHaveLength(1);
  });

  test("foto invalida e rejeitada", async () => {
    const { cookie, itemId } = await merchantCookie();
    const created = await app.request("/api/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(offerBody(itemId)),
    });
    const offer = (await created.json()).offer;
    const form = new FormData();
    form.set("photo", new File(["nao-e-imagem"], "foto.txt", { type: "text/plain" }));
    const res = await app.request(`/api/offers/${offer.id}/photo`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: form,
    });
    expect(res.status).toBe(400);
  });

  test("validacoes de criacao: sem itens, preco negativo, item alheio", async () => {
    const { cookie, itemId } = await merchantCookie();
    const json = (body: unknown) =>
      app.request("/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify(body),
      });
    expect((await json(offerBody(itemId, { items: [] }))).status).toBe(400);
    expect((await json(offerBody(itemId, { price_cents: -5 }))).status).toBe(400);
    expect((await json(offerBody(itemId, { total_units: 0 }))).status).toBe(400);
    expect((await json(offerBody(999999))).status).toBe(400);
  });

  test("retirada antes do inicio impede publicar", async () => {
    const { cookie, itemId } = await merchantCookie();
    const created = await app.request("/api/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(
        offerBody(itemId, {
          available_from: "2026-11-01T12:00:00.000Z",
          pickup_from: "2026-11-01T07:00:00.000Z",
          pickup_until: "2026-11-01T08:00:00.000Z",
        }),
      ),
    });
    expect(created.status).toBe(201);
    const offer = (await created.json()).offer;
    const form = new FormData();
    form.set("photo", pngFile());
    await app.request(`/api/offers/${offer.id}/photo`, { method: "POST", headers: { Cookie: cookie }, body: form });
    const pub = await app.request(`/api/offers/${offer.id}/publish`, { method: "POST", headers: { Cookie: cookie } });
    expect(pub.status).toBe(422);
  });

  test("edita rascunho, encerrar bloqueia novo publish", async () => {
    const { cookie, itemId } = await merchantCookie();
    const created = await app.request("/api/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(offerBody(itemId)),
    });
    const offer = (await created.json()).offer;
    const edited = await app.request(`/api/offers/${offer.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ title: "Caixa atualizada", total_units: 3 }),
    });
    expect(edited.status).toBe(200);
    expect((await edited.json()).offer.title).toBe("Caixa atualizada");

    const closed = await app.request(`/api/offers/${offer.id}/encerrar`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(closed.status).toBe(200);
    const pub = await app.request(`/api/offers/${offer.id}/publish`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(pub.status).toBe(409);
  });

  test("cancelar exige motivo e encerra a oferta", async () => {
    const { cookie, itemId } = await merchantCookie();
    const created = await app.request("/api/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(offerBody(itemId)),
    });
    const offer = (await created.json()).offer;
    const noReason = await app.request(`/api/offers/${offer.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({}),
    });
    expect(noReason.status).toBe(400);
    const cancelled = await app.request(`/api/offers/${offer.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ reason: "Chuva forte, sem feira hoje." }),
    });
    expect(cancelled.status).toBe(200);
    const body = await cancelled.json();
    expect(body.offer.effective_state).toBe("cancelada");
    expect(body.cancelled_reservations).toBe(0);
  });

  test("consumidor nao cria oferta e outro comerciante nao edita", async () => {
    const { cookie, itemId } = await merchantCookie();
    const created = await app.request("/api/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(offerBody(itemId)),
    });
    const offer = (await created.json()).offer;

    const consumerSignup = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Consumidor Ofertas",
        cpf: "11144477735",
        email: uniqueEmail(),
        password: "senha-segura-21",
        role: "consumer",
        search_radius_km: 10,
      }),
    });
    const consumerCookie = (consumerSignup.headers.get("set-cookie") ?? "").split(";")[0];
    const forbidden = await app.request("/api/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: consumerCookie },
      body: JSON.stringify(offerBody(itemId)),
    });
    expect(forbidden.status).toBe(403);

    const other = await merchantCookie();
    const foreign = await app.request(`/api/offers/${offer.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: other.cookie },
      body: JSON.stringify({ title: "Invadida" }),
    });
    expect(foreign.status).toBe(404);
  });

  test("oferta gratis exige preco zero", async () => {
    const { cookie, itemId } = await merchantCookie();
    const bad = await app.request("/api/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(offerBody(itemId, { is_free: true, price_cents: 500 })),
    });
    expect(bad.status).toBe(400);
    const good = await app.request("/api/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(offerBody(itemId, { is_free: true, price_cents: 0 })),
    });
    expect(good.status).toBe(201);
  });
});
