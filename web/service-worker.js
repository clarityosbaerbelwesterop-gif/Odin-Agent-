const CACHE_NAME = "odin-public-shell-v1";
const PUBLIC_SHELL = new Set([
  "/",
  "/landing.css",
  "/landing.js",
  "/manifest.webmanifest",
  "/odin-mark.svg",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([...PUBLIC_SHELL])).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/login") ||
    url.pathname.startsWith("/app") ||
    url.pathname.startsWith("/browser") ||
    url.pathname.startsWith("/bot")
  ) {
    event.respondWith(fetch(request));
    return;
  }

  if (!PUBLIC_SHELL.has(url.pathname)) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
        }
        return response;
      })
      .catch(async () => (await caches.match(request)) ?? Response.error()),
  );
});
