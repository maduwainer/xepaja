import { describe, expect, test } from "bun:test";
import { app } from "../src/api/index";

describe("api basica", () => {
  test("GET /api/health responde ok", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe("xepaja");
  });

  test("rota /api desconhecida retorna 404 JSON", async () => {
    const res = await app.request("/api/nao-existe");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});
