/*
 * Groovy Operations — service worker.
 * Cache-first for the precached app shell (HTML/CSS/JS + icons), network-first
 * for everything else (any other GET). The jsPDF/SheetJS/JsBarcode libraries
 * are no longer CDN-loaded — they are vendored under /assets/vendor and
 * precached like every other asset. Firebase/Firestore/RTDB/Auth
 * and Cloudinary calls are never intercepted — they pass straight to the
 * network so live data and uploads always behave normally, online or not.
 *
 * Bump CACHE_VERSION on every deploy that changes a precached file; the
 * activate handler deletes every cache from a prior version.
 */
const CACHE_VERSION = 'v43';
const STATIC_CACHE = `groovy-ops-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `groovy-ops-runtime-${CACHE_VERSION}`;
// Deliberately NOT version-scoped: a Cloudinary delivery URL is immutable
// (a new upload gets a new URL), so these survive deploys. Version-scoping
// it would re-download every photo on a board on every release.
const IMAGE_CACHE = 'groovy-ops-images';
const CURRENT_CACHES = [STATIC_CACHE, RUNTIME_CACHE, IMAGE_CACHE];
const IMAGE_CACHE_MAX = 300;

// Every HTML/CSS/JS file served to the browser, plus the manifest + icons.
// (Server-only code — netlify/functions, netlify/lib, attendance-sync — is
// never fetched by a page, so it has no place in a client precache list.)
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/store.html',
  '/color-backfill.html',
  '/pantone-importer.html',
  '/manifest.json',
  '/css/main.css',
  '/js/diagnostics.js',
  '/js/shared.js',
  '/js/print-engine.js',
  '/js/auth.js',
  '/js/pos.js',
  '/js/embellishments.js',
  '/js/hrm.js',
  '/js/store.js',
  '/js/store-cash.js',
  '/js/gatepass.js',
  '/js/fabric.js',
  '/js/production.js',
  '/js/shopify.js',
  '/js/fulfillment.js',
  '/js/notes.js',
  '/js/boards.js',
  '/js/profile.js',
  // Vendored libraries (see assets/vendor/README.md). These are the reason
  // PDF/Excel export now works offline: from a CDN they were cross-origin
  // and network-first, so with no signal they simply never arrived.
  '/assets/vendor/jspdf-2.5.1.umd.min.js',
  '/assets/vendor/xlsx-0.18.5.full.min.js',
  '/assets/vendor/jsbarcode-3.11.6.all.min.js',
  '/js/activity.js',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/icon-maskable-512.png'
];

// Hostnames that must always hit the live network untouched — Firebase
// (Auth/Firestore/RTDB, including the gstatic-hosted SDK) and Cloudinary's
// UPLOAD API.
//
// Note the narrowing (Sept 2026): this used to list 'cloudinary.com', which
// covered res.cloudinary.com too, so every photo on a board was re-fetched
// from the network on every single load — measured at 11 requests for one
// board. Delivery URLs are immutable content, so they are now cached (see
// isCloudinaryAsset below). api.cloudinary.com — where uploads POST — stays
// bypassed, and the reason the original rule existed (stale auth tokens,
// half-cached writes) applies to that endpoint, not to delivered images.
const BYPASS_HOSTS = [
  'firestore.googleapis.com',
  'firebaseio.com',
  'firebaseapp.com',
  'googleapis.com',
  'google.com',
  'gstatic.com',
  'api.cloudinary.com'
];

function isBypassed(url) {
  return BYPASS_HOSTS.some(host => url.hostname === host || url.hostname.endsWith('.' + host));
}

function isCloudinaryAsset(url) {
  return url.hostname === 'res.cloudinary.com';
}

function isStaticAsset(url) {
  if (url.origin !== self.location.origin) return false;
  const path = url.pathname;
  if (path === '/' || path.endsWith('.html')) return true;
  if (path.startsWith('/css/') || path.startsWith('/js/') || path.startsWith('/assets/')) return true;
  if (path === '/manifest.json') return true;
  return false;
}

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await Promise.all(PRECACHE_URLS.map(async url => {
        try {
          const res = await fetch(url, { cache: 'reload' });
          if (res && res.ok) await cache.put(url, res);
        } catch (err) {
          console.warn('[sw] precache failed for', url, err);
        }
      }));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(name => name.startsWith('groovy-ops-') && !CURRENT_CACHES.includes(name))
          .map(name => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

// Cache-first: serve from cache immediately, ignoring ?v= cache-busting
// query strings; fall back to network and refresh the cache entry.
async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

// Cache-first for delivered images, with a light cap so a photo-heavy
// board can't grow the cache without bound. Keys come back in insertion
// order, so trimming from the front drops the oldest.
async function cacheFirstImage(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.ok && res.type !== 'opaque') {
    cache.put(request, res.clone()).then(async () => {
      const keys = await cache.keys();
      if (keys.length > IMAGE_CACHE_MAX) {
        await Promise.all(keys.slice(0, keys.length - IMAGE_CACHE_MAX).map(k => cache.delete(k)));
      }
    }).catch(() => {});
  }
  return res;
}

// Network-first: try live network, fall back to the last cached copy.
async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (isBypassed(url)) return; // never intercept Firebase/Firestore/Cloudinary

  if (isCloudinaryAsset(url)) {
    event.respondWith(cacheFirstImage(request));
  } else if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirst(request));
  }
});
