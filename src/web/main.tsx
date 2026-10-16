import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Elemento #root nao encontrado em index.html.");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Registra o service worker do PWA onde houver suporte.
// Em localhost ele tambem registra, mas o fetch de /api e /dist usa
// estrategia network-first, entao o watch continua com live reload.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Sem suporte ou falha: o app segue funcionando online, sem PWA.
    });
  });
}
