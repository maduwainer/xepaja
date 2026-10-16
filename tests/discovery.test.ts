import { beforeAll, describe, expect, test } from "bun:test";
import { app } from "../src/api/index";
import { migrate, truncateAll } from "../src/api/db";

let counter = 3000;
function uniqueEmail(): string {
  counter += 1;
  return `fase3-disc-${Date.now()}-${counter}@exemplo.com`;
}

const GPS = { lat: -15.6, lng: -56.1 };

async function signupMerchant(gps = true): Promise<{ cookie: string; itemId: number }> {
  const signup = await app.request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Ofertante Perto",
      cpf: "52998224725",
      email: uniqueEmail(),
      password: "senha-segura-30",
      role: "merchant",
    }),
  });
  expect(signup.status).toBe(201);
  const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0];
  const json = (method: string, path: string, body?: unknown, form?: FormData) =>
    app.request(path, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const estabBody: Record<string, unknown> = {
    name: "Banca Perto",
    kind: "feira",
    address_text: "Rua Perto, 5",
  };
  if (gps) {
    estabBody.gps_lat = GPS.lat;
    estabBody.gps_lng = GPS.lng;
  }
  expect((await json("POST", "/api/establishments", estabBody)).status).toBe(201);
  const item = await json("POST", "/api/items", { name: "alface", unit: "un" });
  expect(item.status).toBe(201);
  return { cookie, itemId: (await item.json()).item.id };
}

async function signupConsumer(): Promise<string> {
  const res = await app.request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Consumidor Perto",
      cpf: "11144477735",
      email: uniqueEmail(),
      password: "senha-segura-31",
      role: "consumer",
      search_radius_km: 10,
    }),
  });
  expect(res.status).toBe(201);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

function pngFile(): File {
  const bytes = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1,
    0, 0, 0, 1, 8, 2, 0, 0, 0, 144, 119, 83, 222, 0, 0, 0, 12, 73, 68, 65, 84,
    8, 215, 99, 248, 15, 0, 1, 1, 1, 0, 27, 182, 238, 86, 0, 0, 0, 0, 73, 69,
    78, 68, 174, 66, 96, 130,
  ]);
  return new File([bytes], "foto.png", { type: "image/png" });
}

function vigenteDates() {
  const now = Date.now();
  return {
    available_from: new Date(now - 3600_000).toISOString(),
    pickup_from: new Date(now - 1800_000).toISOString(),
    pickup_until: new Date(now + 7200_000).toISOString(),
  };
}

async function publishedOffer(cookie: string, itemId: number, extra?: Record<string, unknown>): Promise<number> {
  const created = await app.request("/api/offers", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      title: "Oferta Perto",
      kind: "item",
      items: [{ item_id: itemId, qty_per_unit: 1 }],
      total_units: 4,
      price_cents: 500,
      ...vigenteDates(),
      ...extra,
    }),
  });
  expect(created.status).toBe(201);
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
  return offer.id;
}

beforeAll(async () => { await migrate(); await truncateAll(); });

describe("descoberta", () => {
  test("dentro do raio aparece com distancia; fora nao aparece", async () => {
    const { cookie, itemId } = await signupMerchant();
    const offerId = await publishedOffer(cookie, itemId);
    const consumer = await signupConsumer();

    const near = await app.request(
      `/api/offers/nearby?lat=${GPS.lat}&lng=${GPS.lng}&radius_km=10`,
      { headers: { Cookie: consumer } },
    );
    expect(near.status).toBe(200);
    const nearBody = await near.json();
    const found = (nearBody.offers as { id: number; distance_km: number; merchant_name: string }[]).find(
      (o) => o.id === offerId,
    );
    expect(found).toBeDefined();
    expect(found?.distance_km).toBe(0);
    expect(found?.merchant_name).toBe("Ofertante Perto");

    const far = await app.request(
      `/api/offers/nearby?lat=${GPS.lat + 5}&lng=${GPS.lng}&radius_km=10`,
      { headers: { Cookie: consumer } },
    );
    expect((await far.json()).offers).toHaveLength(0);
  });

  test("raio padrao da conta vale sem parametro; raio invalido falha", async () => {
    const { cookie, itemId } = await signupMerchant();
    await publishedOffer(cookie, itemId);
    const consumer = await signupConsumer();

    const def = await app.request(`/api/offers/nearby?lat=${GPS.lat}&lng=${GPS.lng}`, {
      headers: { Cookie: consumer },
    });
    expect(def.status).toBe(200);
    expect((await def.json()).offers.length).toBeGreaterThan(0);

    for (const bad of ["0", "-3", "101"]) {
      const res = await app.request(
        `/api/offers/nearby?lat=${GPS.lat}&lng=${GPS.lng}&radius_km=${bad}`,
        { headers: { Cookie: consumer } },
      );
      expect(res.status).toBe(400);
    }
  });

  test("sem localizacao, sem auth e oferta expirada ou rascunho nao listam", async () => {
    const { cookie, itemId } = await signupMerchant();
    await publishedOffer(cookie, itemId);
    const consumer = await signupConsumer();

    const noLoc = await app.request("/api/offers/nearby?radius_km=10", {
      headers: { Cookie: consumer },
    });
    expect(noLoc.status).toBe(400);

    const anon = await app.request(`/api/offers/nearby?lat=${GPS.lat}&lng=${GPS.lng}`);
    expect(anon.status).toBe(401);

    // Expirada nao aparece.
    const past = new Date(Date.now() - 7200_000).toISOString();
    const created = await app.request("/api/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        title: "Velha",
        kind: "item",
        items: [{ item_id: itemId, qty_per_unit: 1 }],
        total_units: 2,
        price_cents: 100,
        available_from: new Date(Date.now() - 10800_000).toISOString(),
        pickup_from: new Date(Date.now() - 10800_000).toISOString(),
        pickup_until: past,
      }),
    });
    const old = (await created.json()).offer;
    const form = new FormData();
    form.set("photo", pngFile());
    await app.request(`/api/offers/${old.id}/photo`, { method: "POST", headers: { Cookie: cookie }, body: form });
    expect((await app.request(`/api/offers/${old.id}/publish`, { method: "POST", headers: { Cookie: cookie } })).status).toBe(200);

    const list = await app.request(`/api/offers/nearby?lat=${GPS.lat}&lng=${GPS.lng}&radius_km=10`, {
      headers: { Cookie: consumer },
    });
    const titles = ((await list.json()).offers as { title: string }[]).map((o) => o.title);
    expect(titles).not.toContain("Velha");
  });

  test("detalhe mostra composicao e endereco; rascunho alheio da 404", async () => {
    const { cookie, itemId } = await signupMerchant();
    const offerId = await publishedOffer(cookie, itemId);
    const consumer = await signupConsumer();

    const detail = await app.request(`/api/offers/${offerId}`, {
      headers: { Cookie: consumer },
    });
    expect(detail.status).toBe(200);
    const offer = (await detail.json()).offer;
    expect(offer.items[0].name).toBe("alface");
    expect(offer.address_snapshot).toBe("Rua Perto, 5");
    expect(offer.remaining_units).toBe(4);

    const photo = await app.request(`/api/offers/${offerId}/photo`, {
      headers: { Cookie: consumer },
    });
    expect(photo.status).toBe(200);

    const draft = await app.request("/api/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        title: "Rascunho Secreto",
        kind: "item",
        items: [{ item_id: itemId, qty_per_unit: 1 }],
        total_units: 1,
        price_cents: 100,
        ...vigenteDates(),
      }),
    });
    const draftId = (await draft.json()).offer.id;
    const peek = await app.request(`/api/offers/${draftId}`, {
      headers: { Cookie: consumer },
    });
    expect(peek.status).toBe(404);
    const peekPhoto = await app.request(`/api/offers/${draftId}/photo`, {
      headers: { Cookie: consumer },
    });
    expect(peekPhoto.status).toBe(404);
  });
});
