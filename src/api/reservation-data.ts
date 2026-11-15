import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import type { DbClient } from "./db";
import type { ReservationSnapshot } from "../shared/types";

// Persistir este diretório separadamente do banco, inclusive em backups.
let key: Buffer | undefined;
function codeKey(): Buffer {
  if (key) return key;
  const dir = "data/secrets";
  const path = `${dir}/reservation-code.key`;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(path, randomBytes(32), { flag: "wx", mode: 0o600 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  key = readFileSync(path);
  if (key.length !== 32) throw new Error("Chave de proteção dos códigos inválida.");
  return key;
}

export function encryptPickupCode(code: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", codeKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function decryptPickupCode(value: string): string | undefined {
  if (!value) return undefined; // reservas legadas não são reconstituídas com dados inventados
  const bytes = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", codeKey(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
}

function formatNoticeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${date} às ${time}`;
}
export { formatNoticeDate };
export async function captureReservationSnapshot(db: DbClient, offerId: number): Promise<ReservationSnapshot> {
  const [o] = await db`SELECT o.title, o.kind, o.photo_path, o.pickup_from, o.pickup_until,
    o.gps_lat, o.gps_lng, o.storage_notes, o.box_description, e.name AS establishment_name,
    e.reference, u.name AS merchant_name
    FROM offers o JOIN establishments e ON e.id = o.establishment_id
    JOIN users u ON u.id = e.owner_id WHERE o.id = ${offerId}`;
  if (!o) throw new Error("Oferta não encontrada para registrar a reserva.");
  const items = await db`SELECT i.id AS item_id, i.name, i.unit, oi.qty_per_unit
    FROM offer_items oi JOIN items i ON i.id = oi.item_id
    WHERE oi.offer_id = ${offerId} ORDER BY i.name`;
  const photoRows = await db`SELECT path FROM offer_photos WHERE offer_id = ${offerId} ORDER BY position, id`;
  let photo_path = o.photo_path as string;
  const photos: string[] = [];
  mkdirSync("data/uploads/reservations", { recursive: true });
  const sources: string[] = photoRows.length > 0 ? (photoRows as unknown as { path: string }[]).map((r) => r.path) : (o.photo_path ? [o.photo_path as string] : []);
  for (const src of sources) {
    try {
      const dest = `data/uploads/reservations/${randomBytes(16).toString("hex")}${extname(src)}`;
      copyFileSync(src, dest);
      photos.push(dest);
    } catch {
      // Foto ausente: segue sem ela, sem inventar caminho.
    }
  }
  if (photos.length > 0) photo_path = photos[0];
  return { title: o.title, kind: o.kind, photo_path: photo_path ?? "", photos, box_description: (o.box_description as string) ?? "",
    establishment_name: o.establishment_name, merchant_name: o.merchant_name,
    reference: o.reference, pickup_from: o.pickup_from, pickup_until: o.pickup_until,
    gps_lat: o.gps_lat, gps_lng: o.gps_lng, storage_notes: o.storage_notes,
    items: items.map(i => ({ item_id: i.item_id, name: i.name, unit: i.unit, qty_per_unit: i.qty_per_unit })) };
}
