/*
 * Groovy Operations — service worker.
 * Cache-first for the precached app shell (HTML/CSS/JS + icons), network-first
 * for everything else (CDN libs, any other GET). Firebase/Firestore/RTDB/Auth
 * and Cloudinary calls are never intercepted — they pass straight to the
 * network so live data and uploads always behave normally, online or not.
 *
 * Bump CACHE_VERSION on every deploy that changes a precached file; the
 * activate handler deletes every cache from a prior version.
 */
const CACHE_VERSION = 'v17';
const STATIC_CACHE = `groovy-ops-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `groovy-ops-runtime-${CACHE_VERSION}`;
const CURRENT_CACHES = [STATIC_CACHE, RUNTIME_CACHE];

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
  '/js/activity.js',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/icon-maskable-512.png'
];

// Hostnames that must always hit the live network untouched — Firebase
// (Auth/Firestore/RTDB, including the gstatic-hosted SDK) and Cloudinary.
const BYPASS_HOSTS = [
  'firestore.googleapis.com',
  'firebaseio.com',
  'firebaseapp.com',
  'googleapis.com',
  'google.com',
  'gstatic.com',
  'cloudinary.com'
];

function isBypassed(url) {
  return BYPASS_HOSTS.some(host => url.hostname === host || url.hostname.endsWith('.' + host));
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

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirst(request));
  }
});
