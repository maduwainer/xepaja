import { Hono } from "hono";
import { getDb } from "./db";
import { requireAuth, type AppEnv } from "./auth";
import { sweepExpiries } from "./reservations";

export const noticesApp = new Hono<AppEnv>();

// Avisos internos: mesma informacao do push, garantida no app.
noticesApp.get("/notices", requireAuth, (c) => {
  sweepExpiries();
  const rows = getDb()
    .query(
      `SELECT id, kind, offer_id, reservation_id, body, read_at, created_at
       FROM notices WHERE user_id = ? ORDER BY id DESC LIMIT 50`,
    )
    .all(c.get("user").id);
  const unread = getDb()
    .query("SELECT COUNT(*) AS n FROM notices WHERE user_id = ? AND read_at IS NULL")
    .get(c.get("user").id) as { n: number };
  return c.json({ ok: true, notices: rows, unread: unread.n });
});

noticesApp.post("/notices/:id/read", requireAuth, (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) {
    return c.json({ ok: false, code: "not_found", message: "Aviso nao encontrado." }, 404);
  }
  const changed = getDb()
    .query("UPDATE notices SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND user_id = ? AND read_at IS NULL")
    .run(id, c.get("user").id);
  if (Number(changed.changes) === 0) {
    return c.json({ ok: false, code: "not_found", message: "Aviso nao encontrado." }, 404);
  }
  return c.json({ ok: true });
});
