import { describe, expect, test } from "bun:test";

// Regressao da Fase 6/Leaflet: um insert quebrou a sintaxe do sw.js e o
// navegador recusou a atualizacao em silencio (evaluation failed),
// prendendo shell antigo no cache. Este teste quebra o build antes.
describe("service worker", () => {
  test("sw.js continua com sintaxe valida", async () => {
    const src = await Bun.file("public/sw.js").text();
    expect(src).toContain("addEventListener");
    let error: unknown = null;
    try {
      new Function(src);
    } catch (err) {
      error = err;
    }
    expect(error).toBeNull();
  });
});
