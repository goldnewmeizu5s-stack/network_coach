const CACHE_NAME = "netcrm-v1";
const STATIC_ASSETS = ["/manifest.json", "/icon-192.svg", "/icon-512.svg"];

// Install: cache only truly static assets (icons, manifest)
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch strategy
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API requests: network-only (no caching)
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request).catch(
        () =>
          new Response(
            JSON.stringify({ error: "Offline" }),
            { headers: { "Content-Type": "application/json" }, status: 503 }
          )
      )
    );
    return;
  }

  // HTML (navigation requests, index.html): network-first
  // Critical: always fetch latest HTML so it references current hashed JS/CSS
  if (
    event.request.mode === "navigate" ||
    url.pathname === "/" ||
    url.pathname.endsWith(".html")
  ) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(event.request).then(
            (cached) =>
              cached ||
              new Response(
                '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><style>body{background:#0f0f0f;color:#f5f5f5;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center}h1{font-size:1.5rem;margin-bottom:0.5rem}p{color:#888}</style></head><body><div><h1>Нет подключения</h1><p>Данные будут обновлены при восстановлении связи.</p></div></body></html>',
                { headers: { "Content-Type": "text/html" } }
              )
          )
        )
    );
    return;
  }

  // Hashed assets (JS/CSS from Vite): cache-first (safe — hash changes on rebuild)
  // Icons/SVGs/manifest: cache-first
  if (
    url.pathname.match(/\.[a-f0-9]{8,}\.(js|css)$/) ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".ico") ||
    url.pathname === "/manifest.json"
  ) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return response;
          })
      )
    );
    return;
  }

  // Everything else: network-first with cache fallback
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || new Response("", { status: 404 })))
  );
});
