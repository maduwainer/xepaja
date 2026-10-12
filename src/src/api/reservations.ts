import { Hono } from "hono";
import { createHash, randomBytes } from "node:crypto";
import { getDb } from "./db";
import { sendPushToUser } from "./push";
import { requireAuth, requireMerchant, type AppEnv, type SessionUser } from "./auth";
import { effectiveState, remainingUnits } from "./offers";

export const reservationsApp = new Hono<AppEnv>();

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

// Codigo unico de uso unico: 6 caracteres sem ambiguos. Guarda-se so o hash.
function newPickupCode(): { code: string; hash: string } {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let code = "";
  for (const b of bytes) code += alphabet[b % alphabet.length];
  return { code, hash: createHash("sha256").update(code).digest("hex") };
}

function audit(entity: string, entityId: number, action: string, actorId: number | null) {
  getDb()
    .query("INSERT INTO audit_log (entity, entity_id, action, actor_id) VALUES (?, ?, ?, ?)")
    .run(entity, entityId, action, actorId);
}

function notify(
  userId: number,
  kind: string,
  offerId: number | null,
  reservationId: number | null,
  body: string,
) {
  getDb()
    .query(
      "INSERT INTO notices (user_id, kind, offer_id, reservation_id, body) VALUES (?, ?, ?, ?, ?)",
    )
    .run(userId, kind, offerId, reservationId, body);
  // Push e complementar: o aviso interno acima e o fallback garantido.
  // Fire-and-forget: nunca bloqueia nem quebra a resposta.
  void sendPushToUser(userId, { title: "XepaJá", body });
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

const RES_COLUMNS =
  "id, consumer_id, offer_id, state, idempotency_key, pickup_code_hash, price_cents, address_snapshot, gps_lat, gps_lng, pickup_until, pending_expires_at, cancel_reason, created_at";

// RN-08: ao fim do bloqueio, nova contagem. Limpeza preguicosa ao ler o usuario.
export function refreshBlock(userId: number): {
  misses: number;
  blocked_until: string | null;
} {
  const db = getDb();
  const row = db
    .query("SELECT misses_since_unblock, blocked_until FROM users WHERE id = ?")
    .get(userId) as { misses_since_unblock: number; blocked_until: string | null };
  if (row.blocked_until && row.blocked_until <= nowISO()) {
    db.query("UPDATE users SET blocked_until = NULL, misses_since_unblock = 0 WHERE id = ?").run(
      userId,
    );
    return { misses: 0, blocked_until: null };
  }
  return { misses: row.misses_since_unblock, blocked_until: row.blocked_until };
}

// Expira pendentes sem decisao e confirmadas sem retirada apos a tolerancia.
// Confirmada expirada conta falta; na terceira, bloqueia 10 dias com aviso.
export function sweepExpiries(): { expired_pending: number; expired_confirmed: number } {
  const db = getDb();
  const now = nowISO();
  let expired_pending = 0;
  let expired_confirmed = 0;

  const pendents = db
    .query(
      `SELECT r.id, r.consumer_id, r.offer_id, o.title FROM reservations r
       JOIN offers o ON o.id = r.offer_id
       WHERE r.state = 'pendente' AND (r.pending_expires_at <= ? OR r.pickup_until <= ?)`,
    )
    .all(now, now) as { id: number; consumer_id: number; offer_id: number; title: string }[];
  for (const p of pendents) {
    db.query("UPDATE reservations SET state = 'expirada' WHERE id = ? AND state = 'pendente'").run(
      p.id,
    );
    notify(
      p.consumer_id,
      "request_expired",
      p.offer_id,
      p.id,
      `O pedido da oferta "${p.title}" expirou sem decisao. Nenhuma falta foi registrada e voce ja pode pedir de novo.`,
    );
    audit("reservation", p.id, "expired_pending", null);
    expired_pending += 1;
  }

  const graceCut = nowISO(new Date(Date.now() - GRACE_MINUTES * 60_000));
  const confirmed = db
    .query(
      `SELECT r.id, r.consumer_id, r.offer_id, o.title FROM reservations r
       JOIN offers o ON o.id = r.offer_id
       WHERE r.state = 'confirmada' AND r.pickup_until <= ?`,
    )
    .all(graceCut) as { id: number; consumer_id: number; offer_id: number; title: string }[];
  for (const r of confirmed) {
    const changed = db.query(
      "UPDATE reservations SET state = 'expirada' WHERE id = ? AND state = 'confirmada'",
    ).run(r.id);
    if (Number(changed.changes) === 0) continue;
    const user = db
      .query("SELECT misses_since_unblock FROM users WHERE id = ?")
      .get(r.consumer_id) as { misses_since_unblock: number };
    const misses = user.misses_since_unblock + 1;
    let blocked_until: string | null = null;
    if (misses >= 3) {
      blocked_until = nowISO(new Date(Date.now() + BLOCK_DAYS * 86_400_000));
    }
    db.query(
      "UPDATE users SET misses_since_unblock = ?, blocked_until = ? WHERE id = ?",
    ).run(misses, blocked_until, r.consumer_id);
    notify(
      r.consumer_id,
      blocked_until ? "blocked" : "miss_registered",
      r.offer_id,
      r.id,
      blocked_until
        ? `Terceira falta na oferta "${r.title}". Novas reservas bloqueadas por 10 dias.`
        : `Falta registrada na oferta "${r.title}" (retirada nao feita). Voce tem ${misses} falta(s) desde o ultimo desbloqueio.`,
    );
    audit("reservation", r.id, "expired_miss", null);
    expired_confirmed += 1;
  }
  // Aproximacao do prazo: confirmada com fim em ate 60 min e sem aviso ainda.
  // Preguicoso a cada leitura/escrita; o aviso interno garante o fallback.
  const soonCut = nowISO(new Date(Date.now() + 60 * 60_000));
  const upcoming = db
    .query(
      `SELECT r.id, r.consumer_id, r.offer_id, r.pickup_until, o.title FROM reservations r
       JOIN offers o ON o.id = r.offer_id
       WHERE r.state = 'confirmada' AND r.pickup_until > ? AND r.pickup_until <= ?
         AND NOT EXISTS (SELECT 1 FROM notices n
           WHERE n.reservation_id = r.id AND n.kind = 'pickup_soon')`,
    )
    .all(now, soonCut) as {
    id: number;
    consumer_id: number;
    offer_id: number;
    pickup_until: string;
    title: string;
  }[];
  for (const u of upcoming) {
    notify(
      u.consumer_id,
      "pickup_soon",
      u.offer_id,
      u.id,
      `A retirada da oferta "${u.title}" termina em breve (${u.pickup_until}). Nao perca o prazo para evitar falta.`,
    );
  }
  return { expired_pending, expired_confirmed };
}

function serializeConsumer(row: ReservationRow, code?: string) {
  const offer = getDb()
    .query(
      `SELECT title, pickup_from, gps_lat, gps_lng, photo_path
       FROM offers WHERE id = ?`,
    )
    .get(row.offer_id) as { title: string; pickup_from: string; gps_lat: number | null; gps_lng: number | null; photo_path: string };
  return {
    id: row.id,
    offer_id: row.offer_id,
    offer_title: offer.title,
    state: row.state,
    has_photo: offer.photo_path !== "",
    price_cents: row.price_cents,
    address_snapshot: row.address_snapshot,
    gps_lat: offer.gps_lat,
    gps_lng: offer.gps_lng,
    pickup_from: offer.pickup_from,
    pickup_until: row.pickup_until,
    pending_expires_at: row.pending_expires_at,
    cancel_before: nowISO(new Date(new Date(row.pickup_until).getTime() - CANCEL_TOLERANCE_MINUTES * 60_000)),
    created_at: row.created_at,
    ...(code ? { pickup_code: code } : {}),
  };
}

// RF-15/RN-02/RN-06/RN-10/RN-12: uma ativa por vez, retencao atomica, snapshot,
// idempotencia e bloqueio verificados no servidor.
reservationsApp.post("/reservations", requireAuth, async (c) => {
  const user = c.get("user");
  if (user.role !== "consumer") {
    return c.json(
      { ok: false, code: "forbidden", message: "Reservas sao do perfil consumidor." },
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
      { ok: false, code: "idempotency_required", message: "Reenvie com a mesma chave de idempotencia." },
      400,
    );
  }

  sweepExpiries();
  const block = refreshBlock(user.id);
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
  db.exec("BEGIN IMMEDIATE");
  try {
    const existingKey = db
      .query(`SELECT ${RES_COLUMNS} FROM reservations WHERE idempotency_key = ?`)
      .get(key) as ReservationRow | null;
    if (existingKey) {
      if (existingKey.consumer_id !== user.id || existingKey.offer_id !== offerId) {
        db.exec("ROLLBACK");
        return c.json(
          { ok: false, code: "idempotency_conflict", message: "Chave de idempotencia ja usada em outro pedido." },
          409,
        );
      }
      db.exec("ROLLBACK");
      return c.json({ ok: true, reservation: serializeConsumer(existingKey), repeated: true });
    }

    const active = db
      .query(
        "SELECT id FROM reservations WHERE consumer_id = ? AND state IN ('pendente','confirmada')",
      )
      .get(user.id);
    if (active) {
      db.exec("ROLLBACK");
      return c.json(
        { ok: false, code: "already_active", message: "Voce ja tem uma reserva ativa. Cancele ou conclua antes de pedir de novo." },
        409,
      );
    }

    const offer = db
      .query(
        `SELECT id, establishment_id, title, state, total_units, price_cents,
                address_snapshot, pickup_until, available_from
         FROM offers WHERE id = ?`,
      )
      .get(offerId) as {
      id: number;
      establishment_id: number;
      title: string;
      state: string;
      total_units: number;
      price_cents: number;
      address_snapshot: string;
      pickup_until: string;
      available_from: string;
    } | null;
    const now = nowISO();
    if (!offer || offer.state !== "publicada" || offer.available_from > now || offer.pickup_until <= now) {
      db.exec("ROLLBACK");
      return c.json(
        { ok: false, code: "offer_unavailable", message: "Oferta esgotada, encerrada ou fora da janela." },
        409,
      );
    }
    if (remainingUnits(offer.id, offer.total_units) <= 0) {
      db.exec("ROLLBACK");
      return c.json({ ok: false, code: "sold_out", message: "Oferta esgotada." }, 409);
    }

    // Sem faltas confirma direto; com uma ou duas fica pendente de aceite.
    const direct = block.misses === 0;
    const code = direct ? newPickupCode() : null;
    const inserted = db
      .query(
        `INSERT INTO reservations
         (consumer_id, offer_id, state, idempotency_key, pickup_code_hash,
          price_cents, address_snapshot, pickup_until, pending_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING ${RES_COLUMNS}`,
      )
      .get(
        user.id,
        offer.id,
        direct ? "confirmada" : "pendente",
        key,
        code ? code.hash : "",
        offer.price_cents,
        offer.address_snapshot,
        offer.pickup_until,
        direct ? null : minISO(minutesFromNow(PENDING_MINUTES), offer.pickup_until),
      ) as ReservationRow;

    const owner = db
      .query("SELECT owner_id FROM establishments WHERE id = ?")
      .get(offer.establishment_id) as { owner_id: number };
    if (direct) {
      notify(
        user.id,
        "reservation_confirmed",
        offer.id,
        inserted.id,
        `Reserva confirmada na oferta "${offer.title}". Retire ate ${offer.pickup_until} com seu codigo.`,
      );
      notify(
        owner.owner_id,
        "reservation_confirmed",
        offer.id,
        inserted.id,
        `Nova reserva confirmada na oferta "${offer.title}". Prepare a unidade para retirada.`,
      );
    } else {
      notify(
        owner.owner_id,
        "request_pending",
        offer.id,
        inserted.id,
        `Novo pedido pendente na oferta "${offer.title}". Decida em ate 30 minutos.`,
      );
    }
    audit("reservation", inserted.id, direct ? "confirmed" : "requested_pending", user.id);
    db.exec("COMMIT");
    return c.json(
      { ok: true, reservation: serializeConsumer(inserted, code?.code) },
      direct ? 201 : 201,
    );
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Ja revertido.
    }
    throw err;
  }
});

// RF-16: ativa com limites, faltas e bloqueio; mais historico de concluidas.
reservationsApp.get("/reservations/active", requireAuth, (c) => {
  const user = c.get("user");
  sweepExpiries();
  const block = refreshBlock(user.id);
  const row = getDb()
    .query(
      `SELECT ${RES_COLUMNS} FROM reservations
       WHERE consumer_id = ? AND state IN ('pendente','confirmada')
       ORDER BY id DESC LIMIT 1`,
    )
    .get(user.id) as ReservationRow | null;
  return c.json({
    ok: true,
    reservation: row ? serializeConsumer(row) : null,
    misses_since_unblock: block.misses,
    blocked_until: block.blocked_until,
  });
});

reservationsApp.get("/reservations/history", requireAuth, (c) => {
  sweepExpiries();
  const rows = getDb()
    .query(
      `SELECT ${RES_COLUMNS} FROM reservations
       WHERE consumer_id = ? AND state NOT IN ('pendente','confirmada')
       ORDER BY id DESC LIMIT 50`,
    )
    .all(c.get("user").id) as ReservationRow[];
  return c.json({ ok: true, reservations: rows.map((r) => serializeConsumer(r)) });
});

// RF retirada: comerciante confirma pelo codigo unico, uma vez, dentro da
// janela mais 15 minutos de tolerancia. Codigo errado ou reused nao revela nada.
reservationsApp.post("/reservations/pickup/confirm", requireMerchant, async (c) => {
  sweepExpiries();
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const raw = body && typeof body.code === "string" ? body.code : "";
  const code = raw.trim().toUpperCase();
  if (!code) {
    return c.json({ ok: false, code: "code_required", message: "Informe o codigo de retirada." }, 400);
  }
  const hash = createHash("sha256").update(code).digest("hex");
  const db = getDb();
  const row = db
    .query(`SELECT ${RES_COLUMNS} FROM reservations WHERE pickup_code_hash = ?`)
    .get(hash) as ReservationRow | null;
  if (!row || row.state !== "confirmada" || !ownOfferId(c.get("user").id, row.offer_id)) {
    return c.json({ ok: false, code: "invalid_code", message: "Codigo invalido ou ja usado." }, 404);
  }
  // O sweep ja expirou confirmadas alem da tolerancia; a guarda abaixo cobre corrida.
  if (new Date(row.pickup_until).getTime() + GRACE_MINUTES * 60_000 < Date.now()) {
    return c.json({ ok: false, code: "invalid_code", message: "Codigo invalido ou ja usado." }, 404);
  }
  const changed = db
    .query("UPDATE reservations SET state = 'retirada', pickup_code_hash = '' WHERE id = ? AND state = 'confirmada'")
    .run(row.id);
  if (Number(changed.changes) === 0) {
    return c.json({ ok: false, code: "invalid_code", message: "Codigo invalido ou ja usado." }, 404);
  }
  const offer = db.query("SELECT title FROM offers WHERE id = ?").get(row.offer_id) as {
    title: string;
  };
  const consumer = db.query("SELECT name FROM users WHERE id = ?").get(row.consumer_id) as {
    name: string;
  };
  notify(
    row.consumer_id,
    "pickup_confirmed",
    row.offer_id,
    row.id,
    `Retirada confirmada na oferta "${offer.title}". Obrigado por evitar desperdicio!`,
  );
  audit("reservation", row.id, "picked_up", c.get("user").id);
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
reservationsApp.post("/reservations/:id/cancel", requireAuth, (c) => {
  const user = c.get("user");
  sweepExpiries();
  const id = Number(c.req.param("id"));
  const row = Number.isInteger(id)
    ? (getDb().query(`SELECT ${RES_COLUMNS} FROM reservations WHERE id = ?`).get(id) as ReservationRow | null)
    : null;
  if (!row || row.consumer_id !== user.id) {
    return c.json({ ok: false, code: "not_found", message: "Reserva nao encontrada." }, 404);
  }
  if (row.state === "pendente") {
    getDb().query("UPDATE reservations SET state = 'cancelada' WHERE id = ?").run(id);
    audit("reservation", id, "cancelled_consumer", user.id);
    return c.json({ ok: true });
  }
  if (row.state === "confirmada") {
    const deadline = new Date(row.pickup_until).getTime() - CANCEL_TOLERANCE_MINUTES * 60_000;
    if (Date.now() > deadline) {
      return c.json(
        { ok: false, code: "too_late", message: "Prazo de cancelamento encerrado (15 minutos antes do fim da retirada)." },
        409,
      );
    }
    getDb().query("UPDATE reservations SET state = 'cancelada' WHERE id = ?").run(id);
    audit("reservation", id, "cancelled_consumer", user.id);
    return c.json({ ok: true });
  }
  return c.json(
    { ok: false, code: "invalid_state", message: "Reserva ja concluida ou cancelada." },
    409,
  );
});

function ownOfferId(ownerId: number, offerId: number): boolean {
  const row = getDb()
    .query(
      `SELECT o.id FROM offers o JOIN establishments e ON e.id = o.establishment_id
       WHERE o.id = ? AND e.owner_id = ?`,
    )
    .get(offerId, ownerId);
  return !!row;
}

// RF-21: solicitacoes com indicador de faltas; aceitar ou recusar pendentes.
reservationsApp.get("/reservations/incoming", requireMerchant, (c) => {
  const user = c.get("user");
  sweepExpiries();
  const rows = getDb()
    .query(
      `SELECT r.id, r.offer_id, r.state, r.created_at, r.pending_expires_at, r.pickup_until,
              o.title AS offer_title, u.name AS consumer_name, u.misses_since_unblock AS consumer_misses
       FROM reservations r
       JOIN offers o ON o.id = r.offer_id
       JOIN establishments e ON e.id = o.establishment_id
       JOIN users u ON u.id = r.consumer_id
       WHERE e.owner_id = ? AND r.state IN ('pendente','confirmada')
       ORDER BY r.id DESC`,
    )
    .all(user.id);
  return c.json({ ok: true, reservations: rows });
});

reservationsApp.post("/reservations/:id/accept", requireMerchant, (c) => {
  const user = c.get("user");
  sweepExpiries();
  const id = Number(c.req.param("id"));
  const row = Number.isInteger(id)
    ? (getDb().query(`SELECT ${RES_COLUMNS} FROM reservations WHERE id = ?`).get(id) as ReservationRow | null)
    : null;
  if (!row || row.state !== "pendente" || !ownOfferId(user.id, row.offer_id)) {
    return c.json(
      { ok: false, code: "not_found", message: "Pedido pendente nao encontrado ou ja expirado." },
      404,
    );
  }
  const code = newPickupCode();
  const db = getDb();
  db.query(
    "UPDATE reservations SET state = 'confirmada', pickup_code_hash = ? WHERE id = ?",
  ).run(code.hash, id);
  const offer = db.query("SELECT title FROM offers WHERE id = ?").get(row.offer_id) as {
    title: string;
  };
  notify(
    row.consumer_id,
    "reservation_confirmed",
    row.offer_id,
    id,
    `Pedido aceito na oferta "${offer.title}". Retire ate ${row.pickup_until} com seu codigo.`,
  );
  audit("reservation", id, "accepted", user.id);
  const updated = db.query(`SELECT ${RES_COLUMNS} FROM reservations WHERE id = ?`).get(id) as ReservationRow;
  return c.json({ ok: true, reservation: serializeConsumer(updated), pickup_code: code.code });
});

// RF-22: recusa com motivo, aviso e unidade de volta se a oferta ainda vigente.
reservationsApp.post("/reservations/:id/refuse", requireMerchant, async (c) => {
  const user = c.get("user");
  sweepExpiries();
  const id = Number(c.req.param("id"));
  const row = Number.isInteger(id)
    ? (getDb().query(`SELECT ${RES_COLUMNS} FROM reservations WHERE id = ?`).get(id) as ReservationRow | null)
    : null;
  if (!row || row.state !== "pendente" || !ownOfferId(user.id, row.offer_id)) {
    return c.json(
      { ok: false, code: "not_found", message: "Pedido pendente nao encontrado ou ja expirado." },
      404,
    );
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const reason = body && typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return c.json({ ok: false, code: "reason_required", message: "Informe o motivo da recusa." }, 400);
  }
  const db = getDb();
  db.query("UPDATE reservations SET state = 'recusada', cancel_reason = ? WHERE id = ?").run(reason, id);
  const offer = db.query("SELECT title FROM offers WHERE id = ?").get(row.offer_id) as {
    title: string;
  };
  notify(
    row.consumer_id,
    "request_refused",
    row.offer_id,
    id,
    `Pedido recusado na oferta "${offer.title}": ${reason}. Voce ja pode fazer outro pedido.`,
  );
  audit("reservation", id, "refused", user.id);
  return c.json({ ok: true });
});

// RF-22: comerciante cancela confirmada com motivo e aviso, sem falta.
reservationsApp.post("/reservations/:id/merchant-cancel", requireMerchant, async (c) => {
  const user = c.get("user");
  sweepExpiries();
  const id = Number(c.req.param("id"));
  const row = Number.isInteger(id)
    ? (getDb().query(`SELECT ${RES_COLUMNS} FROM reservations WHERE id = ?`).get(id) as ReservationRow | null)
    : null;
  if (!row || row.state !== "confirmada" || !ownOfferId(user.id, row.offer_id)) {
    return c.json({ ok: false, code: "not_found", message: "Reserva confirmada nao encontrada." }, 404);
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const reason = body && typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return c.json({ ok: false, code: "reason_required", message: "Informe o motivo do cancelamento." }, 400);
  }
  const db = getDb();
  db.query("UPDATE reservations SET state = 'cancelada', cancel_reason = ? WHERE id = ?").run(
    `Cancelada pelo comerciante: ${reason}`,
    id,
  );
  const offer = db.query("SELECT title FROM offers WHERE id = ?").get(row.offer_id) as {
    title: string;
  };
  notify(
    row.consumer_id,
    "merchant_cancelled",
    row.offer_id,
    id,
    `Reserva cancelada na oferta "${offer.title}": ${reason}. Nenhuma falta foi registrada.`,
  );
  audit("reservation", id, "cancelled_merchant", user.id);
  return c.json({ ok: true });
});

export type { SessionUser };
