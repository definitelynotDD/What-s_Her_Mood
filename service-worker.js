// ───── BroCode service worker ─────
// Pre-caches the entire app shell on install so the PWA works offline
// after the first visit. On fetch, serves from cache and only hits the
// network when the cache misses. Bump CACHE_VERSION whenever any
// shipped file changes — that triggers a clean re-cache on next load.

const CACHE_VERSION = 'brocode-v1';

// Everything we need to render the page completely offline.
// Paths are relative to the service worker's location, which is the
// site root for the PWA — same dir as index.html / manifest.
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-256.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  // Asset bundle (fonts + React/Babel) — the big stuff:
  './assets/0384929a-36ce-43c7-9ea4-7f7023f8fa68.woff2',
  './assets/0ab0b0ba-fcc1-4bcd-8179-a37a389a9f90.woff2',
  './assets/196a3403-8ec6-4b35-8c63-4bb5c4fea0e6.woff2',
  './assets/1b6641aa-ff5c-490b-81a5-b39ca899d73b.woff2',
  './assets/2213e73a-1ac4-456c-af44-59a7322edc22.woff2',
  './assets/355d2fc9-0ede-4917-9851-dc1edf3569f0.js',
  './assets/63410083-d257-4ac3-b53a-7996cbbf3790.woff2',
  './assets/63cf4833-4311-4da5-925e-a5fde1dc31fe.woff2',
  './assets/65487e89-9a30-4fc5-9c03-b0ee21fa90b2.woff2',
  './assets/6e32c27b-6c3a-4408-b81f-f38ae301f090.woff2',
  './assets/82b4df3e-328e-45f6-b337-e88bfc92834d.woff2',
  './assets/871d26eb-20a1-4925-8ac9-025b68d9f24b.woff2',
  './assets/a5cfd4d1-f32f-4ce0-bb4b-7b81297f45c1.woff2',
  './assets/c759c754-d946-49f8-b56f-66e95133c5fc.js',
  './assets/d7d37cd4-8217-4822-be49-5373f67cc2f8.woff2',
  './assets/db1e28d5-314a-4661-a553-4bbb6a5fdb21.woff2',
  './assets/f75c03f1-58a5-4fc4-9d2f-188fb3490858.js',
  './assets/f9f1fc74-9543-449c-9c02-8f20fbd85eb5.woff2'
];

// ── Install: pre-fetch and store the shell ────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: wipe old caches, claim open pages ──────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first, network fallback ─────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle same-origin GETs — leave POSTs and cross-origin alone.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // Opportunistically cache successful same-origin responses so
        // anything not in the precache list still works offline next time.
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => {
        // Total offline + cache miss: fall back to the home page for
        // navigation requests so the app at least loads.
        if (req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
