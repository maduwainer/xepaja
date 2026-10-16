import { beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { app } from "../src/api/index";
import { getDb, migrate, truncateAll } from "../src/api/db";

let counter = 5000;
function uniqueEmail(): string {
  counter += 1;
  return `fase5-pick-${Date.now()}-${counter}@exemplo.com`;
}

const GPS = { lat: -15.6, lng: -56.1 };

function windowAround(nowMs: number, fromMinusMin: number, untilPlusMin: number) {
  return {
    available_from: new Date(nowMs - fromMinusMin * 60_000).toISOString(),
    pickup_from: new Date(nowMs - fromMinusMin * 60_000).toISOString(),
    pickup_until: new Date(nowMs + untilPlusMin * 60_000).toISOString(),
  };
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

async function signup(role: string): Promise<{ cookie: string; id: number }> {
  const res = await app.request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: role === "merchant" ? "Dono Retirada" : "Retirante",
      cpf: role === "merchant" ? "52998224725" : "11144477735",
      email: uniqueEmail(),
      password: "senha-segura-50",
      role,
      ...(role === "consumer" ? { search_radius_km: 10 } : {}),
    }),
  });
  expect(res.status).toBe(201);
  const body = await res.json();
  return { cookie: (res.headers.get("set-cookie") ?? "").split(";")[0], id: body.user.id };
}

async function publishedOffer(cookie: string, total: number): Promise<number> {
  const est = await app.request("/api/establishments", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      name: "Banca Retirada",
      kind: "feira",
      address_text: "Rua Retirada, 5",
      gps_lat: GPS.lat,
      gps_lng: GPS.lng,
    }),
  });
  expect(est.status).toBe(201);
  const item = await app.request("/api/items", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ name: "mamao", unit: "kg" }),
  });
  const itemId = (await item.json()).item.id;
  const created = await app.request("/api/offers", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      title: "Oferta Retirada",
      kind: "item",
      items: [{ item_id: itemId, qty_per_unit: 1 }],
      total_units: total,
      price_cents: 500,
      ...windowAround(Date.now(), 60, 120),
    }),
  });
  expect(created.status).toBe(201);
  const offer = (await created.json()).offer;
  const form = new FormData();
  form.set("photo", pngFile());
  await app.request(`/api/offers/${offer.id}/photo`, { method: "POST", headers: { Cookie: cookie }, body: form });
  const pub = await app.request(`/api/offers/${offer.id}/publish`, { method: "POST", headers: { Cookie: cookie } });
  expect(pub.status).toBe(200);
  return offer.id;
}

function reserve(cookie: string, offerId: number) {
  return app.request("/api/reservations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ offer_id: offerId, idempotency_key: randomUUID() }),
  });
}

function confirmPickup(cookie: string, code: string) {
  return app.request("/api/reservations/pickup/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ code }),
  });
}

beforeAll(async () => { await migrate(); await truncateAll(); });

describe("retirada", () => {
  test("codigo confirma uma vez; reuso e codigo errado falham; estoque segue retido", async () => {
    const merchant = await signup("merchant");
    const offerId = await publishedOffer(merchant.cookie, 2);
    const consumer = await signup("consumer");

    const res = await reserve(consumer.cookie, offerId);
    expect(res.status).toBe(201);
    const code = (await res.json()).reservation.pickup_code as string;

    const ok = await confirmPickup(merchant.cookie, code);
    expect(ok.status).toBe(200);
    const pickup = (await ok.json()).pickup;
    expect(pickup.consumer_name).toBe("Retirante");
    expect(pickup.price_cents).toBe(500);

    // Uso unico: o mesmo codigo nao confirma de novo.
    const reuse = await confirmPickup(merchant.cookie, code);
    expect(reuse.status).toBe(404);
    const wrong = await confirmPickup(merchant.cookie, "XXXXXX");
    expect(wrong.status).toBe(404);
    const empty = await confirmPickup(merchant.cookie, "  ");
    expect(empty.status).toBe(400);

    // Unidade retirada segue consumida: ainda ha 1 de 2 disponivel.
    const detail = await app.request(`/api/offers/${offerId}`, {
      headers: { Cookie: consumer.cookie },
    });
    expect((await detail.json()).offer.remaining_units).toBe(1);

    // Historico do consumidor mostra retirada; aviso chegou.
    const history = await app.request("/api/reservations/history", {
      headers: { Cookie: consumer.cookie },
    });
    const states = ((await history.json()).reservations as { state: string }[]).map((r) => r.state);
    expect(states).toContain("retirada");
    const notices = await app.request("/api/notices", { headers: { Cookie: consumer.cookie } });
    const kinds = ((await notices.json()).notices as { kind: string }[]).map((n) => n.kind);
    expect(kinds).toContain("pickup_confirmed");
  });

  test("multiplas unidades: dois retiram, terceiro nao reserva", async () => {
    const merchant = await signup("merchant");
    const offerId = await publishedOffer(merchant.cookie, 2);
    const a = await signup("consumer");
    const b = await signup("consumer");
    const c = await signup("consumer");

    for (const person of [a, b]) {
      const res = await reserve(person.cookie, offerId);
      expect(res.status).toBe(201);
      const code = (await res.json()).reservation.pickup_code as string;
      expect((await confirmPickup(merchant.cookie, code)).status).toBe(200);
    }
    const third = await reserve(c.cookie, offerId);
    expect(third.status).toBe(409);
    expect((await third.json()).code).toBe("sold_out");
  });

  test("dentro da tolerancia de 15 minutos confirma; alem dela conta falta", async () => {
    const merchant = await signup("merchant");
    const offerId = await publishedOffer(merchant.cookie, 3);

    // Janela terminou ha 10 minutos: ainda dentro da tolerancia.
    const a = await signup("consumer");
    const ra = await reserve(a.cookie, offerId);
    expect(ra.status).toBe(201);
    const ba = await ra.json();
    const rowsA = await getDb()`SELECT id FROM reservations WHERE consumer_id = ${a.id} ORDER BY id DESC LIMIT 1`;
    const rowA = rowsA[0] as { id: number };
    await getDb()`UPDATE reservations SET pickup_until = ${new Date(Date.now() - 10 * 60_000).toISOString()} WHERE id = ${rowA.id}`;
    expect((await confirmPickup(merchant.cookie, ba.reservation.pickup_code)).status).toBe(200);

    // Alem da tolerancia (20 min): expira, conta falta e o codigo morre.
    const b = await signup("consumer");
    const rb = await reserve(b.cookie, offerId);
    expect(rb.status).toBe(201);
    const bb = await rb.json();
    const rowsB = await getDb()`SELECT id FROM reservations WHERE consumer_id = ${b.id} ORDER BY id DESC LIMIT 1`;
    const rowB = rowsB[0] as { id: number };
    await getDb()`UPDATE reservations SET pickup_until = ${new Date(Date.now() - 20 * 60_000).toISOString()} WHERE id = ${rowB.id}`;
    expect((await confirmPickup(merchant.cookie, bb.reservation.pickup_code)).status).toBe(404);
    const me = await app.request("/api/auth/me", { headers: { Cookie: b.cookie } });
    expect((await me.json()).user.misses_since_unblock).toBe(1);
  });

  test("papeis: consumidor nao confirma; comerciante alheio nao confirma", async () => {
    const merchant = await signup("merchant");
    const offerId = await publishedOffer(merchant.cookie, 2);
    const consumer = await signup("consumer");
    const other = await signup("merchant");

    const res = await reserve(consumer.cookie, offerId);
    const code = (await res.json()).reservation.pickup_code as string;

    expect((await confirmPickup(consumer.cookie, code)).status).toBe(403);
    expect((await confirmPickup(other.cookie, code)).status).toBe(404);
    // Codigo segue valido para o dono.
    expect((await confirmPickup(merchant.cookie, code)).status).toBe(200);
  });
});
