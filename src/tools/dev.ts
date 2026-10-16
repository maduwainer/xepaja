export {};

// Dev com live reload: sobe API com restart automatico e rebuilda o front a cada save.
// Equivalente ao watch do uberpath (tools/build.ts --watch), adaptado para a
// stack XepaJá: backend Hono via bun --watch, frontend React via bun build --watch.
// Uso: dentro de src, suba o banco (docker compose up -d db), rode bun run watch
// e abra http://localhost:3000. O watch aguarda o Postgres e roda o migrate
// sozinho antes de subir a API.
// O navegador recarrega sozinho em localhost via poller em public/index.html.
import { closeDb, migrate, waitForDb } from "../src/api/db";

await waitForDb();
await migrate();
await closeDb();
console.log("dev: banco pronto, subindo api e web...");

const api = Bun.spawn(["bun", "--watch", "src/api/index.ts"], {
  stdout: "inherit",
  stderr: "inherit",
});

const web = Bun.spawn(
  [
    "bun",
    "build",
    "src/web/main.tsx",
    "--outdir=public/dist",
    "--target=browser",
    "--sourcemap=inline",
    "--watch",
  ],
  { stdout: "inherit", stderr: "inherit" },
);

function shutdown(signal: string) {
  console.log(`dev: recebendo ${signal}, encerrando api e web...`);
  try { api.kill(); } catch {}
  try { web.kill(); } catch {}
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

const apiCode = await api.exited;
console.log(`dev: api encerrou com codigo ${apiCode}`);
try { web.kill(); } catch {}
const webCode = await web.exited;
console.log(`dev: web encerrou com codigo ${webCode}`);
process.exit(typeof apiCode === "number" ? apiCode : 0);
