import { beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { app } from "../src/api/index";
import { getDb, migrate, truncateAll } from "../src/api/db";
import { recreateReservations } from "../tools/recreate-reservations";

function req(cookie: string, path: string, body?: unknown, method = body ? "POST" : "GET") {
  return app.request(path, { method, headers: { Cookie: cookie, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
}
async function user(role: string) {
  const r = await req("", "/api/auth/signup", { name: "Teste Histórico", cpf: "52998224725", email: `history-${randomUUID()}@exemplo.com`, password: "senha-historico-123", role });
  expect(r.status).toBe(201);
  return { cookie: r.headers.get("set-cookie")!.split(";")[0], ...(await r.json()).user };
}
async function setup(misses = 0) {
  const merchant = await user("merchant"), consumer = await user("consumer");
  if (misses) await getDb()`UPDATE users SET misses_since_unblock = ${misses} WHERE id = ${consumer.id}`;
  expect((await req(merchant.cookie, "/api/establishments", { name: "Banca Original", kind: "feira", address_text: "Rua Original, 123", reference: "Portão azul", gps_lat: -15.6, gps_lng: -56.1 })).status).toBe(201);
  const item = (await (await req(merchant.cookie, "/api/items", { name: "banana", unit: "kg" })).json()).item;
  const now = Date.now();
  const offer = (await (await req(merchant.cookie, "/api/offers", { title: "Caixa Original", kind: "caixa", items: [{ item_id: item.id, qty_per_unit: 2 }], total_units: 100, price_cents: 1500, storage_notes: "Manter refrigerado.", box_description: "Caixa teste.", available_from: new Date(now - 3600_000).toISOString(), pickup_from: new Date(now - 1800_000).toISOString(), pickup_until: new Date(now + 7200_000).toISOString() })).json()).offer;
  const form = new FormData(); form.set("photo", Bun.file("public/seed-photos/banana.jpg"));
  expect((await app.request(`/api/offers/${offer.id}/photo`, { method: "POST", headers: { Cookie: merchant.cookie }, body: form })).status).toBe(200);
  expect((await req(merchant.cookie, `/api/offers/${offer.id}/publish`, {})).status).toBe(200);
  const reservation = (await (await req(consumer.cookie, "/api/reservations", { offer_id: offer.id, idempotency_key: randomUUID() })).json()).reservation;
  return { merchant, consumer, offer, item, reservation };
}
beforeAll(async () => { await migrate(); await truncateAll(); });
describe("histórico e detalhes das reservas", () => {
  test("snapshot e foto independem de edições posteriores; código cifrado só para o titular", async () => {
    const { merchant, consumer, offer, item, reservation: r } = await setup();
    const db = getDb();
    const [stored] = await db`SELECT snapshot, pickup_code_encrypted, pickup_code_hash FROM reservations WHERE id = ${r.id}`;
    expect(stored.pickup_code_encrypted).not.toContain(r.pickup_code);
    expect(stored.pickup_code_hash).not.toBe(r.pickup_code);
    const beforePhoto = await (await req(consumer.cookie, `/api/reservations/${r.id}/photo`)).arrayBuffer();
    // Simula alterações futuras: os dados aceitos pelo consumidor não podem mudar.
    await db`UPDATE establishments SET name = 'Banca Alterada', reference = 'Outro portão' WHERE owner_id = ${merchant.id}`;
    await db`UPDATE items SET name = 'Nome Alterado', unit = 'un' WHERE id = ${item.id}`;
    await db`UPDATE offers SET title = 'Oferta Alterada', price_cents = 9999, storage_notes = 'Outras notas', pickup_from = now() WHERE id = ${offer.id}`;
    const form = new FormData(); form.set("photo", Bun.file("public/seed-photos/tomate.jpg"));
    expect((await app.request(`/api/offers/${offer.id}/photo`, { method: "POST", headers: { Cookie: merchant.cookie }, body: form })).status).toBe(409);
    const response = await req(consumer.cookie, `/api/reservations/${r.id}`);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const detail = (await response.json()).reservation;
    expect(detail.offer_title).toBe("Caixa Original"); expect(detail.establishment_name).toBe("Banca Original");
    expect(detail.items[0].name).toBe("banana"); expect(detail.items[0].qty_per_unit).toBe(2);
    expect(detail.reference).toBe("Portão azul"); expect(detail.storage_notes).toBe("Manter refrigerado.");
    expect(detail.price_cents).toBe(1500); expect(detail.pickup_code).toBe(r.pickup_code);
    expect(detail.snapshot).toBeUndefined(); expect(detail.pickup_code_encrypted).toBeUndefined();
    expect(await (await req(consumer.cookie, `/api/reservations/${r.id}/photo`)).arrayBuffer()).toEqual(beforePhoto);
    const stranger = await user("consumer");
    for (const path of [`/api/reservations/${r.id}`, `/api/reservations/${r.id}/photo`]) {
      expect((await req(stranger.cookie, path)).status).toBe(404);
      expect((await req(merchant.cookie, path)).status).toBe(404);
      expect((await req("", path)).status).toBe(401);
    }
    expect((await req(consumer.cookie, `/api/reservations/${r.id}/cancel`, {})).status).toBe(200);
    const terminal = (await (await req(consumer.cookie, `/api/reservations/${r.id}`)).json()).reservation;
    expect(terminal.state).toBe("cancelada"); expect(terminal.pickup_code).toBeUndefined();
    expect((await req(merchant.cookie, "/api/reservations/pickup/confirm", { code: r.pickup_code })).status).toBe(404);
  });
  test("aceite não revela código ao comerciante; consumidor consulta e retirada usa uma vez", async () => {
    const { merchant, consumer, reservation: r } = await setup(1);
    expect(r.state).toBe("confirmada"); expect(r.pickup_code).toHaveLength(6);
    const accepted = await req(merchant.cookie, `/api/reservations/${r.id}/accept`, {});
    expect(accepted.status).toBe(410);
    const detail = (await (await req(consumer.cookie, `/api/reservations/${r.id}`)).json()).reservation;
    expect(detail.pickup_code).toHaveLength(6);
    expect((await req(merchant.cookie, "/api/reservations/pickup/confirm", { code: detail.pickup_code })).status).toBe(200);
    expect((await req(merchant.cookie, "/api/reservations/pickup/confirm", { code: detail.pickup_code })).status).toBe(404);
    const history = (await (await req(consumer.cookie, "/api/reservations/history")).json()).reservations;
    expect(history[0].state).toBe("retirada"); expect(history[0].pickup_code).toBeUndefined();
  });
  test("paginação além de 50, filtros globais e limites inclusivos convertidos pelo cliente", async () => {
    const { consumer, reservation: r } = await setup();
    const db = getDb();
    const [stored] = await db`SELECT snapshot FROM reservations WHERE id = ${r.id}`;
    for (let i = 0; i < 57; i++) {
      await db`INSERT INTO reservations(consumer_id, offer_id, state, idempotency_key, price_cents, address_snapshot, pickup_until, created_at, snapshot)
        VALUES (${consumer.id}, ${r.offer_id}, ${i % 2 ? "recusada" : "cancelada"}, ${randomUUID()}, 1500, 'Rua Original, 123', now(), ${new Date(Date.UTC(2026, 8, 1 + i)).toISOString()}, ${db.json(stored.snapshot)})`;
    }
    const first = await (await req(consumer.cookie, "/api/reservations/history?limit=50")).json();
    expect(first.total).toBe(57); expect(first.reservations.length).toBe(50); expect(first.has_more).toBe(true);
    const next = await (await req(consumer.cookie, "/api/reservations/history?limit=50&offset=50")).json();
    expect(next.reservations.length).toBe(7); expect(next.has_more).toBe(false);
    expect(new Set([...first.reservations, ...next.reservations].map(x => x.id)).size).toBe(57);
    const query = new URLSearchParams({ state: "recusada", from: "2026-09-02T00:00:00.000Z", until: "2026-09-03T00:00:00.000Z" });
    const filtered = await (await req(consumer.cookie, `/api/reservations/history?${query}`)).json();
    expect(filtered.total).toBe(1); expect(filtered.reservations[0].created_at).toBe("2026-09-02T00:00:00.000Z");
    const active = await (await req(consumer.cookie, "/api/reservations/active")).json();
    expect(active.reservation.id).toBe(r.id);
    for (const query of ["state=confirmada", "state=falta", "state=concluida", "from=abc", "from=2026-10-01T00:00:00Z&until=2026-09-01T00:00:00Z", "limit=500", "offset=-1", "offset=1.5"]) {
      expect((await req(consumer.cookie, `/api/reservations/history?${query}`)).status).toBe(400);
    }
  });
  test("reservas legadas não recebem composição ou estabelecimento atuais como se fossem originais", async () => {
    const { consumer, reservation: r } = await setup();
    await getDb()`UPDATE reservations SET snapshot = NULL, pickup_code_encrypted = '' WHERE id = ${r.id}`;
    const legacy = (await (await req(consumer.cookie, `/api/reservations/${r.id}`)).json()).reservation;
    expect(legacy.snapshot_available).toBe(false); expect(legacy.items).toBeNull(); expect(legacy.establishment_name).toBeNull();
    expect(legacy.address_snapshot).toBe("Rua Original, 123"); expect(legacy.pickup_code).toBeUndefined();
  });
  test("recriação explícita preserva quantidade, status, vínculos e cadastros, com snapshots e fotos", async () => {
    const db = getDb();
    const before = await db`SELECT consumer_id, offer_id, state, COUNT(*)::int AS n FROM reservations GROUP BY consumer_id, offer_id, state ORDER BY consumer_id, offer_id, state`;
    const idsBefore = (await db`SELECT id FROM reservations`).map(r => r.id);
    const usersBefore = await db`SELECT id, name, email FROM users ORDER BY id`;
    await recreateReservations(false);
    expect((await db`SELECT id FROM reservations`).map(r => r.id)).toEqual(idsBefore);
    await recreateReservations(true);
    const after = await db`SELECT consumer_id, offer_id, state, COUNT(*)::int AS n FROM reservations GROUP BY consumer_id, offer_id, state ORDER BY consumer_id, offer_id, state`;
    expect([...after]).toEqual([...before]);
    expect([...(await db`SELECT id, name, email FROM users ORDER BY id`)]).toEqual([...usersBefore]);
    for (const r of await db`SELECT id, snapshot, state, pickup_code_encrypted FROM reservations`) {
      expect(idsBefore.includes(r.id)).toBe(false);
      expect(r.snapshot.items.length).toBeGreaterThan(0);
      expect(await Bun.file(r.snapshot.photo_path).exists()).toBe(true);
      expect(typeof r.snapshot.title).toBe("string");
      if (r.state === "confirmada") expect(r.pickup_code_encrypted.length).toBeGreaterThan(6);
    }
    expect((await db`SELECT n.id FROM notices n LEFT JOIN reservations r ON n.reservation_id = r.id WHERE n.reservation_id IS NOT NULL AND r.id IS NULL`).length).toBe(0);
  });
});
