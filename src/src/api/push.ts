import webpush from "web-push";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { getDb } from "./db";
import { requireAuth, type AppEnv } from "./auth";

export const pushApp = new Hono<AppEnv>();

const SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:xepaja@localhost";

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

// Chaves VAPID: do ambiente ou geradas uma vez em data/ (fora do git).
function loadVapidKeys(): VapidKeys {
  const fromEnv = {
    publicKey: process.env.VAPID_PUBLIC_KEY ?? "",
    privateKey: process.env.VAPID_PRIVATE_KEY ?? "",
  };
  if (fromEnv.publicKey && fromEnv.privateKey) return fromEnv;
  const dir = join(process.cwd(), "data");
  const file = join(dir, "vapid.json");
  if (existsSync(file)) {
    return JSON.parse(readFileSync(file, "utf8")) as VapidKeys;
  }
  const generated = webpush.generateVAPIDKeys();
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(generated, null, 2), { mode: 0o600 });
  return generated;
}

const vapid = loadVapidKeys();
webpush.setVapidDetails(SUBJECT, vapid.publicKey, vapid.privateKey);

export function vapidPublicKey(): string {
  return vapid.publicKey;
}

interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

// Push e best-effort com fallback garantido no aviso interno: nunca rejeita,
// nunca bloqueia a resposta; inscricoes mortas (404/410) sao removidas.
export async function sendPushToUser(userId: number, payload: PushPayload): Promise<void> {
  const subs = getDb()
    .query("SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?")
    .all(userId) as { id: number; endpoint: string; p256dh: string; auth: string }[];
  if (subs.length === 0) return;
  const data = JSON.stringify({ ...payload, url: payload.url ?? "/" });
  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          data,
        );
      } catch (err) {
        const status = (err as { statusCode?: number })?.statusCode ?? 0;
        if (status === 404 || status === 410) {
          getDb().query("DELETE FROM push_subscriptions WHERE id = ?").run(sub.id);
        }
      }
    }),
  );
}

pushApp.get("/push/vapid-key", (c) => {
  return c.json({ ok: true, publicKey: vapid.publicKey });
});

pushApp.post("/push/subscribe", requireAuth, async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const endpoint = body && typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  const keys = (body?.keys ?? {}) as Record<string, unknown>;
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh : "";
  const auth = typeof keys.auth === "string" ? keys.auth : "";
  if (!endpoint.startsWith("https://") || !p256dh || !auth) {
    return c.json({ ok: false, code: "invalid_subscription", message: "Inscricao invalida." }, 400);
  }
  getDb()
    .query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id,
         p256dh = excluded.p256dh, auth = excluded.auth`,
    )
    .run(c.get("user").id, endpoint, p256dh, auth);
  return c.json({ ok: true });
});

pushApp.post("/push/unsubscribe", requireAuth, async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const endpoint = body && typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  if (endpoint) {
    getDb()
      .query("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?")
      .run(c.get("user").id, endpoint);
  }
  return c.json({ ok: true });
});
