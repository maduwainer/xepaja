// Operação destrutiva explícita, nunca executada pelo seed normal.
// bun run seed --recreate-reservations [--apply]
// Preserva total, status e vínculos. Faça também pg_dump e backup de data antes de --apply.
import type { JSONValue } from "postgres";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { getDb, closeDb, migrate } from "../src/api/db";
import { captureReservationSnapshot, encryptPickupCode } from "../src/api/reservation-data";

export async function recreateReservations(apply = false) {
  await migrate();
  const db = getDb();
  const preview = await db`SELECT state, COUNT(*)::int AS count FROM reservations GROUP BY state ORDER BY state`;
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", distribution: preview }));
  if (!apply) return;
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "");
  const dir = `data/reservation-backups/${stamp}`;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  await db.begin(async tx => {
    // Bloqueia mudanças concorrentes durante o backup e a substituição atômica.
    await tx`LOCK TABLE users, establishments, items, offers, offer_items, reservations, notices IN EXCLUSIVE MODE`;
    const old = await tx`SELECT * FROM reservations ORDER BY created_at, id`;
    const notices = await tx`SELECT * FROM notices WHERE reservation_id IS NOT NULL`;
    writeFileSync(`${dir}/before.json`, JSON.stringify({ reservations: old, notices }, null, 2), { flag: "wx", mode: 0o600 });
    const activeByUser = new Set<number>();
    const retained = new Map<number, number>();
    for (const r of old) {
      if (r.state === "confirmada") {
        if (activeByUser.has(r.consumer_id)) throw new Error("Mais de uma reserva ativa para o mesmo consumidor; substituição abortada.");
        activeByUser.add(r.consumer_id);
      }
      if (["confirmada", "retirada"].includes(r.state)) retained.set(r.offer_id, (retained.get(r.offer_id) ?? 0) + 1);
    }
    for (const [id, n] of retained) {
      const [offer] = await tx`SELECT total_units FROM offers WHERE id = ${id}`;
      if (n > offer.total_units) throw new Error(`Oferta ${id} sem capacidade para manter as reservas; abortado.`);
    }
    const mapping: { old_id: number; new_id: number; consumer_id: number; offer_id: number; state: string }[] = [];
    const now = Date.now();
    for (let index = 0; index < old.length; index++) {
      const r = old[index];
      const active = r.state === "confirmada";
      const created = new Date(active ? now - 5 * 60_000 : now - (old.length - index + 1) * 86400_000).toISOString();
      const pickupFrom = new Date(active ? now - 15 * 60_000 : Date.parse(created) + 3600_000).toISOString();
      const pickupUntil = new Date(active ? now + 4 * 3600_000 : Date.parse(created) + 3 * 3600_000).toISOString();
      const snapshot = await captureReservationSnapshot(tx, r.offer_id);
      snapshot.pickup_from = pickupFrom;
      snapshot.pickup_until = pickupUntil;
      if (!snapshot.photo_path || !snapshot.items.length) throw new Error(`Reserva ${r.id} sem foto ou composição; abortado.`);
      // Não gerar imagens artificiais nem trocar fotos das ofertas. Cópias preservam o acervo existente.
      const code = r.state === "confirmada" ? Array.from(randomBytes(6), b => { const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; return alphabet[b % alphabet.length]; }).join("") : "";
      const [replacement] = await tx`INSERT INTO reservations
        (consumer_id, offer_id, state, idempotency_key, pickup_code_hash, pickup_code_encrypted,
         price_cents, address_snapshot, gps_lat, gps_lng, pickup_until, pending_expires_at,
         cancel_reason, created_at, updated_at, snapshot, decided_at, picked_at)
        VALUES (${r.consumer_id}, ${r.offer_id}, ${r.state}, ${`recreated-${stamp}-${r.id}`},
          ${code ? createHash("sha256").update(code).digest("hex") : ""}, ${code ? encryptPickupCode(code) : ""},
          ${r.price_cents}, ${r.address_snapshot}, ${snapshot.gps_lat}, ${snapshot.gps_lng}, ${pickupUntil},
          null,
          ${r.cancel_reason}, ${created}, ${created}, ${tx.json(snapshot as unknown as JSONValue)},
          ${["recusada", "confirmada", "retirada"].includes(r.state) ? created : null},
          ${r.state === "retirada" ? pickupFrom : null}) RETURNING id`;
      await tx`UPDATE notices SET reservation_id = ${replacement.id},
        body = ${`Reserva #${replacement.id} da oferta "${snapshot.title}": ${r.state}.${r.cancel_reason ? ` Motivo: ${r.cancel_reason}` : ""}`}
        WHERE reservation_id = ${r.id}`;
      await tx`INSERT INTO audit_log(entity, entity_id, action) VALUES ('reservation', ${r.id}, ${`replaced_by_${replacement.id}`})`;
      await tx`DELETE FROM reservations WHERE id = ${r.id}`;
      // Operação de manutenção do sistema, não ação praticada pelo consumidor.
      await tx`INSERT INTO audit_log(entity, entity_id, action) VALUES ('reservation', ${replacement.id}, ${`recreated_from_${r.id}`})`;
      mapping.push({ old_id: r.id, new_id: replacement.id, consumer_id: r.consumer_id, offer_id: r.offer_id, state: r.state });
    }
    const after = await tx`SELECT state, COUNT(*)::int AS count FROM reservations GROUP BY state ORDER BY state`;
    const before = Object.entries(old.reduce<Record<string, number>>((counts, r) => { counts[r.state] = (counts[r.state] ?? 0) + 1; return counts; }, {})).sort();
    if (JSON.stringify(before) !== JSON.stringify(after.map(r => [r.state, r.count]))) throw new Error("Distribuição divergente; transação revertida.");
    writeFileSync(`${dir}/mapping.json`, JSON.stringify(mapping, null, 2), { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ recreated: mapping.length, distribution: after, backup: dir }));
  });
}

if (import.meta.main) {
  try { await recreateReservations(process.argv.includes("--apply")); }
  finally { await closeDb(); }
}
