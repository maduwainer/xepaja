import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { getDb, migrate } from "./db";
import type { HealthResponse } from "../shared/types";
import { usersApp } from "./users";
import { establishmentsApp } from "./establishments";
import { offersApp } from "./offers";
import { reservationsApp } from "./reservations";
import { noticesApp } from "./notices";
import { pushApp } from "./push";
import { passwordApp } from "./password";
import type { AppEnv } from "./auth";

export const app = new Hono<AppEnv>();

app.get("/api/health", async (c) => {
  try {
    await getDb()`SELECT 1`;
  } catch {
    return c.json({ ok: false, service: "xepaja", db: "down" }, 503);
  }
  const body: HealthResponse = {
    ok: true,
    service: "xepaja",
    time: new Date().toISOString(),
  };
  return c.json({ ...body, db: "up" });
});

app.route("/api", usersApp);
app.route("/api", establishmentsApp);
app.route("/api", offersApp);
app.route("/api", reservationsApp);
app.route("/api", noticesApp);
app.route("/api", pushApp);
app.route("/api", passwordApp);

// Arquivos estaticos do PWA. O bundle do React e gerado em public/dist.
app.use("/dist/*", serveStatic({ root: "./public" }));
app.use("/icons/*", serveStatic({ root: "./public" }));
app.use("/seed-photos/*", serveStatic({ root: "./public" }));
app.use("/styles.css", serveStatic({ path: "./public/styles.css" }));
app.use(
  "/manifest.webmanifest",
  serveStatic({ path: "./public/manifest.webmanifest" }),
);
app.use("/sw.js", serveStatic({ path: "./public/sw.js" }));
app.use("/offline.html", serveStatic({ path: "./public/offline.html" }));
app.get("/", serveStatic({ path: "./public/index.html" }));

// Fallback SPA: qualquer GET fora de /api volta para o shell do app.
// Rotas de /api inexistentes retornam 404 JSON para nao mascarar erro.
app.notFound(async (c) => {
  if (c.req.path.startsWith("/api")) {
    return c.json(
      { ok: false, code: "not_found", message: "Rota da API nao existe." },
      404,
    );
  }
  const file = Bun.file("./public/index.html");
  return new Response(await file.arrayBuffer(), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});

if (import.meta.main) {
  await migrate();
  const port = Number(process.env.PORT ?? 3000);
  Bun.serve({ port, fetch: app.fetch });
  console.log(`xepaja api up on http://localhost:${port}`);
}
