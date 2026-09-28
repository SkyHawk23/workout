// IndexedDB is a cache + outbox only now — the server is the source of truth.
// "cache" holds the current program and the last 30 days of history so the
// app opens instantly offline. "outbox" holds set logs keyed by client_id
// (a UUID) until they've synced; the server treats client_id as an
// idempotency key, so a retried send never double-logs a set.
const DB_NAME = "DailyLiftCache";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("cache")) db.createObjectStore("cache");
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "client_id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result?.result);
    t.onerror = () => reject(t.error);
  });
}

export async function cacheSet(key, value) {
  return tx("cache", "readwrite", (os) => os.put(value, key));
}
export async function cacheGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction("cache", "readonly").objectStore("cache").get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function outboxAdd(setLog) {
  return tx("outbox", "readwrite", (os) => os.put(setLog));
}
export async function outboxAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction("outbox", "readonly").objectStore("outbox").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
export async function outboxRemove(clientId) {
  return tx("outbox", "readwrite", (os) => os.delete(clientId));
}

export async function clearUserCache() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(["cache", "outbox"], "readwrite");
    t.objectStore("cache").clear();
    t.objectStore("outbox").clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
