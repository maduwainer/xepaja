import { Hono } from "hono";
import { mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { getDb, type DbClient } from "./db";
import { requireAuth, requireMerchant, type AppEnv } from "./auth";

export const offersApp = new Hono<AppEnv>();

const UPLOAD_DIR = "data/uploads";
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_MIMES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

interface OfferRow {
  id: number;
  establishment_id: number;
  title: string;
  kind: string;
  photo_path: string;
  total_units: number;
  price_cents: number;
  is_free: boolean;
  address_snapshot: string;
  gps_lat: number | null;
  gps_lng: number | null;
  available_from: string;
  pickup_from: string;
  pickup_until: string;
  storage_notes: string;
  state: string;
  cancel_reason: string;
}

async function getEstablishment(ownerId: number) {
  const rows = await getDb()`SELECT id, address_text, gps_lat, gps_lng FROM establishments WHERE owner_id = ${ownerId}`;
  return (rows[0] as {
    id: number;
    address_text: string;
    gps_lat: number | null;
    gps_lng: number | null;
  } | undefined) ?? null;
}

async function getOwnOffer(estabId: number, offerId: number): Promise<OfferRow | null> {
  const rows = await getDb()`SELECT id, establishment_id, title, kind, photo_path, total_units, price_cents, is_free, address_snapshot, gps_lat, gps_lng, available_from, pickup_from, pickup_until, storage_notes, state, cancel_reason FROM offers WHERE id = ${offerId} AND establishment_id = ${estabId}`;
  return (rows[0] as OfferRow | undefined) ?? null;
}

// RN-01: disponivel = total menos pendentes, confirmadas e retiradas.
export async function remainingUnits(offerId: number, total: number, client?: DbClient): Promise<number> {
  const db = client ?? getDb();
  const rows = await db`SELECT COUNT(*)::int AS n FROM reservations
       WHERE offer_id = ${offerId} AND state IN ('pendente','confirmada','retirada')`;
  return Math.max(0, total - (rows[0] as { n: number }).n);
}

export async function hasActiveReservations(offerId: number): Promise<boolean> {
  const rows = await getDb()`SELECT COUNT(*)::int AS n FROM reservations
       WHERE offer_id = ${offerId} AND state IN ('pendente','confirmada')`;
  return (rows[0] as { n: number }).n > 0;
}

// Esgotada e derivada, nao armazenada: publicada com zero restante exibe esgotada.
export function effectiveState(offer: OfferRow, remaining: number): string {
  if (offer.state === "publicada" && remaining <= 0) return "esgotada";
  return offer.state;
}

async function serializeOffer(offer: OfferRow) {
  const db = getDb();
  const items = await db`SELECT oi.item_id, i.name, i.unit, oi.qty_per_unit
       FROM offer_items oi JOIN items i ON i.id = oi.item_id
       WHERE oi.offer_id = ${offer.id} ORDER BY i.name`;
  const ctxRows = await db`SELECT e.name AS establishment_name, u.name AS merchant_name
       FROM establishments e JOIN users u ON u.id = e.owner_id
       WHERE e.id = ${offer.establishment_id}`;
  const ctx = ctxRows[0] as { establishment_name: string; merchant_name: string };
  const remaining = await remainingUnits(offer.id, offer.total_units);
  return {
    ...offer,
    items,
    remaining_units: remaining,
    effective_state: effectiveState(offer, remaining),
    establishment_name: ctx.establishment_name,
    merchant_name: ctx.merchant_name,
  };
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseDate(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(value).toISOString();
}

// RF-06: ao menos um item com quantidade positiva, de itens do proprio estabelecimento.
async function parseOfferItems(
  estabId: number,
  value: unknown,
): Promise<{ items: { item_id: number; qty_per_unit: number }[]; error: string | null }> {
  if (!Array.isArray(value) || value.length === 0) {
    return { items: [], error: "Inclua ao menos um item com quantidade positiva." };
  }
  const db = getDb();
  const items: { item_id: number; qty_per_unit: number }[] = [];
  for (const entry of value) {
    const itemId =
      typeof entry?.item_id === "string" ? Number(entry.item_id) : entry?.item_id;
    const qty =
      typeof entry?.qty_per_unit === "string"
        ? Number(entry.qty_per_unit)
        : entry?.qty_per_unit;
    if (!Number.isInteger(itemId)) {
      return { items: [], error: "Item invalido na composicao." };
    }
    if (typeof qty !== "number" || !Number.isFinite(qty) || qty <= 0) {
      return { items: [], error: "Quantidade de cada item precisa ser positiva." };
    }
    const owned = (await db`SELECT id FROM items WHERE id = ${itemId} AND establishment_id = ${estabId}`)[0];
    if (!owned) {
      return { items: [], error: "Item invalido na composicao." };
    }
    items.push({ item_id: itemId, qty_per_unit: qty });
  }
  return { items, error: null };
}

function parseCommon(body: Record<string, unknown>): {
  title: string;
  kind: string;
  total_units: number | null;
  price_cents: number | null;
  is_free: boolean;
  available_from: string | null;
  pickup_from: string | null;
  pickup_until: string | null;
  storage_notes: string;
  error: string | null;
} {
  const title = str(body.title);
  const kind = body.kind === "caixa" ? "caixa" : body.kind === "item" ? "item" : "";
  const totalRaw = typeof body.total_units === "string" ? Number(body.total_units) : body.total_units;
  const total_units = typeof totalRaw === "number" && Number.isInteger(totalRaw) ? totalRaw : null;
  const is_free = body.is_free === true || body.is_free === 1 || body.is_free === "true";
  const priceRaw = typeof body.price_cents === "string" ? Number(body.price_cents) : body.price_cents;
  const price_cents = typeof priceRaw === "number" && Number.isInteger(priceRaw) ? priceRaw : null;
  if (!title) return { title, kind, total_units, price_cents, is_free, available_from: null, pickup_from: null, pickup_until: null, storage_notes: "", error: "Informe o titulo da oferta." };
  if (!kind) return { title, kind, total_units, price_cents, is_free, available_from: null, pickup_from: null, pickup_until: null, storage_notes: "", error: "Tipo precisa ser item ou caixa surpresa." };
  if (total_units === null || total_units <= 0) {
    return { title, kind, total_units, price_cents, is_free, available_from: null, pickup_from: null, pickup_until: null, storage_notes: "", error: "Quantidade ofertada precisa ser positiva." };
  }
  if (price_cents === null || price_cents < 0) {
    return { title, kind, total_units, price_cents, is_free, available_from: null, pickup_from: null, pickup_until: null, storage_notes: "", error: "Preco precisa ser zero ou maior." };
  }
  if (is_free && price_cents !== 0) {
    return { title, kind, total_units, price_cents, is_free, available_from: null, pickup_from: null, pickup_until: null, storage_notes: "", error: "Oferta gratis precisa ter preco zero." };
  }
  const available_from = parseDate(body.available_from);
  const pickup_from = parseDate(body.pickup_from);
  const pickup_until = parseDate(body.pickup_until);
  if (!available_from || !pickup_from || !pickup_until) {
    return { title, kind, total_units, price_cents, is_free, available_from, pickup_from, pickup_until, storage_notes: "", error: "Informe datas validas de disponibilidade e retirada." };
  }
  return {
    title, kind, total_units, price_cents, is_free,
    available_from, pickup_from, pickup_until,
    storage_notes: str(body.storage_notes), error: null,
  };
}

// RF-05/06/11: criacao como rascunho. Exige GPS do estabelecimento (can_publish).
offersApp.post("/offers", requireMerchant, async (c) => {
  const user = c.get("user");
  const estab = await getEstablishment(user.id);
  if (!estab) {
    return c.json(
      { ok: false, code: "no_establishment", message: "Cadastre o estabelecimento antes das ofertas." },
      404,
    );
  }
  if (estab.gps_lat === null || estab.gps_lng === null) {
    return c.json(
      { ok: false, code: "gps_required", message: "Registre a posicao GPS no local de retirada antes de publicar ofertas." },
      422,
    );
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return c.json({ ok: false, code: "invalid_body", message: "Informe os dados da oferta." }, 400);
  }
  const common = parseCommon(body);
  if (common.error) {
    return c.json({ ok: false, code: "invalid_offer", message: common.error }, 400);
  }
  const parsedItems = await parseOfferItems(estab.id, body.items);
  if (parsedItems.error) {
    return c.json({ ok: false, code: "invalid_items", message: parsedItems.error }, 400);
  }

  const db = getDb();
  const offer = await db.begin(async (tx) => {
    const inserted = await tx`INSERT INTO offers
         (establishment_id, title, kind, total_units, price_cents, is_free,
          address_snapshot, gps_lat, gps_lng,
          available_from, pickup_from, pickup_until, storage_notes, state)
         VALUES (${estab.id}, ${common.title}, ${common.kind}, ${common.total_units},
          ${common.price_cents}, ${common.is_free}, ${estab.address_text},
          ${estab.gps_lat}, ${estab.gps_lng}, ${common.available_from},
          ${common.pickup_from}, ${common.pickup_until}, ${common.storage_notes}, 'rascunho')
         RETURNING id, establishment_id, title, kind, photo_path, total_units, price_cents, is_free, address_snapshot, gps_lat, gps_lng, available_from, pickup_from, pickup_until, storage_notes, state, cancel_reason`;
    const created = inserted[0] as OfferRow;
    for (const it of parsedItems.items) {
      await tx`INSERT INTO offer_items (offer_id, item_id, qty_per_unit) VALUES (${created.id}, ${it.item_id}, ${it.qty_per_unit})`;
    }
    await tx`INSERT INTO audit_log (entity, entity_id, action, actor_id) VALUES ('offer', ${created.id}, 'created', ${user.id})`;
    return created;
  });
  return c.json({ ok: true, offer: await serializeOffer(offer) }, 201);
});

offersApp.get("/offers/mine", requireMerchant, async (c) => {
  const estab = await getEstablishment(c.get("user").id);
  if (!estab) return c.json({ ok: true, offers: [] });
  const offers = await getDb()`SELECT id, establishment_id, title, kind, photo_path, total_units, price_cents, is_free, address_snapshot, gps_lat, gps_lng, available_from, pickup_from, pickup_until, storage_notes, state, cancel_reason FROM offers WHERE establishment_id = ${estab.id} ORDER BY id DESC` as OfferRow[];
  return c.json({ ok: true, offers: await Promise.all(offers.map(serializeOffer)) });
});

// Distancia estimada em km (haversine). RN-09: a partir da localizacao atual
// do consumidor e do GPS registrado do estabelecimento.
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// RF-12/13/18: ofertas vigentes dentro do raio a partir da localizacao atual.
// Vigente = publicada, com janela de oferta aberta e retirada ainda nao terminada.
// A posicao do consumidor vem so por query e nunca e persistida.
// Esgotadas (restante zero) nao aparecem como disponiveis.
offersApp.get("/offers/nearby", requireAuth, async (c) => {
  const user = c.get("user");
  const lat = Number(c.req.query("lat"));
  const lng = Number(c.req.query("lng"));
  if (
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    lat < -90 || lat > 90 || lng < -180 || lng > 180
  ) {
    return c.json(
      { ok: false, code: "location_required", message: "Informe sua localizacao atual para buscar por proximidade." },
      400,
    );
  }
  const rawRadius = c.req.query("radius_km");
  const radius = rawRadius === undefined ? user.search_radius_km : Number(rawRadius);
  if (!Number.isFinite(radius) || radius <= 0 || radius > 100) {
    return c.json(
      { ok: false, code: "invalid_radius", message: "Escolha um raio maior que zero e de ate 100 km." },
      400,
    );
  }

  const now = new Date().toISOString();
  const latDelta = radius / 111;
  const lngDelta = radius / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const rows = await getDb()`SELECT o.* FROM offers o
       WHERE o.state = 'publicada'
         AND o.available_from <= ${now}::timestamptz AND o.pickup_until >= ${now}::timestamptz
         AND o.gps_lat BETWEEN ${lat - latDelta} AND ${lat + latDelta}
         AND o.gps_lng BETWEEN ${lng - lngDelta} AND ${lng + lngDelta}` as OfferRow[];

  const withDistance = rows
    .map((offer) => {
      const distance_km =
        offer.gps_lat === null || offer.gps_lng === null
          ? Number.POSITIVE_INFINITY
          : haversineKm(lat, lng, offer.gps_lat, offer.gps_lng);
      return { offer, distance_km };
    })
    .filter(({ distance_km }) => distance_km <= radius);
  const available = (
    await Promise.all(
      withDistance.map(async ({ offer, distance_km }) => ({
        offer,
        distance_km,
        remaining: await remainingUnits(offer.id, offer.total_units),
      })),
    )
  )
    .filter(({ remaining }) => remaining > 0)
    .sort((a, b) => a.distance_km - b.distance_km);
  const nearby = await Promise.all(
    available.map(async ({ offer, distance_km }) => ({
      ...(await serializeOffer(offer)),
      distance_km: Math.round(distance_km * 10) / 10,
    })),
  );
  return c.json({ ok: true, offers: nearby });
});

// RF-14: detalhe com foto, composicao, disponibilidade, preco, endereco,
// periodo e orientacoes. Rascunho de outro so o dono ve.
offersApp.get("/offers/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const offerId = Number(c.req.param("id"));
  if (!Number.isInteger(offerId)) {
    return c.json({ ok: false, code: "not_found", message: "Oferta nao encontrada." }, 404);
  }
  const found = await getDb()`SELECT id, establishment_id, title, kind, photo_path, total_units, price_cents, is_free, address_snapshot, gps_lat, gps_lng, available_from, pickup_from, pickup_until, storage_notes, state, cancel_reason FROM offers WHERE id = ${offerId}`;
  const offer = (found[0] as OfferRow | undefined) ?? null;
  if (!offer) {
    return c.json({ ok: false, code: "not_found", message: "Oferta nao encontrada." }, 404);
  }
  const ownerRows = await getDb()`SELECT owner_id FROM establishments WHERE id = ${offer.establishment_id}`;
  const owner = (ownerRows[0] as { owner_id: number } | undefined) ?? null;
  if ((!owner || owner.owner_id !== user.id) && offer.state !== "publicada") {
    return c.json({ ok: false, code: "not_found", message: "Oferta nao encontrada." }, 404);
  }
  return c.json({ ok: true, offer: await serializeOffer(offer) });
});

// Publicar: valida foto, composicao, preco e coerencia de datas; congela snapshot.
offersApp.post("/offers/:id/publish", requireMerchant, async (c) => {
  const user = c.get("user");
  const estab = await getEstablishment(user.id);
  if (!estab) {
    return c.json({ ok: false, code: "no_establishment", message: "Cadastre o estabelecimento antes das ofertas." }, 404);
  }
  const offerId = Number(c.req.param("id"));
  const offer = Number.isInteger(offerId) ? await getOwnOffer(estab.id, offerId) : null;
  if (!offer) {
    return c.json({ ok: false, code: "not_found", message: "Oferta nao encontrada." }, 404);
  }
  if (offer.state !== "rascunho") {
    return c.json({ ok: false, code: "invalid_state", message: "So e possivel publicar oferta em rascunho." }, 409);
  }
  if (!offer.photo_path) {
    return c.json({ ok: false, code: "photo_required", message: "Inclua uma foto antes de publicar." }, 422);
  }
  const items = await getDb()`SELECT qty_per_unit FROM offer_items WHERE offer_id = ${offer.id}` as { qty_per_unit: number }[];
  if (items.length === 0 || items.some((i) => !(i.qty_per_unit > 0))) {
    return c.json({ ok: false, code: "items_required", message: "Inclua ao menos um item com quantidade positiva." }, 422);
  }
  // RF-06: a janela de retirada nao pode terminar antes do inicio da oferta.
  if (offer.pickup_until < offer.available_from) {
    return c.json(
      { ok: false, code: "invalid_dates", message: "A retirada nao pode terminar antes do inicio da oferta." },
      422,
    );
  }
  if (offer.pickup_until < offer.pickup_from) {
    return c.json(
      { ok: false, code: "invalid_dates", message: "O fim da retirada precisa ser depois do inicio." },
      422,
    );
  }

  const db = getDb();
  const updatedRows = await db`UPDATE offers SET state = 'publicada',
       address_snapshot = ${estab.address_text}, gps_lat = ${estab.gps_lat}, gps_lng = ${estab.gps_lng},
       updated_at = now()
       WHERE id = ${offer.id} RETURNING id, establishment_id, title, kind, photo_path, total_units, price_cents, is_free, address_snapshot, gps_lat, gps_lng, available_from, pickup_from, pickup_until, storage_notes, state, cancel_reason`;
  const updated = updatedRows[0] as OfferRow;
  await db`INSERT INTO audit_log (entity, entity_id, action, actor_id) VALUES ('offer', ${offer.id}, 'published', ${user.id})`;
  return c.json({ ok: true, offer: await serializeOffer(updated) });
});

// RF-08: sem reservas a edicao e livre; com reservas ativas, so foto (via
// endpoint proprio) e orientacoes de conservacao. Mudanca material exige cancelar.
const MATERIAL_FIELDS = [
  "title", "kind", "items", "total_units", "price_cents", "is_free",
  "available_from", "pickup_from", "pickup_until",
];

offersApp.patch("/offers/:id", requireMerchant, async (c) => {
  const user = c.get("user");
  const estab = await getEstablishment(user.id);
  if (!estab) {
    return c.json({ ok: false, code: "no_establishment", message: "Cadastre o estabelecimento antes das ofertas." }, 404);
  }
  const offerId = Number(c.req.param("id"));
  const offer = Number.isInteger(offerId) ? await getOwnOffer(estab.id, offerId) : null;
  if (!offer) {
    return c.json({ ok: false, code: "not_found", message: "Oferta nao encontrada." }, 404);
  }
  if (offer.state !== "rascunho" && offer.state !== "publicada") {
    return c.json(
      { ok: false, code: "invalid_state", message: "Oferta encerrada, cancelada ou expirada nao pode ser editada." },
      409,
    );
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return c.json({ ok: false, code: "invalid_body", message: "Nada para atualizar." }, 400);
  }

  if (await hasActiveReservations(offer.id)) {
    const attempted = MATERIAL_FIELDS.filter((f) => body[f] !== undefined);
    if (attempted.length > 0) {
      return c.json(
        {
          ok: false,
          code: "material_change_blocked",
          message: "Com reservas ativas, cancele a oferta e avise os afetados para mudar item, quantidade, valor, local ou horario.",
        },
        409,
      );
    }
    if (body.storage_notes === undefined) {
      return c.json({ ok: false, code: "invalid_body", message: "Nada para atualizar." }, 400);
    }
    const noteRows = await getDb()`UPDATE offers SET storage_notes = ${str(body.storage_notes)},
         updated_at = now()
         WHERE id = ${offer.id} RETURNING id, establishment_id, title, kind, photo_path, total_units, price_cents, is_free, address_snapshot, gps_lat, gps_lng, available_from, pickup_from, pickup_until, storage_notes, state, cancel_reason`;
    return c.json({ ok: true, offer: await serializeOffer(noteRows[0] as OfferRow) });
  }

  const updates: string[] = [];
  const params: (string | number | boolean | null)[] = [];
  let itemsUpdate: { item_id: number; qty_per_unit: number }[] | null = null;

  if (body.title !== undefined) {
    const title = str(body.title);
    if (!title) return c.json({ ok: false, code: "invalid_title", message: "Informe o titulo da oferta." }, 400);
    updates.push("title = ?");
    params.push(title);
  }
  if (body.kind !== undefined) {
    const kind = body.kind === "caixa" ? "caixa" : body.kind === "item" ? "item" : "";
    if (!kind) return c.json({ ok: false, code: "invalid_kind", message: "Tipo precisa ser item ou caixa surpresa." }, 400);
    updates.push("kind = ?");
    params.push(kind);
  }
  if (body.items !== undefined) {
    const parsed = await parseOfferItems(estab.id, body.items);
    if (parsed.error) return c.json({ ok: false, code: "invalid_items", message: parsed.error }, 400);
    itemsUpdate = parsed.items;
  }
  if (body.total_units !== undefined) {
    const total = typeof body.total_units === "string" ? Number(body.total_units) : body.total_units;
    if (typeof total !== "number" || !Number.isInteger(total) || total <= 0) {
      return c.json({ ok: false, code: "invalid_units", message: "Quantidade ofertada precisa ser positiva." }, 400);
    }
    updates.push("total_units = ?");
    params.push(total);
  }
  if (body.price_cents !== undefined || body.is_free !== undefined) {
    const priceRaw = body.price_cents === undefined ? offer.price_cents : body.price_cents;
    const price = typeof priceRaw === "string" ? Number(priceRaw) : priceRaw;
    const isFreeRaw = body.is_free === undefined ? offer.is_free : body.is_free;
    const isFree = isFreeRaw === true || isFreeRaw === 1 || isFreeRaw === "true";
    if (typeof price !== "number" || !Number.isInteger(price) || price < 0) {
      return c.json({ ok: false, code: "invalid_price", message: "Preco precisa ser zero ou maior." }, 400);
    }
    if (isFree && price !== 0) {
      return c.json({ ok: false, code: "invalid_price", message: "Oferta gratis precisa ter preco zero." }, 400);
    }
    updates.push("price_cents = ?", "is_free = ?");
    params.push(price, isFree);
  }
  for (const field of ["available_from", "pickup_from", "pickup_until"] as const) {
    if (body[field] !== undefined) {
      const parsed = parseDate(body[field]);
      if (!parsed) {
        return c.json({ ok: false, code: "invalid_dates", message: "Informe datas validas de disponibilidade e retirada." }, 400);
      }
      updates.push(`${field} = ?`);
      params.push(parsed);
    }
  }
  if (body.storage_notes !== undefined) {
    updates.push("storage_notes = ?");
    params.push(str(body.storage_notes));
  }

  if (updates.length === 0 && !itemsUpdate) {
    return c.json({ ok: false, code: "invalid_body", message: "Nada para atualizar." }, 400);
  }

  const db = getDb();
  const setList = updates.map((u, i) => u.replace("?", `$${i + 1}`)).join(", ");
  const updated = await db.begin(async (tx) => {
    if (itemsUpdate) {
      await tx`DELETE FROM offer_items WHERE offer_id = ${offer.id}`;
      for (const it of itemsUpdate) {
        await tx`INSERT INTO offer_items (offer_id, item_id, qty_per_unit) VALUES (${offer.id}, ${it.item_id}, ${it.qty_per_unit})`;
      }
    }
    const rows = await tx.unsafe(
      `UPDATE offers SET ${setList ? setList + "," : ""} updated_at = now() WHERE id = $${params.length + 1} RETURNING id, establishment_id, title, kind, photo_path, total_units, price_cents, is_free, address_snapshot, gps_lat, gps_lng, available_from, pickup_from, pickup_until, storage_notes, state, cancel_reason`,
      [...params, offer.id] as (string | number | boolean | null)[],
    );
    return rows[0] as unknown as OfferRow;
  });
  await db`INSERT INTO audit_log (entity, entity_id, action, actor_id) VALUES ('offer', ${offer.id}, 'updated', ${user.id})`;
  return c.json({ ok: true, offer: await serializeOffer(updated) });
});

// RF-07: encerrar. Encerrada nao aceita novas reservas.
offersApp.post("/offers/:id/encerrar", requireMerchant, async (c) => {
  const user = c.get("user");
  const estab = await getEstablishment(user.id);
  if (!estab) {
    return c.json({ ok: false, code: "no_establishment", message: "Cadastre o estabelecimento antes das ofertas." }, 404);
  }
  const offerId = Number(c.req.param("id"));
  const offer = Number.isInteger(offerId) ? await getOwnOffer(estab.id, offerId) : null;
  if (!offer) {
    return c.json({ ok: false, code: "not_found", message: "Oferta nao encontrada." }, 404);
  }
  if (offer.state !== "rascunho" && offer.state !== "publicada") {
    return c.json({ ok: false, code: "invalid_state", message: "Oferta ja encerrada, cancelada ou expirada." }, 409);
  }
  const db = getDb();
  const closedRows = await db`UPDATE offers SET state = 'encerrada',
       updated_at = now()
       WHERE id = ${offer.id} RETURNING id, establishment_id, title, kind, photo_path, total_units, price_cents, is_free, address_snapshot, gps_lat, gps_lng, available_from, pickup_from, pickup_until, storage_notes, state, cancel_reason`;
  const updated = closedRows[0] as OfferRow;
  await db`INSERT INTO audit_log (entity, entity_id, action, actor_id) VALUES ('offer', ${offer.id}, 'closed', ${user.id})`;
  return c.json({ ok: true, offer: await serializeOffer(updated) });
});

// RF-10/RN-13: cancelar encerra pendentes e confirmadas nao retiradas, com motivo
// e avisos, sem contar falta. Atomicidade em transacao.
offersApp.post("/offers/:id/cancel", requireMerchant, async (c) => {
  const user = c.get("user");
  const estab = await getEstablishment(user.id);
  if (!estab) {
    return c.json({ ok: false, code: "no_establishment", message: "Cadastre o estabelecimento antes das ofertas." }, 404);
  }
  const offerId = Number(c.req.param("id"));
  const offer = Number.isInteger(offerId) ? await getOwnOffer(estab.id, offerId) : null;
  if (!offer) {
    return c.json({ ok: false, code: "not_found", message: "Oferta nao encontrada." }, 404);
  }
  if (offer.state !== "rascunho" && offer.state !== "publicada") {
    return c.json({ ok: false, code: "invalid_state", message: "Oferta ja encerrada, cancelada ou expirada." }, 409);
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const reason = body ? str(body.reason) : "";
  if (!reason) {
    return c.json({ ok: false, code: "reason_required", message: "Informe o motivo do cancelamento." }, 400);
  }

  const db = getDb();
  const result = await db.begin(async (tx) => {
    const updatedRows = await tx`UPDATE offers SET state = 'cancelada', cancel_reason = ${reason},
         updated_at = now()
         WHERE id = ${offer.id} RETURNING id, establishment_id, title, kind, photo_path, total_units, price_cents, is_free, address_snapshot, gps_lat, gps_lng, available_from, pickup_from, pickup_until, storage_notes, state, cancel_reason`;
    const affected = await tx`SELECT id, consumer_id FROM reservations
         WHERE offer_id = ${offer.id} AND state IN ('pendente','confirmada')` as { id: number; consumer_id: number }[];
    for (const r of affected) {
      await tx`UPDATE reservations SET state = 'cancelada', cancel_reason = ${`Oferta cancelada: ${reason}`},
         updated_at = now() WHERE id = ${r.id}`;
      await tx`INSERT INTO notices (user_id, kind, offer_id, reservation_id, body)
         VALUES (${r.consumer_id}, 'offer_cancelled', ${offer.id}, ${r.id},
         ${`A oferta "${offer.title}" foi cancelada pelo comerciante: ${reason}. Nenhuma falta foi registrada.`})`;
      await tx`INSERT INTO audit_log (entity, entity_id, action, actor_id) VALUES ('reservation', ${r.id}, 'cancelled_offer', ${user.id})`;
    }
    await tx`INSERT INTO audit_log (entity, entity_id, action, actor_id) VALUES ('offer', ${offer.id}, 'cancelled', ${user.id})`;
    return { offer: updatedRows[0] as OfferRow, cancelled: affected.length };
  });

  return c.json({
    ok: true,
    offer: await serializeOffer(result.offer),
    cancelled_reservations: result.cancelled,
  });
});

// Foto obrigatoria para publicar. Upload local em data/uploads; o banco guarda
// so o caminho. Aceita jpeg, png e webp ate 5 MB. Editavel mesmo com reservas.
offersApp.post("/offers/:id/photo", requireMerchant, async (c) => {
  const user = c.get("user");
  const estab = await getEstablishment(user.id);
  if (!estab) {
    return c.json({ ok: false, code: "no_establishment", message: "Cadastre o estabelecimento antes das ofertas." }, 404);
  }
  const offerId = Number(c.req.param("id"));
  const offer = Number.isInteger(offerId) ? await getOwnOffer(estab.id, offerId) : null;
  if (!offer) {
    return c.json({ ok: false, code: "not_found", message: "Oferta nao encontrada." }, 404);
  }
  if (offer.state !== "rascunho" && offer.state !== "publicada") {
    return c.json({ ok: false, code: "invalid_state", message: "Oferta encerrada, cancelada ou expirada nao aceita foto nova." }, 409);
  }
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    return c.json({ ok: false, code: "photo_required", message: "Envie uma foto da oferta." }, 400);
  }
  const ext = PHOTO_MIMES[file.type];
  if (!ext) {
    return c.json({ ok: false, code: "invalid_photo", message: "Foto precisa ser jpeg, png ou webp." }, 400);
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return c.json({ ok: false, code: "photo_too_large", message: "Foto precisa ter ate 5 MB." }, 400);
  }

  mkdirSync(UPLOAD_DIR, { recursive: true });
  const filename = `${offer.id}-${randomBytes(8).toString("hex")}${ext}`;
  await Bun.write(`${UPLOAD_DIR}/${filename}`, file);
  if (offer.photo_path) {
    const { unlink } = await import("node:fs/promises");
    await unlink(offer.photo_path).catch(() => {
      // Foto antiga ausente: segue com a nova.
    });
  }
  const db = getDb();
  const photoRows = await db`UPDATE offers SET photo_path = ${`${UPLOAD_DIR}/${filename}`},
       updated_at = now()
       WHERE id = ${offer.id} RETURNING id, establishment_id, title, kind, photo_path, total_units, price_cents, is_free, address_snapshot, gps_lat, gps_lng, available_from, pickup_from, pickup_until, storage_notes, state, cancel_reason`;
  const updated = photoRows[0] as OfferRow;
  await db`INSERT INTO audit_log (entity, entity_id, action, actor_id) VALUES ('offer', ${offer.id}, 'photo_updated', ${user.id})`;
  return c.json({ ok: true, offer: await serializeOffer(updated) });
});

offersApp.get("/offers/:id/photo", requireAuth, async (c) => {
  const offerId = Number(c.req.param("id"));
  const photoFound = Number.isInteger(offerId)
    ? await getDb()`SELECT id, establishment_id, title, kind, photo_path, total_units, price_cents, is_free, address_snapshot, gps_lat, gps_lng, available_from, pickup_from, pickup_until, storage_notes, state, cancel_reason FROM offers WHERE id = ${offerId}`
    : [];
  const offer = (photoFound[0] as OfferRow | undefined) ?? null;
  if (!offer || !offer.photo_path) {
    return c.json({ ok: false, code: "not_found", message: "Foto nao encontrada." }, 404);
  }
  // Foto visivel para qualquer usuario autenticado, em qualquer estado.
  const file = Bun.file(offer.photo_path);
  if (!(await file.exists())) {
    return c.json({ ok: false, code: "not_found", message: "Foto nao encontrada." }, 404);
  }
  const type = offer.photo_path.endsWith(".png")
    ? "image/png"
    : offer.photo_path.endsWith(".webp")
      ? "image/webp"
      : "image/jpeg";
  return new Response(await file.arrayBuffer(), { headers: { "Content-Type": type } });
});
