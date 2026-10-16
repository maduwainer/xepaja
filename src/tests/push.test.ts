import { beforeAll, describe, expect, test } from "bun:test";
import { app } from "../src/api/index";
import { getDb, migrate, truncateAll } from "../src/api/db";

let counter = 6000;
function uniqueEmail(): string {
  counter += 1;
  return `fase6-push-${Date.now()}-${counter}@exemplo.com`;
}

async function signup(): Promise<{ cookie: string; id: number; email: string }> {
  const email = uniqueEmail();
  const res = await app.request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Notificado",
      cpf: "11144477735",
      email,
      password: "senha-segura-60",
      role: "consumer",
      search_radius_km: 10,
    }),
  });
  expect(res.status).toBe(201);
  return { cookie: (res.headers.get("set-cookie") ?? "").split(";")[0], id: (await res.json()).user.id, email };
}

beforeAll(async () => { await migrate(); await truncateAll(); });

describe("push e avisos", () => {
  test("vapid-key expoe a chave publica", async () => {
    const res = await app.request("/api/push/vapid-key");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.publicKey).toBe("string");
    expect(body.publicKey.length).toBeGreaterThan(20);
  });

  test("subscribe e unsubscribe com validacao e auth", async () => {
    const user = await signup();
    const sub = {
      endpoint: "https://push.exemplo.dev/sub-123",
      keys: { p256dh: "dh-chave", auth: "auth-segredo" },
    };
    const anon = await app.request("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub),
    });
    expect(anon.status).toBe(401);

    const bad = await app.request("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: user.cookie },
      body: JSON.stringify({ endpoint: "http://inseguro/sub" }),
    });
    expect(bad.status).toBe(400);

    const ok = await app.request("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: user.cookie },
      body: JSON.stringify(sub),
    });
    expect(ok.status).toBe(200);
    // Reinscricao nao duplica.
    const again = await app.request("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: user.cookie },
      body: JSON.stringify(sub),
    });
    expect(again.status).toBe(200);
    const countRows = await getDb()`SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE user_id = ${user.id}`;
    expect((countRows[0] as { n: number }).n).toBe(1);

    const out = await app.request("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: user.cookie },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    expect(out.status).toBe(200);
    const afterRows = await getDb()`SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE user_id = ${user.id}`;
    expect((afterRows[0] as { n: number }).n).toBe(0);
  });

  test("aviso interno e garantido mesmo sem inscricao push", async () => {
    const user = await signup();
    // Inscricao para endpoint inalancavel: o push falha em background,
    // mas o aviso interno continua la.
    await app.request("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: user.cookie },
      body: JSON.stringify({
        endpoint: "https://push.invalid/sub-xyz",
        keys: { p256dh: "dh", auth: "auth" },
      }),
    });
    await getDb()`INSERT INTO notices (user_id, kind, body) VALUES (${user.id}, 'request_expired', 'expirou')`;
    const list = await app.request("/api/notices", { headers: { Cookie: user.cookie } });
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.notices.length).toBeGreaterThan(0);
    expect(typeof body.unread).toBe("number");
  });
});
