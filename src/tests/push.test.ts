import { beforeAll, describe, expect, test } from "bun:test";
import { app } from "../src/api/index";
import { getDb, migrate } from "../src/api/db";

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

beforeAll(() => migrate());

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
    const count = getDb()
      .query("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?")
      .get(user.id) as { n: number };
    expect(count.n).toBe(1);

    const out = await app.request("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: user.cookie },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    expect(out.status).toBe(200);
    const after = getDb()
      .query("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?")
      .get(user.id) as { n: number };
    expect(after.n).toBe(0);
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
    getDb()
      .query("INSERT INTO notices (user_id, kind, body) VALUES (?, 'request_expired', 'expirou')")
      .run(user.id);
    const list = await app.request("/api/notices", { headers: { Cookie: user.cookie } });
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.notices.length).toBeGreaterThan(0);
    expect(typeof body.unread).toBe("number");
  });
});
