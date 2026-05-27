/**
 * Next Arc Service Worker
 * Strategy:
 *   - App shell (HTML, JS, manifest, icons): cache-first
 *   - AniList API (graphql.anilist.co): network-first, fallback to cache
 *   - Images (cover art): stale-while-revalidate
 */

const CACHE_VERSION = 'nextarc-v65';
const APP_SHELL = [
  '/',
  '/index.html',
  '/animeTasteEngine.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

const ANILIST_ORIGIN = 'https://graphql.anilist.co';
const IMAGE_ORIGINS = ['s4.anilist.co', 'img.anidb.net'];

/* ── Install: pre-cache app shell ──────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => {
      return cache.addAll(APP_SHELL);
    }).then(() => self.skipWaiting())
  );
});

/* ── Activate: prune old caches ────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_VERSION)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch: routing logic ──────────────────────── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. AniList API → network-first, cache fallback
  if (url.origin === ANILIST_ORIGIN) {
    event.respondWith(networkFirst(request, 'anilist-cache'));
    return;
  }

  // 2. Cover images → stale-while-revalidate
  if (IMAGE_ORIGINS.some(o => url.hostname.includes(o))) {
    event.respondWith(staleWhileRevalidate(request, 'image-cache'));
    return;
  }

  // 3. App shell → cache-first
  if (request.method === 'GET') {
    event.respondWith(cacheFirst(request, CACHE_VERSION));
  }
});

/* ── Strategies ────────────────────────────────── */

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('Offline — please reconnect.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request.clone());
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ errors: [{ message: 'Offline' }] }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || await fetchPromise || new Response('', { status: 404 });
}
