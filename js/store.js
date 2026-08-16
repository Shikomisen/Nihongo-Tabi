/**
 * store.js — persistence layer.
 *
 * IndexedDB with a transparent localStorage fallback (private browsing, or
 * any environment where IDB is blocked). Everything is a simple key/value
 * get/set/getAll over two logical stores: `srs` and `meta`.
 *
 * All state is client-side. Nothing here ever touches the network (README §8).
 */

const DB_NAME = 'nihongo-tabi';
const DB_VERSION = 1;
const STORES = ['srs', 'meta'];

let dbPromise = null;
let useFallback = false;

function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      useFallback = true;
      return resolve(null);
    }
    let settled = false;
    // Safari/private-mode can hang the open request rather than erroring.
    const bail = setTimeout(() => {
      if (!settled) { settled = true; useFallback = true; resolve(null); }
    }, 2000);

    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    req.onsuccess = () => {
      if (settled) return;
      settled = true; clearTimeout(bail); resolve(req.result);
    };
    req.onerror = () => {
      if (settled) return;
      settled = true; clearTimeout(bail); useFallback = true; resolve(null);
    };
  });

  return dbPromise;
}

/* ---------- localStorage fallback ---------- */

const lsKey = (store, key) => `nt:${store}:${key}`;

const fallback = {
  get(store, key) {
    const raw = localStorage.getItem(lsKey(store, key));
    return raw === null ? undefined : JSON.parse(raw);
  },
  set(store, key, value) {
    localStorage.setItem(lsKey(store, key), JSON.stringify(value));
  },
  del(store, key) {
    localStorage.removeItem(lsKey(store, key));
  },
  getAll(store) {
    const prefix = `nt:${store}:`;
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) out.push(JSON.parse(localStorage.getItem(k)));
    }
    return out;
  },
  clear(store) {
    const prefix = `nt:${store}:`;
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
  },
};

/* ---------- public API ---------- */

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.onerror = () => reject(t.error);
    if (req) {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } else {
      t.oncomplete = () => resolve();
    }
  });
}

export async function get(store, key) {
  const db = await openDB();
  if (!db || useFallback) return fallback.get(store, key);
  try { return await tx(db, store, 'readonly', (s) => s.get(key)); }
  catch { return fallback.get(store, key); }
}

export async function set(store, key, value) {
  const db = await openDB();
  if (!db || useFallback) return fallback.set(store, key, value);
  try { return await tx(db, store, 'readwrite', (s) => s.put(value, key)); }
  catch { return fallback.set(store, key, value); }
}

export async function del(store, key) {
  const db = await openDB();
  if (!db || useFallback) return fallback.del(store, key);
  try { return await tx(db, store, 'readwrite', (s) => s.delete(key)); }
  catch { return fallback.del(store, key); }
}

export async function getAll(store) {
  const db = await openDB();
  if (!db || useFallback) return fallback.getAll(store);
  try { return await tx(db, store, 'readonly', (s) => s.getAll()); }
  catch { return fallback.getAll(store); }
}

export async function setMany(store, entries) {
  // entries: [[key, value], ...]
  const db = await openDB();
  if (!db || useFallback) {
    entries.forEach(([k, v]) => fallback.set(store, k, v));
    return;
  }
  try {
    await new Promise((resolve, reject) => {
      const t = db.transaction(store, 'readwrite');
      const os = t.objectStore(store);
      entries.forEach(([k, v]) => os.put(v, k));
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  } catch {
    entries.forEach(([k, v]) => fallback.set(store, k, v));
  }
}

export async function clearAll() {
  const db = await openDB();
  if (db && !useFallback) {
    for (const s of STORES) {
      try { await tx(db, s, 'readwrite', (os) => os.clear()); } catch { /* fall through */ }
    }
  }
  STORES.forEach((s) => fallback.clear(s));
}

export function backend() {
  return useFallback ? 'localStorage' : 'IndexedDB';
}
