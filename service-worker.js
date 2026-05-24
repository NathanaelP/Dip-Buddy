// Cache name — increment (e.g. dip-buddy-v2) after each deploy that changes
// the app shell so users pick up the new files on next load.
const CACHE = 'dip-buddy-v3';

// Local app-shell files to precache on install.
// CDN scripts are intentionally excluded — a third-party fetch failure during
// install would abort the entire SW install and break the app. CDN assets are
// cached lazily on first use instead.
const PRECACHE = [
  './',
  './css/styles.css',
  './js/firebase-config.js',
  './js/utils.js',
  './js/auth.js',
  './js/dashboard.js',
  './js/add-item.js',
  './js/products.js',
  './js/settings.js',
  './manifest.json',
  './icon.svg',
];

// Origins that must always go to the network — never cache.
const NETWORK_ONLY_ORIGINS = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'world.openfoodfacts.org',
];

// CDN origins — safe to cache lazily (version-pinned URLs).
const CDN_ORIGINS = [
  'unpkg.com',
  'cdn.jsdelivr.net',
  'www.gstatic.com',
];

// ─── Install ──────────────────────────────────────────────
// Precache the app shell. skipWaiting() makes the new SW take over immediately
// without waiting for the old one to become idle.

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// ─── Activate ─────────────────────────────────────────────
// Delete every old dip-buddy-* cache so stale files don't linger after an
// update. clients.claim() lets the new SW control already-open tabs.

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('dip-buddy-') && k !== CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch ────────────────────────────────────────────────

self.addEventListener('fetch', event => {
  const req = event.request;

  // Only intercept GET — never intercept mutations.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Firebase Auth, Firestore, and Open Food Facts: always network.
  if (NETWORK_ONLY_ORIGINS.some(o => url.hostname.includes(o))) return;

  // CDN and same-origin: cache-first with lazy population.
  if (
    CDN_ORIGINS.some(o => url.hostname.includes(o)) ||
    url.origin === self.location.origin
  ) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Everything else: network-first, fall back to cache.
  event.respondWith(networkFirst(req));
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  return fetchAndCache(req);
}

async function networkFirst(req) {
  try {
    return await fetchAndCache(req);
  } catch {
    const cached = await caches.match(req);
    return cached ?? new Response('Offline', { status: 503 });
  }
}

async function fetchAndCache(req) {
  const res = await fetch(req);
  // Only cache clean responses — never cache errors or opaque failures.
  if (res.ok && res.type !== 'error') {
    const cache = await caches.open(CACHE);
    cache.put(req, res.clone());
  }
  return res;
}
