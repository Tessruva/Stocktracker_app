// Minimal key-value store over IndexedDB. Shared by the page (app.js) and
// the service worker (sw.js) so both sides see the same watchlist and API key.
const DB_NAME = "watchlist-db";
const STORE = "kv";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const DEFAULT_CONFIG = { backendUrl: "", accessToken: "", pollSeconds: 60, stocks: [] };

async function getConfig() {
  const cfg = await dbGet("config");
  return cfg || DEFAULT_CONFIG;
}

async function setConfig(cfg) {
  await dbSet("config", cfg);
}
