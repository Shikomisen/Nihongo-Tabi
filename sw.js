/**
 * sw.js — offline-first service worker (README §5).
 *
 * Precaches the app shell on install, then walks content/manifest.json to
 * cache every category file, scenario file and audio clip. That means
 * adding a category needs no service-worker edit — bump CACHE_VERSION and
 * the new content is picked up on the next install.
 *
 * Strategy:
 *   - navigations      -> network-first, falling back to the cached shell
 *   - everything else  -> cache-first (content and audio never change
 *                         under a given cache version)
 */

const CACHE_VERSION = 'v2';
const CACHE = `nihongo-tabi-${CACHE_VERSION}`;

const SHELL = [
  './',
  './index.html',
  './app.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/audio.js',
  './js/content.js',
  './js/deck.js',
  './js/quiz.js',
  './js/render.js',
  './js/scenario.js',
  './js/srs.js',
  './js/store.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon-180.png',
];

/** Read the content manifest and expand it into a full asset list. */
async function contentAssets() {
  const assets = ['./content/manifest.json'];
  try {
    const res = await fetch('./content/manifest.json', { cache: 'no-cache' });
    const manifest = await res.json();

    const categoryFiles = (manifest.categories || []).map((c) => c.file);
    const scenarioFiles = (manifest.scenarios || []).map((s) => s.file);
    assets.push(...categoryFiles.map((f) => `./${f}`), ...scenarioFiles.map((f) => `./${f}`));

    const fetchJSON = (f) =>
      fetch(`./${f}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);

    // Phrase clips live inside each category file...
    for (const cat of await Promise.all(categoryFiles.map(fetchJSON))) {
      for (const p of cat?.phrases || []) if (p.audio) assets.push(`./${p.audio}`);
    }

    // ...and NPC-line clips inside each scenario file.
    for (const sc of await Promise.all(scenarioFiles.map(fetchJSON))) {
      for (const node of Object.values(sc?.nodes || {})) {
        if (node.audio) assets.push(`./${node.audio}`);
      }
    }
  } catch (err) {
    // Offline on first install, or a malformed manifest. The shell still
    // works; content fills in on a later visit.
    console.warn('[sw] could not expand content manifest', err);
  }
  return assets;
}

/** addAll() rejects the whole batch if any single request 404s. */
async function cacheAllTolerant(cache, urls) {
  await Promise.all(
    urls.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {
        /* a missing clip must not fail the install */
      })
    )
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cacheAllTolerant(cache, SHELL);
      await cacheAllTolerant(cache, await contentAssets());
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put(request, fresh.clone());
          return fresh;
        } catch {
          return (await caches.match('./index.html')) || Response.error();
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const hit = await caches.match(request, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const fresh = await fetch(request);
        if (fresh.ok) {
          const cache = await caches.open(CACHE);
          cache.put(request, fresh.clone());
        }
        return fresh;
      } catch {
        return new Response('', { status: 504, statusText: 'Offline and not cached' });
      }
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
