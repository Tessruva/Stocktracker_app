const CACHE = "watchlist-v3";
const SHELL = ["./", "./index.html", "./style.css", "./app.js", "./db.js", "./manifest.json", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !SHELL.some((p) => event.request.url.endsWith(p.replace("./", "")))) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});

// Real background alerts via Web Push (sent by your server's /api/check cron).
self.addEventListener("push", (event) => {
  let data = { title: "Watchlist", body: "" };
  try {
    data = event.data ? event.data.json() : data;
  } catch (e) {
    data.body = event.data ? event.data.text() : "";
  }
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(data.title || "Watchlist", {
        body: data.body || "",
        icon: "icons/icon-192.png",
        vibrate: [200, 100, 200],
      });
      // Tell any open tab/window of the app to refresh its data right now,
      // instead of showing a stale price until the person manually reloads.
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      clientsList.forEach((client) => client.postMessage({ type: "REFRESH" }));
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      if (clients.length > 0) {
        clients[0].postMessage({ type: "REFRESH" });
        return clients[0].focus();
      }
      return self.clients.openWindow("./index.html");
    })
  );
});
