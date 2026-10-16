export {};

// Build de producao do front React. Uso: bun run build.
// Gera public/dist para a API Hono servir como estatico.
const result = await Bun.build({
  entrypoints: ["src/web/main.tsx"],
  outdir: "public/dist",
  target: "browser",
  sourcemap: "none",
  minify: true,
});

if (!result.success) {
  console.error("Build falhou:");
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const bytes = result.outputs.reduce((acc, o) => acc + (o.size ?? 0), 0);
console.log(`build ok: ${result.outputs.length} arquivos, ${bytes} bytes em public/dist`);
