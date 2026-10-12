import { beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { app } from "../src/api/index";
import { getDb, migrate } from "../src/api/db";

let counter = 4000;
function uniqueEmail(): string {
  counter += 1;
  return `fase4-res-${Date.now()}-${counter}@exemplo.com`;
}

const GPS = { lat: -15.6, lng: -56.1 };

function vigenteDates() {
  const now = Date.now();
  return {
    available_from: new Date(now - 3600_000).toISOString(),
    pickup_from: new Date(now - 1800_000).toISOString(),
    pickup_until: new Date(now + 7200_000).toISOString(),
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

async function signupMerchant(): Promise<{ cookie: string; itemId: number }> {
  const signup = await app.request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Dono Oferta",
      cpf: "52998224725",
      email: uniqueEmail(),
      password: "senha-segura-40",
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
  expect(
    (await json("POST", "/api/establishments", {
      name: "Banca Reserva",
      kind: "feira",
      address_text: "Rua Reserva, 1",
      gps_lat: GPS.lat,
      gps_lng: GPS.lng,
    })).status,
  ).toBe(201);
  const item = await json("POST", "/api/items", { name: "caju", unit: "kg" });
  expect(item.status).toBe(201);
  return { cookie, itemId: (await item.json()).item.id };
}

async function signupConsumer(misses = 0): Promise<{ cookie: string; id: number }> {
  const res = await app.request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Reservador",
      cpf: "11144477735",
      email: uniqueEmail(),
      password: "senha-segura-41",
      role: "consumer",
      search_radius_km: 10,
    }),
  });
  expect(res.status).toBe(201);
  const user = (await res.json()).user;
  if (misses > 0) {
    getDb().query("UPDATE users SET misses_since_unblock = ? WHERE id = ?").run(misses, user.id);
  }
  return { cookie: (res.headers.get("set-cookie") ?? "").split(";")[0], id: user.id };
}

async function publishedOffer(cookie: string, itemId: number, total = 4): Promise<number> {
  const created = await app.request("/api/offers", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      title: "Oferta Reserva",
      kind: "item",
      items: [{ item_id: itemId, qty_per_unit: 1 }],
      total_units: total,
      price_cents: 800,
      ...vigenteDates(),
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

function reserve(cookie: string, offerId: number, key = randomUUID()) {
  return app.request("/api/reservations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ offer_id: offerId, idempotency_key: key }),
  });
}

beforeAll(() => migrate());

describe("reservas", () => {
  test("sem faltas confirma direto com codigo e snapshot; segunda ativa falha", async () => {
    const { cookie, itemId } = await signupMerchant();
    const offerId = await publishedOffer(cookie, itemId);
    const consumer = await signupConsumer();

    const res = await reserve(consumer.cookie, offerId);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.reservation.state).toBe("confirmada");
    expect(typeof body.reservation.pickup_code).toBe("string");
    expect(body.reservation.pickup_code).toHaveLength(6);
    expect(body.reservation.price_cents).toBe(800);
    expect(body.reservation.address_snapshot).toBe("Rua Reserva, 1");
    expect(new Date(body.reservation.cancel_before).getTime()).toBeLessThan(
      new Date(body.reservation.pickup_until).getTime(),
    );

    const second = await reserve(consumer.cookie, offerId);
    expect(second.status).toBe(409);
    expect((await second.json()).code).toBe("already_active");
  });

  test("idempotencia: mesma chave nao duplica", async () => {
    const { cookie, itemId } = await signupMerchant();
    const offerId = await publishedOffer(cookie, itemId);
    const consumer = await signupConsumer();
    const key = randomUUID();
    const first = await reserve(consumer.cookie, offerId, key);
    expect(first.status).toBe(201);
    const again = await reserve(consumer.cookie, offerId, key);
    expect(again.status).toBe(200);
    expect((await again.json()).repeated).toBe(true);
    const count = getDb()
      .query("SELECT COUNT(*) AS n FROM reservations WHERE idempotency_key = ?")
      .get(key) as { n: number };
    expect(count.n).toBe(1);
  });

  test("concorrencia: uma unidade, dois pedidos, so um vence", async () => {
    const { cookie, itemId } = await signupMerchant();
    const offerId = await publishedOffer(cookie, itemId, 1);
    const a = await signupConsumer();
    const b = await signupConsumer();
    const [ra, rb] = await Promise.all([
      reserve(a.cookie, offerId),
      reserve(b.cookie, offerId),
    ]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toEqual([201, 409]);
    const count = getDb()
      .query("SELECT COUNT(*) AS n FROM reservations WHERE offer_id = ? AND state = 'confirmada'")
      .get(offerId) as { n: number };
    expect(count.n).toBe(1);
  });

  test("com uma falta fica pendente; aceite confirma com codigo; recusa libera", async () => {
    const { cookie, itemId } = await signupMerchant();
    const offerId = await publishedOffer(cookie, itemId);
    const consumer = await signupConsumer(1);

    const req = await reserve(consumer.cookie, offerId);
    expect(req.status).toBe(201);
    const pending = (await req.json()).reservation;
    expect(pending.state).toBe("pendente");
    expect(pending.pickup_code).toBeUndefined();
    const limit = new Date(pending.pending_expires_at).getTime() - Date.now();
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThanOrEqual(30 * 60_000);

    const incoming = await app.request("/api/reservations/incoming", {
      headers: { Cookie: cookie },
    });
    const list = (await incoming.json()).reservations;
    expect(list).toHaveLength(1);
    expect(list[0].consumer_misses).toBe(1);

    // Recusa sem motivo falha; com motivo libera a unidade.
    const noReason = await app.request(`/api/reservations/${pending.id}/refuse`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({}),
    });
    expect(noReason.status).toBe(400);
    const refused = await app.request(`/api/reservations/${pending.id}/refuse`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ reason: "Sem estoque hoje." }),
    });
    expect(refused.status).toBe(200);

    const notices = await app.request("/api/notices", { headers: { Cookie: consumer.cookie } });
    const kinds = ((await notices.json()).notices as { kind: string }[]).map((n) => n.kind);
    expect(kinds).toContain("request_refused");

    // Unidade liberada: novo pedido volta a ficar pendente.
    const retry = await reserve(consumer.cookie, offerId);
    expect(retry.status).toBe(201);
    const pending2 = (await retry.json()).reservation;
    const accepted = await app.request(`/api/reservations/${pending2.id}/accept`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(accepted.status).toBe(200);
    const acceptedBody = await accepted.json();
    expect(acceptedBody.reservation.state).toBe("confirmada");
    expect(acceptedBody.pickup_code).toHaveLength(6);

    const active = await app.request("/api/reservations/active", {
      headers: { Cookie: consumer.cookie },
    });
    expect((await active.json()).reservation.state).toBe("confirmada");
  });

  test("pendente expirado nao conta falta e libera novo pedido; decisao tardia nao altera", async () => {
    const { cookie, itemId } = await signupMerchant();
    const offerId = await publishedOffer(cookie, itemId);
    const consumer = await signupConsumer(1);
    const req = await reserve(consumer.cookie, offerId);
    const pending = (await req.json()).reservation;

    getDb()
      .query("UPDATE reservations SET pending_expires_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 60_000).toISOString(), pending.id);

    const active = await app.request("/api/reservations/active", {
      headers: { Cookie: consumer.cookie },
    });
    expect((await active.json()).reservation).toBeNull();

    const late = await app.request(`/api/reservations/${pending.id}/accept`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(late.status).toBe(404);

    const history = await app.request("/api/reservations/history", {
      headers: { Cookie: consumer.cookie },
    });
    const hist = (await history.json()).reservations as { state: string; has_photo: boolean }[];
    expect(hist.map((r) => r.state)).toContain("expirada");
    expect(hist.every((r) => r.has_photo)).toBe(true);

    const me = await app.request("/api/auth/me", { headers: { Cookie: consumer.cookie } });
    expect((await me.json()).user.misses_since_unblock).toBe(1);

    const retry = await reserve(consumer.cookie, offerId);
    expect(retry.status).toBe(201);
  });

  test("cancelamento: pendente cancela; confirmada no prazo cancela e fora do prazo falha", async () => {
    const { cookie, itemId } = await signupMerchant();
    const offerId = await publishedOffer(cookie, itemId);
    const consumer = await signupConsumer(1);

    const req = await reserve(consumer.cookie, offerId);
    const pending = (await req.json()).reservation;
    const cancelPending = await app.request(`/api/reservations/${pending.id}/cancel`, {
      method: "POST",
      headers: { Cookie: consumer.cookie },
    });
    expect(cancelPending.status).toBe(200);

    const clean = await signupConsumer();
    const req2 = await reserve(clean.cookie, offerId);
    const confirmed = (await req2.json()).reservation;
    expect(confirmed.state).toBe("confirmada");
    const cancelOk = await app.request(`/api/reservations/${confirmed.id}/cancel`, {
      method: "POST",
      headers: { Cookie: clean.cookie },
    });
    expect(cancelOk.status).toBe(200);

    // Depois do limite de 15 minutos, impede.
    const req3 = await reserve(clean.cookie, offerId);
    const confirmed2 = (await req3.json()).reservation;
    getDb()
      .query("UPDATE reservations SET pickup_until = ? WHERE id = ?")
      .run(new Date(Date.now() + 10 * 60_000).toISOString(), confirmed2.id);
    const tooLate = await app.request(`/api/reservations/${confirmed2.id}/cancel`, {
      method: "POST",
      headers: { Cookie: clean.cookie },
    });
    expect(tooLate.status).toBe(409);
  });

  test("bloqueado nao reserva; terceira falta bloqueia 10 dias", async () => {
    const { cookie, itemId } = await signupMerchant();
    const offerId = await publishedOffer(cookie, itemId);
    const consumer = await signupConsumer();

    const req = await reserve(consumer.cookie, offerId);
    const confirmed = (await req.json()).reservation;
    // Simula tres retiradas perdidas alem da tolerancia.
    getDb().query("UPDATE users SET misses_since_unblock = 2 WHERE id = ?").run(consumer.id);
    getDb()
      .query("UPDATE reservations SET pickup_until = ? WHERE id = ?")
      .run(new Date(Date.now() - 3600_000).toISOString(), confirmed.id);

    const active = await app.request("/api/reservations/active", {
      headers: { Cookie: consumer.cookie },
    });
    const activeBody = await active.json();
    expect(activeBody.reservation).toBeNull();
    expect(activeBody.misses_since_unblock).toBe(3);
    expect(new Date(activeBody.blocked_until).getTime()).toBeGreaterThan(Date.now());

    const blocked = await reserve(consumer.cookie, offerId);
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).code).toBe("blocked");

    const notices = await app.request("/api/notices", { headers: { Cookie: consumer.cookie } });
    const kinds = ((await notices.json()).notices as { kind: string }[]).map((n) => n.kind);
    expect(kinds).toContain("blocked");
  });

  test("comerciante cancela confirmada com motivo sem falta; papeis sao respeitados", async () => {
    const { cookie, itemId } = await signupMerchant();
    const offerId = await publishedOffer(cookie, itemId);
    const consumer = await signupConsumer();
    const req = await reserve(consumer.cookie, offerId);
    const confirmed = (await req.json()).reservation;

    const noReason = await app.request(`/api/reservations/${confirmed.id}/merchant-cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({}),
    });
    expect(noReason.status).toBe(400);
    const cancelled = await app.request(`/api/reservations/${confirmed.id}/merchant-cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ reason: "Feira cancelada pela chuva." }),
    });
    expect(cancelled.status).toBe(200);
    const me = await app.request("/api/auth/me", { headers: { Cookie: consumer.cookie } });
    expect((await me.json()).user.misses_since_unblock).toBe(0);

    // Comerciante nao reserva; consumidor nao aceita.
    const merchantRes = await reserve(cookie, offerId);
    expect(merchantRes.status).toBe(403);
    const consumerAccept = await app.request(`/api/reservations/${confirmed.id}/accept`, {
      method: "POST",
      headers: { Cookie: consumer.cookie },
    });
    expect([403, 404]).toContain(consumerAccept.status);
  });
});
