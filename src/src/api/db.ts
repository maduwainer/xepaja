import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const DB_PATH = process.env.XEPAJA_DB
  ? resolve(process.env.XEPAJA_DB)
  : resolve(import.meta.dir, "..", "..", "data", "xepaja.sqlite");

let db: Database | null = null;

export function getDb(): Database {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

// Schema inicial da Fase 0. Tabelas criadas com IF NOT EXISTS para migrate limpo.
// Colunas cobrem o dominio do MVP (contas, estabelecimento, itens, ofertas,
// reservas com snapshot e idempotencia, avisos, reset de senha, auditoria).
// Logica de transicao (faltas, bloqueio, expiracao) entra nas Fases 4 e 5.
export function migrate(): void {
  const conn = getDb();
  conn.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cpf TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('consumer','merchant')),
      search_radius_km REAL NOT NULL DEFAULT 10,
      misses_since_unblock INTEGER NOT NULL DEFAULT 0,
      blocked_until TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS establishments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('feira','mercearia')),
      cnpj TEXT,
      address_text TEXT NOT NULL,
      reference TEXT NOT NULL DEFAULT '',
      hours TEXT NOT NULL DEFAULT '',
      gps_lat REAL,
      gps_lng REAL,
      gps_captured_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('item','caixa')),
      photo_path TEXT NOT NULL DEFAULT '',
      total_units INTEGER NOT NULL,
      price_cents INTEGER NOT NULL,
      is_free INTEGER NOT NULL DEFAULT 0,
      address_snapshot TEXT NOT NULL DEFAULT '',
      gps_lat REAL,
      gps_lng REAL,
      available_from TEXT NOT NULL DEFAULT '',
      pickup_from TEXT NOT NULL DEFAULT '',
      pickup_until TEXT NOT NULL DEFAULT '',
      storage_notes TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'rascunho'
        CHECK (state IN ('rascunho','publicada','esgotada','encerrada','cancelada','expirada')),
      cancel_reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS offer_items (
      offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
      qty_per_unit REAL NOT NULL,
      PRIMARY KEY (offer_id, item_id)
    );
    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      consumer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
      state TEXT NOT NULL DEFAULT 'pendente'
        CHECK (state IN ('pendente','confirmada','recusada','retirada','cancelada','expirada')),
      idempotency_key TEXT NOT NULL UNIQUE,
      pickup_code_hash TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL DEFAULT 0,
      address_snapshot TEXT NOT NULL DEFAULT '',
      gps_lat REAL,
      gps_lng REAL,
      pickup_until TEXT NOT NULL DEFAULT '',
      cancel_reason TEXT NOT NULL DEFAULT '',
      decided_at TEXT,
      picked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      offer_id INTEGER REFERENCES offers(id) ON DELETE SET NULL,
      reservation_id INTEGER REFERENCES reservations(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_offers_establishment ON offers(establishment_id);
    CREATE INDEX IF NOT EXISTS idx_offers_state ON offers(state);
    CREATE INDEX IF NOT EXISTS idx_reservations_consumer ON reservations(consumer_id);
    CREATE INDEX IF NOT EXISTS idx_reservations_offer ON reservations(offer_id);
    CREATE INDEX IF NOT EXISTS idx_notices_user ON notices(user_id);
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
  `);
  // Evolucao aditiva do schema (Fase 4): expiracao do pendente.
  const cols = conn.query("PRAGMA table_info(reservations)").all() as { name: string }[];
  if (!cols.some((col) => col.name === "pending_expires_at")) {
    conn.exec("ALTER TABLE reservations ADD COLUMN pending_expires_at TEXT");
  }
}

if (import.meta.main) {
  migrate();
  console.log(`migrate ok: ${DB_PATH}`);
}
