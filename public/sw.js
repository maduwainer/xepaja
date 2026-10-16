// Service worker do PWA XepaJá.
// Estrategia: shell em cache, /api sempre na rede, /dist network-first
// (para o watch em dev funcionar), navegacoes com fallback offline.
// Versao do cache do shell: aumentar sempre que index.html, styles.css,
// offline.html ou manifest mudarem, senao o SW serve o shell antigo.
const CACHE = "xepaja-v4";
const SHELL = ["/", "/offline.html", "/manifest.webmanifest", "/styles.css"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("push", (event) => {
  // Complemento do aviso interno: se o push falhar ou nao existir
  // inscricao, a lista de Avisos no app continua valendo.
  let data = { title: "XepaJá", body: "Voce tem um aviso novo.", url: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // Mantem o padrao.
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon.svg",
      data: { url: data.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) return; // nunca responder API do cache

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
        return res;
      }).catch(() => caches.match("/offline.html")),
    );
    return;
  }

  if (url.pathname.startsWith("/dist/")) {
    event.respondWith(
      fetch(req, { cache: "no-store" }).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
        return res;
      }).catch(() => caches.match(req)),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => hit ?? fetch(req).catch(() => caches.match("/offline.html"))),
  );
});
