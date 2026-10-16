// Prepara o banco de teste: recria xepaja_test do zero e roda o migrate.
// Uso: XEPAJA_TEST=1 bun tools/reset-test-db.ts (via bun test).
// Conecta no banco de manutencao (postgres) para DROP/CREATE, pois o alvo
// nao pode ter conexoes abertas na hora do drop.
import postgres from "postgres";
import { closeDb, migrate } from "../src/api/db";

const testUrl = process.env.DATABASE_URL_TEST ?? "";
if (!testUrl) {
  throw new Error("Defina DATABASE_URL_TEST no .env (ver .env.example).");
}
const parsed = new URL(testUrl);
const dbName = parsed.pathname.replace(/^\//, "");
if (!dbName) throw new Error("DATABASE_URL_TEST sem nome de banco.");
if (dbName === "postgres") throw new Error("DATABASE_URL_TEST nao pode ser o banco postgres.");

parsed.pathname = "/postgres";
const admin = postgres(parsed.toString());
await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
await admin.unsafe(`CREATE DATABASE "${dbName}"`);
await admin.end();

process.env.XEPAJA_TEST = "1";
await migrate();
await closeDb();
console.log(`banco de teste pronto: ${dbName}`);
