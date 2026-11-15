import { Hono } from "hono";
import type { JSONValue } from "postgres";
import { createHash, randomBytes } from "node:crypto";
import { getDb, type DbClient } from "./db";
import { sendPushToUser } from "./push";
import { requireAuth, requireMerchant, withinLen, type AppEnv, type SessionUser } from "./auth";
import { remainingUnits } from "./offers";
import { captureReservationSnapshot, encryptPickupCode, decryptPickupCode, formatNoticeDate } from "./reservation-data";
import type { ReservationSnapshot } from "../shared/types";

export const reservationsApp = new Hono<AppEnv>();
reservationsApp.use("/reservations/*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  await next();
});

const PENDING_MINUTES = 30;
const CANCEL_TOLERANCE_MINUTES = 15;
const GRACE_MINUTES = 15;
const BLOCK_DAYS = 10;

function nowISO(date = new Date()): string {
  return date.toISOString();
}

function minutesFromNow(minutes: number): string {
  return nowISO(new Date(Date.now() + minutes * 60_000));
}

function minISO(a: string, b: string): string {
  return a < b ? a : b;
}

// Código de uso único: hash para validar e cópia cifrada para consulta do titular.
function newPickupCode(): { code: string; hash: string } {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let code = "";
  for (const b of bytes) code += alphabet[b % alphabet.length];
  return { code, hash: createHash("sha256").update(code).digest("hex") };
}

async function audit(entity: string, entityId: number, action: string, actorId: number | null, client?: DbClient) {
  const db = client ?? getDb();
  await db`INSERT INTO audit_log (entity, entity_id, action, actor_id) VALUES (${entity}, ${entityId}, ${action}, ${actorId})`;
}

async function notify(
  userId: number,
  kind: string,
  offerId: number | null,
  reservationId: number | null,
  body: string,
  client?: DbClient,
) {
  const db = client ?? getDb();
  await db`INSERT INTO notices (user_id, kind, offer_id, reservation_id, body) VALUES (${userId}, ${kind}, ${offerId}, ${reservationId}, ${body})`;
  // Push e complementar: o aviso interno acima e o fallback garantido.
  // Fire-and-forget: nunca bloqueia nem quebra a resposta.
  void sendPushToUser(userId, { title: "XepaJá", body }, client);
}

interface ReservationRow {
  id: number;
  consumer_id: number;
  offer_id: number;
  state: string;
  idempotency_key: string;
  pickup_code_hash: string;
  price_cents: number;
  address_snapshot: string;
  gps_lat: number | null;
  gps_lng: number | null;
  pickup_until: string;
  pending_expires_at: string | null;
  cancel_reason: string;
  created_at: string;
}

// RN-08: ao fim do bloqueio, nova contagem. Limpeza preguicosa ao ler o usuario.
export async function refreshBlock(userId: number): Promise<{
  misses: number;
  blocked_until: string | null;
}> {
  const db = getDb();
  const rows = await db`SELECT misses_since_unblock, blocked_until FROM users WHERE id = ${userId}`;
  const row = rows[0] as { misses_since_unblock: number; blocked_until: string | null };
  if (row.blocked_until && row.blocked_until <= nowISO()) {
    await db`UPDATE users SET blocked_until = NULL, misses_since_unblock = 0 WHERE id = ${userId}`;
    return { misses: 0, blocked_until: null };
  }
  return { misses: row.misses_since_unblock, blocked_until: row.blocked_until };
}

// Expira pendentes sem decisao e confirmadas sem retirada apos a tolerancia.
// Confirmada expirada conta falta; na terceira, bloqueia 10 dias com aviso.
export async function sweepExpiries(): Promise<{ expired_pending: number; expired_confirmed: number }> {
  const db = getDb();
  const now = nowISO();
  let expired_pending = 0;
  let expired_confirmed = 0;

  const pendents = await db`SELECT r.id, r.consumer_id, r.offer_id, o.title FROM reservations r
       JOIN offers o ON o.id = r.offer_id
       WHERE r.state = 'pendente' AND (r.pending_expires_at <= ${now}::timestamptz OR r.pickup_until <= ${now}::timestamptz)` as { id: number; consumer_id: number; offer_id: number; title: string }[];
  for (const p of pendents) {
    await db`UPDATE reservations SET state = 'expirada' WHERE id = ${p.id} AND state = 'pendente'`;
    await notify(
      p.consumer_id,
      "request_expired",
      p.offer_id,
      p.id,
      `O pedido da oferta "${p.title}" expirou sem decisão. Nenhuma falta foi registrada e você já pode pedir de novo.`,
    );
    await audit("reservation", p.id, "expired_pending", null);
    expired_pending += 1;
  }

  const graceCut = nowISO(new Date(Date.now() - GRACE_MINUTES * 60_000));
  const confirmed = await db`SELECT r.id, r.consumer_id, r.offer_id, o.title FROM reservations r
       JOIN offers o ON o.id = r.offer_id
       WHERE r.state = 'confirmada' AND r.pickup_until <= ${graceCut}::timestamptz` as { id: number; consumer_id: number; offer_id: number; title: string }[];
  for (const r of confirmed) {
    const changed = await db`UPDATE reservations SET state = 'expirada' WHERE id = ${r.id} AND state = 'confirmada' RETURNING id`;
    if (changed.length === 0) continue;
    const userRows = await db`SELECT misses_since_unblock FROM users WHERE id = ${r.consumer_id}`;
    const user = userRows[0] as { misses_since_unblock: number };
    const misses = user.misses_since_unblock + 1;
    let blocked_until: string | null = null;
    if (misses >= 3) {
      blocked_until = nowISO(new Date(Date.now() + BLOCK_DAYS * 86_400_000));
    }
    await db`UPDATE users SET misses_since_unblock = ${misses}, blocked_until = ${blocked_until} WHERE id = ${r.consumer_id}`;
    await notify(
      r.consumer_id,
      blocked_until ? "blocked" : "miss_registered",
      r.offer_id,
      r.id,
      blocked_until
        ? `Terceira falta na oferta "${r.title}". Novas reservas bloqueadas por 10 dias.`
        : `Falta registrada na oferta "${r.title}" (retirada não feita). Você tem ${misses} falta(s) desde o último desbloqueio.`,
    );
    await audit("reservation", r.id, "expired_miss", null);
    expired_confirmed += 1;
  }
  // Aproximacao do prazo: confirmada com fim em ate 60 min e sem aviso ainda.
  // Preguicoso a cada leitura/escrita; o aviso interno garante o fallback.
  const soonCut = nowISO(new Date(Date.now() + 60 * 60_000));
  const upcoming = await db`SELECT r.id, r.consumer_id, r.offer_id, r.pickup_until, o.title FROM reservations r
       JOIN offers o ON o.id = r.offer_id
       WHERE r.state = 'confirmada' AND r.pickup_until > ${now}::timestamptz AND r.pickup_until <= ${soonCut}::timestamptz
         AND NOT EXISTS (SELECT 1 FROM notices n
           WHERE n.reservation_id = r.id AND n.kind = 'pickup_soon')` as {
    id: number;
    consumer_id: number;
    offer_id: number;
    pickup_until: string;
    title: string;
  }[];
  for (const u of upcoming) {
    await notify(
      u.consumer_id,
      "pickup_soon",
      u.offer_id,
      u.id,
      `A retirada da oferta "${u.title}" termina em breve (${formatNoticeDate(u.pickup_until)}). Não perca o prazo para evitar falta.`,
    );
  }
  return { expired_pending, expired_confirmed };
}

async function serializeConsumer(row: ReservationRow, code?: string) {
  const [data] = await getDb()`SELECT snapshot, pickup_code_encrypted FROM reservations WHERE id = ${row.id}`;
  const snapshot = (data?.snapshot ?? null) as ReservationSnapshot | null;
  const offer = snapshot ?? { title: "Oferta sem título registrado", pickup_from: null, gps_lat: null, gps_lng: null, photo_path: "" };
  const pickupCode = row.state === "confirmada" ? (code ?? decryptPickupCode(data?.pickup_code_encrypted ?? "")) : undefined;
  return {
    id: row.id,
    offer_id: row.offer_id,
    offer_title: offer.title,
    state: row.state,
    has_photo: offer.photo_path !== "",
    price_cents: row.price_cents,
    address_snapshot: row.address_snapshot,
    gps_lat: snapshot?.gps_lat ?? row.gps_lat,
    gps_lng: snapshot?.gps_lng ?? row.gps_lng,
    pickup_from: offer.pickup_from,
    pickup_until: row.pickup_until,
    pending_expires_at: row.pending_expires_at,
    cancel_before: nowISO(new Date(new Date(row.pickup_until).getTime() - CANCEL_TOLERANCE_MINUTES * 60_000)),
    created_at: row.created_at,
    snapshot_available: !!snapshot,
    establishment_name: snapshot?.establishment_name ?? null,
    merchant_name: snapshot?.merchant_name ?? null,
    reference: snapshot?.reference ?? null,
    kind: snapshot?.kind ?? null,
    items: snapshot?.items ?? null,
    storage_notes: snapshot?.storage_notes ?? null,
    box_description: (snapshot as ReservationSnapshot | null)?.box_description ?? null,
    photos: (snapshot as ReservationSnapshot | null)?.photos ?? null,
    cancel_reason: row.cancel_reason,
    quantity: 1,
    ...(pickupCode ? { pickup_code: pickupCode } : {}),
  };
}

// RF-15/RN-02/RN-06/RN-10/RN-12: uma ativa por vez, retencao atomica, snapshot,
// idempotencia e bloqueio verificados no servidor.
reservationsApp.post("/reservations", requireAuth, async (c) => {
  const user = c.get("user");
  if (user.role !== "consumer") {
    return c.json(
      { ok: false, code: "forbidden", message: "Reservas são do perfil consumidor." },
      403,
    );
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const rawOfferId = typeof body?.offer_id === "string" ? Number(body.offer_id) : body?.offer_id;
  const key: string = typeof body?.idempotency_key === "string" ? body.idempotency_key.trim() : "";
  if (typeof rawOfferId !== "number" || !Number.isInteger(rawOfferId)) {
    return c.json({ ok: false, code: "invalid_offer", message: "Informe a oferta." }, 400);
  }
  const offerId: number = rawOfferId;
  if (!key) {
    return c.json(
      { ok: false, code: "idempotency_required", message: "Reenvie com a mesma chave de idempotência." },
      400,
    );
  }
  if (!withinLen(key, 120)) {
    return c.json(
      { ok: false, code: "invalid_idempotency", message: "Chave de idempotência precisa ter até 120 caracteres." },
      400,
    );
  }

  await sweepExpiries();
  const block = await refreshBlock(user.id);
  if (block.blocked_until) {
    return c.json(
      {
        ok: false,
        code: "blocked",
        message: "Novas reservas bloqueadas por faltas.",
        blocked_until: block.blocked_until,
        misses_since_unblock: block.misses,
      },
      403,
    );
  }

  const db = getDb();
  // Falha de regra dentro da transacao: o throw aborta o begin (rollback)
  // e o catch converte em resposta. Throw inline estreita os tipos.
  try {
    const created = await db.begin(async (tx) => {
      // Serializa também pedidos do mesmo consumidor em ofertas diferentes.
      await tx`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`;
      const keyRows = await tx`SELECT id, consumer_id, offer_id, state, idempotency_key, pickup_code_hash, price_cents, address_snapshot, gps_lat, gps_lng, pickup_until, pending_expires_at, cancel_reason, created_at FROM reservations WHERE idempotency_key = ${key}`;
      const existingKey = (keyRows[0] as ReservationRow | undefined) ?? null;
      if (existingKey) {
        if (existingKey.consumer_id !== user.id || existingKey.offer_id !== offerId) {
          throw { __httpFail: true, status: 409, body: { ok: false, code: "idempotency_conflict", message: "Chave de idempotência já usada em outro pedido." } };
        }
        return { reservation: existingKey, repeated: true as const, code: undefined as string | undefined };
      }

      const activeRows = await tx`SELECT id FROM reservations WHERE consumer_id = ${user.id} AND state = 'confirmada'`;
      if (activeRows.length > 0) {
        throw { __httpFail: true, status: 409, body: { ok: false, code: "already_active", message: "Você já tem uma reserva ativa. Cancele ou conclua antes de pedir de novo." } };
      }

      // Trava a linha da oferta: dois pedidos simultaneos na ultima unidade
      // passam por aqui em serie, sem overbooking.
      const offerRows = await tx`SELECT id, establishment_id, title, state, total_units, price_cents,
                address_snapshot, pickup_until, available_from
         FROM offers WHERE id = ${offerId} FOR UPDATE`;
      const offer = (offerRows[0] as {
        id: number;
        establishment_id: number;
        title: string;
        state: string;
        total_units: number;
        price_cents: number;
        address_snapshot: string;
        pickup_until: string;
        available_from: string;
      } | undefined) ?? null;
      const now = nowISO();
      if (!offer || offer.state !== "publicada" || offer.available_from > now || offer.pickup_until <= now) {
        throw { __httpFail: true, status: 409, body: { ok: false, code: "offer_unavailable", message: "Oferta esgotada, encerrada ou fora da janela." } };
      }
      if ((await remainingUnits(offer.id, offer.total_units, tx)) <= 0) {
        throw { __httpFail: true, status: 409, body: { ok: false, code: "sold_out", message: "Oferta esgotada." } };
      }

      // Sem pendentes: toda reserva nasce confirmada. Faltas/bloqueio seguem para no-show.
      const code = newPickupCode();
      const snapshot = await captureReservationSnapshot(tx, offer.id);
      const insertedRows = await tx`INSERT INTO reservations
         (consumer_id, offer_id, state, idempotency_key, pickup_code_hash,
          price_cents, address_snapshot, pickup_until, pending_expires_at, snapshot, pickup_code_encrypted, gps_lat, gps_lng)
         VALUES (${user.id}, ${offer.id}, 'confirmada', ${key},
          ${code.hash}, ${offer.price_cents}, ${offer.address_snapshot},
          ${offer.pickup_until}::timestamptz,
          NULL,
          ${tx.json(snapshot as unknown as JSONValue)}, ${encryptPickupCode(code.code)}, ${snapshot.gps_lat}, ${snapshot.gps_lng})
         RETURNING id, consumer_id, offer_id, state, idempotency_key, pickup_code_hash, price_cents, address_snapshot, gps_lat, gps_lng, pickup_until, pending_expires_at, cancel_reason, created_at`;
      const inserted = insertedRows[0] as ReservationRow;

      const ownerRows = await tx`SELECT owner_id FROM establishments WHERE id = ${offer.establishment_id}`;
      const owner = ownerRows[0] as { owner_id: number };
      await notify(
        user.id,
        "reservation_confirmed",
        offer.id,
        inserted.id,
        `Reserva confirmada na oferta "${offer.title}". Retire até ${formatNoticeDate(offer.pickup_until)} com seu código.`,
        tx,
      );
      await notify(
        owner.owner_id,
        "reservation_confirmed",
        offer.id,
        inserted.id,
        `Nova reserva confirmada na oferta "${offer.title}". Prepare a unidade para retirada.`,
        tx,
      );
      await audit("reservation", inserted.id, "confirmed", user.id, tx);
      return { reservation: inserted, repeated: false as const, code: code.code };
      return { reservation: inserted, repeated: false as const, code: code?.code };
    });
    return c.json(
      { ok: true, reservation: await serializeConsumer(created.reservation, created.code), ...(created.repeated ? { repeated: true } : {}) },
      created.repeated ? 200 : 201,
    );
  } catch (err) {
    if (err && typeof err === "object" && "__httpFail" in err) {
      const f = err as unknown as { status: number; body: Record<string, unknown> };
      return c.json(f.body, f.status as 409);
    }
    throw err;
  }
});

// RF-16: ativa com limites, faltas e bloqueio; mais historico de concluidas.
reservationsApp.get("/reservations/active", requireAuth, async (c) => {
  const user = c.get("user");
  await sweepExpiries();
  const block = await refreshBlock(user.id);
  const activeRows = await getDb()`SELECT id, consumer_id, offer_id, state, idempotency_key, pickup_code_hash, price_cents, address_snapshot, gps_lat, gps_lng, pickup_until, pending_expires_at, cancel_reason, created_at FROM reservations
       WHERE consumer_id = ${user.id} AND state = 'confirmada'
       ORDER BY id DESC LIMIT 1`;
  const row = (activeRows[0] as ReservationRow | undefined) ?? null;
  return c.json({
    ok: true,
    reservation: row ? await serializeConsumer(row) : null,
    misses_since_unblock: block.misses,
    blocked_until: block.blocked_until,
  });
});

reservationsApp.get("/reservations/history", requireAuth, async (c) => {
  const state = c.req.query("state") ?? "";
  const from = c.req.query("from") ?? null;
  const until = c.req.query("until") ?? null; // limite exclusivo, calculado no fuso do consumidor
  const offset = Number(c.req.query("offset") ?? 0);
  const limit = Number(c.req.query("limit") ?? 20);
  const validDate = (v: string | null) => v === null || (/^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v)));
  if ((state && !["recusada", "retirada", "cancelada", "expirada"].includes(state)) ||
      !validDate(from) || !validDate(until) || (from && until && Date.parse(from) >= Date.parse(until)) ||
      !Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    return c.json({ ok: false, code: "invalid_filters", message: "Informe filtros e período válidos." }, 400);
  }
  await sweepExpiries();
  const db = getDb();
  const userId = c.get("user").id;
  const where = db`consumer_id = ${userId} AND state IN ('recusada','retirada','cancelada','expirada')
    AND (${state} = '' OR state = ${state})
    AND (${from}::timestamptz IS NULL OR created_at >= ${from}::timestamptz)
    AND (${until}::timestamptz IS NULL OR created_at < ${until}::timestamptz)`;
  const rows = await db`SELECT * FROM reservations WHERE ${where}
    ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}` as ReservationRow[];
  const [count] = await db`SELECT COUNT(*)::int AS total FROM reservations WHERE ${where}`;
  return c.json({ ok: true, reservations: await Promise.all(rows.map(r => serializeConsumer(r))),
    total: count.total, has_more: offset + rows.length < count.total });
});

// RF retirada: comerciante confirma pelo codigo unico, uma vez, dentro da
// janela mais 15 minutos de tolerancia. Codigo errado ou reused nao revela nada.
reservationsApp.post("/reservations/pickup/confirm", requireMerchant, async (c) => {
  await sweepExpiries();
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const raw = body && typeof body.code === "string" ? body.code : "";
  const code = raw.trim().toUpperCase();
  if (!code) {
    return c.json({ ok: false, code: "code_required", message: "Informe o código de retirada." }, 400);
  }
  const hash = createHash("sha256").update(code).digest("hex");
  const db = getDb();
  const codeRows = await db`SELECT id, consumer_id, offer_id, state, idempotency_key, pickup_code_hash, price_cents, address_snapshot, gps_lat, gps_lng, pickup_until, pending_expires_at, cancel_reason, created_at FROM reservations WHERE pickup_code_hash = ${hash}`;
  const row = (codeRows[0] as ReservationRow | undefined) ?? null;
  if (!row || row.state !== "confirmada" || !(await ownOfferId(c.get("user").id, row.offer_id))) {
    return c.json({ ok: false, code: "invalid_code", message: "Código inválido ou já usado." }, 404);
  }
  // O sweep ja expirou confirmadas alem da tolerancia; a guarda abaixo cobre corrida.
  if (new Date(row.pickup_until).getTime() + GRACE_MINUTES * 60_000 < Date.now()) {
    return c.json({ ok: false, code: "invalid_code", message: "Código inválido ou já usado." }, 404);
  }
  const changed = await db`UPDATE reservations SET state = 'retirada', pickup_code_hash = '', pickup_code_encrypted = '', picked_at = now() WHERE id = ${row.id} AND state = 'confirmada' RETURNING id`;
  if (changed.length === 0) {
    return c.json({ ok: false, code: "invalid_code", message: "Código inválido ou já usado." }, 404);
  }
  const offerRows = await db`SELECT title FROM offers WHERE id = ${row.offer_id}`;
  const offer = offerRows[0] as { title: string };
  const consumerRows = await db`SELECT name FROM users WHERE id = ${row.consumer_id}`;
  const consumer = consumerRows[0] as { name: string };
  await notify(
    row.consumer_id,
    "pickup_confirmed",
    row.offer_id,
    row.id,
    `Retirada confirmada na oferta "${offer.title}". Obrigado por evitar desperdício!`,
  );
  await audit("reservation", row.id, "picked_up", c.get("user").id);
  return c.json({
    ok: true,
    pickup: {
      reservation_id: row.id,
      offer_title: offer.title,
      consumer_name: consumer.name,
      price_cents: row.price_cents,
      confirmed_at: nowISO(),
    },
  });
});

// RF-17/20: pendente cancela antes de expirar; confirmada ate 15 min antes do
// fim da retirada. Dentro do prazo nao conta falta.
reservationsApp.post("/reservations/:id/cancel", requireAuth, async (c) => {
  const user = c.get("user");
  await sweepExpiries();
  const id = Number(c.req.param("id"));
  const cancelRows = Number.isInteger(id)
    ? await getDb()`SELECT id, consumer_id, offer_id, state, idempotency_key, pickup_code_hash, price_cents, address_snapshot, gps_lat, gps_lng, pickup_until, pending_expires_at, cancel_reason, created_at FROM reservations WHERE id = ${id}`
    : [];
  const row = (cancelRows[0] as ReservationRow | undefined) ?? null;
  if (!row || row.consumer_id !== user.id) {
    return c.json({ ok: false, code: "not_found", message: "Reserva não encontrada." }, 404);
  }
  if (row.state === "confirmada") {
    const deadline = new Date(row.pickup_until).getTime() - CANCEL_TOLERANCE_MINUTES * 60_000;
    if (Date.now() > deadline) {
      return c.json(
        { ok: false, code: "too_late", message: "Prazo de cancelamento encerrado (15 minutos antes do fim da retirada)." },
        409,
      );
    }
    await getDb()`UPDATE reservations SET state = 'cancelada' WHERE id = ${id}`;
    await audit("reservation", id, "cancelled_consumer", user.id);
    return c.json({ ok: true });
  }
  return c.json(
    { ok: false, code: "invalid_state", message: "Reserva já concluída ou cancelada." },
    409,
  );
});

async function ownOfferId(ownerId: number, offerId: number): Promise<boolean> {
  const rows = await getDb()`SELECT o.id FROM offers o JOIN establishments e ON e.id = o.establishment_id
       WHERE o.id = ${offerId} AND e.owner_id = ${ownerId}`;
  return rows.length > 0;
}

// RF-21: solicitacoes com indicador de faltas; aceitar ou recusar pendentes.
reservationsApp.get("/reservations/incoming", requireMerchant, async (c) => {
  const user = c.get("user");
  await sweepExpiries();
  const rows = await getDb()`SELECT r.id, r.offer_id, r.state, r.created_at, r.pending_expires_at, r.pickup_until,
              o.title AS offer_title, u.name AS consumer_name, u.email AS consumer_email, u.misses_since_unblock AS consumer_misses
       FROM reservations r
       JOIN offers o ON o.id = r.offer_id
       JOIN establishments e ON e.id = o.establishment_id
       JOIN users u ON u.id = r.consumer_id
       WHERE e.owner_id = ${user.id} AND r.state = 'confirmada'
       ORDER BY r.id DESC`;
  return c.json({ ok: true, reservations: rows });
});

reservationsApp.post("/reservations/:id/accept", requireMerchant, async (c) => {
  return c.json({ ok: false, code: "gone", message: "Fluxo de pendentes removido. Novas reservas ja nascem confirmadas." }, 410);
});


reservationsApp.post("/reservations/:id/refuse", requireMerchant, async (c) => {
  return c.json({ ok: false, code: "gone", message: "Fluxo de pendentes removido. Novas reservas ja nascem confirmadas." }, 410);
});



reservationsApp.get("/reservations/incoming/:id", requireMerchant, async (c) => {
  const user = c.get("user");
  await sweepExpiries();
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ ok: false, code: "not_found", message: "Solicitacao nao encontrada." }, 404);
  const rows = await getDb()`SELECT r.id, r.offer_id, r.state, r.created_at, r.pickup_until, r.price_cents,
              o.title AS offer_title, o.kind AS offer_kind, o.box_description,
              u.name AS consumer_name, u.email AS consumer_email, u.misses_since_unblock AS consumer_misses
       FROM reservations r
       JOIN offers o ON o.id = r.offer_id
       JOIN establishments e ON e.id = o.establishment_id
       JOIN users u ON u.id = r.consumer_id
       WHERE r.id = ${id} AND e.owner_id = ${user.id} AND r.state = 'confirmada'`;
  const row = (rows[0] as Record<string, unknown> | undefined) ?? null;
  if (!row) return c.json({ ok: false, code: "not_found", message: "Solicitacao nao encontrada." }, 404);
  const items = await getDb()`SELECT oi.item_id, i.name, i.unit, oi.qty_per_unit FROM offer_items oi JOIN items i ON i.id = oi.item_id WHERE oi.offer_id = ${(row as { offer_id: number }).offer_id} ORDER BY i.name`;
  const photos = await getDb()`SELECT id, item_id, path FROM offer_photos WHERE offer_id = ${(row as { offer_id: number }).offer_id} ORDER BY position, id`;
  return c.json({ ok: true, solicitation: { ...row, items, photos } });
});

// Previa da retirada: mostra o pedido sem confirmar.
reservationsApp.post("/reservations/pickup/preview", requireMerchant, async (c) => {
  await sweepExpiries();
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const raw = body && typeof body.code === "string" ? body.code : "";
  const code = raw.trim().toUpperCase();
  if (!code) return c.json({ ok: false, code: "code_required", message: "Informe o codigo de retirada." }, 400);
  const hash = createHash("sha256").update(code).digest("hex");
  const db = getDb();
  const rows = await db`SELECT id, consumer_id, offer_id, state, price_cents, address_snapshot, pickup_until, created_at FROM reservations WHERE pickup_code_hash = ${hash}`;
  const row = (rows[0] as ReservationRow | undefined) ?? null;
  if (!row || row.state !== "confirmada" || !(await ownOfferId(c.get("user").id, row.offer_id))) {
    return c.json({ ok: false, code: "invalid_code", message: "Codigo invalido ou ja usado." }, 404);
  }
  if (new Date(row.pickup_until).getTime() + 15 * 60_000 < Date.now()) {
    return c.json({ ok: false, code: "invalid_code", message: "Codigo invalido ou ja usado." }, 404);
  }
  const offerRows = await db`SELECT o.title, o.kind, o.box_description, o.price_cents, o.is_free, o.pickup_from, o.pickup_until FROM offers o WHERE o.id = ${row.offer_id}`;
  const offer = offerRows[0] as { title: string; kind: string; box_description: string; price_cents: number; is_free: boolean; pickup_from: string; pickup_until: string };
  const items = await db`SELECT oi.item_id, i.name, i.unit, oi.qty_per_unit FROM offer_items oi JOIN items i ON i.id = oi.item_id WHERE oi.offer_id = ${row.offer_id} ORDER BY i.name`;
  const consumerRows = await db`SELECT name FROM users WHERE id = ${row.consumer_id}`;
  const consumer = consumerRows[0] as { name: string };
  return c.json({ ok: true, preview: { reservation_id: row.id, offer_title: offer.title, offer_kind: offer.kind, box_description: offer.box_description, items, price_cents: row.price_cents, is_free: offer.is_free, consumer_name: consumer.name, address_snapshot: row.address_snapshot, pickup_from: offer.pickup_from, pickup_until: offer.pickup_until } });
});

// RF-22: comerciante cancela confirmada com motivo e aviso, sem falta.
reservationsApp.post("/reservations/:id/merchant-cancel", requireMerchant, async (c) => {
  const user = c.get("user");
  await sweepExpiries();
  const id = Number(c.req.param("id"));
  const mcRows = Number.isInteger(id)
    ? await getDb()`SELECT id, consumer_id, offer_id, state, idempotency_key, pickup_code_hash, price_cents, address_snapshot, gps_lat, gps_lng, pickup_until, pending_expires_at, cancel_reason, created_at FROM reservations WHERE id = ${id}`
    : [];
  const row = (mcRows[0] as ReservationRow | undefined) ?? null;
  if (!row || row.state !== "confirmada" || !(await ownOfferId(user.id, row.offer_id))) {
    return c.json({ ok: false, code: "not_found", message: "Reserva confirmada não encontrada." }, 404);
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const reason = body && typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return c.json({ ok: false, code: "reason_required", message: "Informe o motivo do cancelamento." }, 400);
  }
  if (!withinLen(reason, 200)) {
    return c.json({ ok: false, code: "invalid_reason", message: "Motivo precisa ter até 200 caracteres." }, 400);
  }
  const db = getDb();
  await db`UPDATE reservations SET state = 'cancelada', cancel_reason = ${`Cancelada pelo comerciante: ${reason}`} WHERE id = ${id}`;
  const mcOfferRows = await db`SELECT title FROM offers WHERE id = ${row.offer_id}`;
  const offer = mcOfferRows[0] as { title: string };
  await notify(
    row.consumer_id,
    "merchant_cancelled",
    row.offer_id,
    id,
    `Reserva cancelada na oferta "${offer.title}": ${reason}. Nenhuma falta foi registrada.`,
  );
  await audit("reservation", id, "cancelled_merchant", user.id);
  return c.json({ ok: true });
});

reservationsApp.get("/reservations/:id/photo", requireAuth, async (c) => {
  const id = Number(c.req.param("id"));
  const rows = Number.isSafeInteger(id) ? await getDb()`SELECT snapshot FROM reservations
    WHERE id = ${id} AND consumer_id = ${c.get("user").id}` : [];
  const snapshot = rows[0]?.snapshot as ReservationSnapshot | null;
  const file = snapshot?.photo_path ? Bun.file(snapshot.photo_path) : null;
  if (!file || !(await file.exists())) {
    return c.json({ ok: false, code: "not_found", message: "Foto não encontrada." }, 404);
  }
  return new Response(file, { headers: { "Cache-Control": "private, no-store" } });
});

reservationsApp.get("/reservations/:id", requireAuth, async (c) => {
  await sweepExpiries();
  const id = Number(c.req.param("id"));
  const rows = Number.isSafeInteger(id) ? await getDb()`SELECT * FROM reservations
    WHERE id = ${id} AND consumer_id = ${c.get("user").id}` : [];
  if (!rows[0]) return c.json({ ok: false, code: "not_found", message: "Reserva não encontrada." }, 404);
  c.header("Cache-Control", "private, no-store");
  return c.json({ ok: true, reservation: await serializeConsumer(rows[0] as ReservationRow) });
});

export type { SessionUser };
