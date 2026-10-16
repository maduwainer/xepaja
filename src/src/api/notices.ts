import { Hono } from "hono";
import { getDb } from "./db";
import { requireAuth, type AppEnv } from "./auth";
import { sweepExpiries } from "./reservations";

export const noticesApp = new Hono<AppEnv>();

// Avisos internos: mesma informacao do push, garantida no app.
noticesApp.get("/notices", requireAuth, async (c) => {
  await sweepExpiries();
  const rows = await getDb()`SELECT id, kind, offer_id, reservation_id, body, read_at, created_at
       FROM notices WHERE user_id = ${c.get("user").id} ORDER BY id DESC LIMIT 50`;
  const unreadRows = await getDb()`SELECT COUNT(*)::int AS n FROM notices WHERE user_id = ${c.get("user").id} AND read_at IS NULL`;
  return c.json({ ok: true, notices: rows, unread: (unreadRows[0] as { n: number }).n });
});

noticesApp.post("/notices/:id/read", requireAuth, async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) {
    return c.json({ ok: false, code: "not_found", message: "Aviso nao encontrado." }, 404);
  }
  const changed = await getDb()`UPDATE notices SET read_at = now() WHERE id = ${id} AND user_id = ${c.get("user").id} AND read_at IS NULL RETURNING id`;
  if (changed.length === 0) {
    return c.json({ ok: false, code: "not_found", message: "Aviso nao encontrado." }, 404);
  }
  return c.json({ ok: true });
});
