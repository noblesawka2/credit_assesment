const SHELL_CACHE = "nobles-shell-v1";
const SHELL = ["/", "/app.js", "/style.css", "/icon.svg", "/manifest.webmanifest"];
self.addEventListener("install", event => event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("nobles-shell-") && key !== SHELL_CACHE).map(key => caches.delete(key))))));
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET" || url.search || url.pathname.startsWith("/api/")) return;
  if (SHELL.includes(url.pathname)) {
    event.respondWith(fetch(event.request).catch(() => caches.match(url.pathname).then(cached => cached || Response.error())));
  } else if (event.request.mode === "navigate" && url.pathname.startsWith("/credit/")) {
    event.respondWith(fetch(event.request).catch(() => caches.match("/").then(cached => cached || Response.error())));
  }
});
