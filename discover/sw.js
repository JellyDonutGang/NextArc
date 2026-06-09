/**
 * OTAKULT Service Worker
 *
 * Strategy:
 *   - Same-origin files (HTML, JS, CSS, manifest): network-first
 *     → always serves the latest deployed version; no version-bump required
 *   - AniList API (graphql.anilist.co): network-first, cache fallback
 *   - Cover images (s4.anilist.co, img.anidb.net): stale-while-revalidate
 *     → fast loads after first visit; updates silently in background
 *
 * Why no app-shell pre-caching:
 *   Pre-caching index.html and animeTasteEngine.js sounds good but causes
 *   version mismatches when only one file is updated — the cached JS and the
 *   new HTML get out of sync and break the app. Since AniList API calls
 *   require a network connection anyway, strict offline support for the JS
 *   shell buys nothing. Network-first on all same-origin assets means every
 *   deploy is live immediately on next load.
 */

const CACHE_VERSION  = 'otakult-v3';
const IMAGE_CACHE    = 'otakult-images-v3';
const API_CACHE      = 'otakult-api-v3';

const ANILIST_ORIGIN = 'https://graphql.anilist.co';
const IMAGE_ORIGINS  = ['s4.anilist.co', 'img.anidb.net'];

/* ── Install: activate immediately, no pre-caching ─ */
self.addEventListener('install', event => {
  self.skipWaiting();
});

/* ── Activate: prune old caches, claim clients ────── */
self.addEventListener('activate', event => {
  const keep = new Set([CACHE_VERSION, IMAGE_CACHE, API_CACHE]);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !keep.has(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ── Fetch routing ────────────────────────────────── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // AniList API → network-first, cache fallback for offline
  if (url.origin === ANILIST_ORIGIN) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // Cover images → stale-while-revalidate (fast + always eventually fresh)
  if (IMAGE_ORIGINS.some(o => url.hostname.includes(o))) {
    event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE));
    return;
  }

  // Same-origin (index.html, animeTasteEngine.js, manifest, etc.)
  // → network-first: always serve the latest deployed file
  if (url.origin === self.location.origin && request.method === 'GET') {
    event.respondWith(networkFirst(request, CACHE_VERSION));
    return;
  }
});

/* ── Strategies ───────────────────────────────────── */

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request.clone());
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Offline fallback
    if (request.mode === 'navigate') {
      return new Response('<h1>You\'re offline</h1><p>OTAKULT needs a connection to load.</p>', {
        status: 503,
        headers: { 'Content-Type': 'text/html' },
      });
    }
    return new Response(JSON.stringify({ errors: [{ message: 'Offline' }] }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || await fetchPromise || new Response('', { status: 404 });
}
