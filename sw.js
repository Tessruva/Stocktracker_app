const CACHE = "watchlist-v2";
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
  // Cache-first for the app shell; everything else (API calls to your backend) goes to the network.
  if (event.request.method !== "GET" || !SHELL.some((p) => event.request.url.endsWith(p.replace("./", "")))) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});

// Real background alerts: your backend server sends a Web Push message
// (triggered by its own /api/check, called on a schedule by an external
// cron pinger — see server/README setup). This fires even if the app and
// the browser are both fully closed, as long as the OS allows push delivery
// (which Android does, reliably, since this is standard Web Push — not the
// best-effort Periodic Background Sync the first version relied on).
self.addEventListener("push", (event) => {
  let data = { title: "Watchlist", body: "" };
  try {
    data = event.data ? event.data.json() : data;
  } catch (e) {
    data.body = event.data ? event.data.text() : "";
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Watchlist", {
      body: data.body || "",
      icon: "icons/icon-192.png",
      vibrate: [200, 100, 200],
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      if (clients.length > 0) return clients[0].focus();
      return self.clients.openWindow("./index.html");
    })
  );
});
