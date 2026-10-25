/**
 * SAIMETRIC Service Worker (Offline-First Engine)
 * Provides 100% offline app loading, clean cache management, and instant updates.
 */

const CACHE_NAME = 'saimetric-v5-offline-v6';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
];

// Install: precache the core shell resiliently
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.allSettled(
        PRECACHE_ASSETS.map(async (assetUrl) => {
          try {
            const res = await fetch(assetUrl, { cache: 'no-cache' });
            if (res && res.status === 200) {
              await cache.put(assetUrl, res.clone());
              if (assetUrl === '/') {
                await cache.put('/index.html', res.clone());
              }
            }
          } catch (e) {}
        })
      );
      await self.skipWaiting();
    })()
  );
});

// Activate: purge ALL obsolete caches so old versions NEVER resurrect, claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) {
            console.info('[SW] Purging stale cache:', k);
            return caches.delete(k);
          }
        })
      );
      await self.clients.claim();
    })()
  );
});

// Skip waiting upon client request
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Fetch: Smart offline routing
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests and WebSocket connections
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return;
  // Never intercept dev server internals, vite modules, or browser extension requests
  if (
    url.pathname.startsWith('/@') ||
    url.pathname.includes('/node_modules/') ||
    url.pathname.startsWith('/src/') ||
    url.search.includes('import') ||
    url.protocol.startsWith('chrome') ||
    url.protocol.startsWith('moz')
  ) {
    return;
  }

  // Handle SPA Navigation requests (HTML document)
  // Network-First when online to ensure fresh version is served; fallback to cache when offline
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        if (navigator.onLine) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3500);
            const networkResponse = await fetch(event.request, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (networkResponse && networkResponse.status === 200) {
              const copy = networkResponse.clone();
              const cache = await caches.open(CACHE_NAME);
              cache.put(event.request, copy.clone());
              cache.put('/', copy.clone());
              cache.put('/index.html', copy.clone());
              return networkResponse;
            }
          } catch (err) {
            console.warn('[SW] Online navigation fetch timed out or failed, falling back to cache');
          }
        }

        // Offline fallback: serve from current cache
        const cache = await caches.open(CACHE_NAME);
        const cached =
          (await cache.match(event.request)) ||
          (await cache.match(event.request, { ignoreSearch: true })) ||
          (await cache.match('/index.html')) ||
          (await cache.match('/'));

        if (cached) {
          return cached;
        }

        return new Response(
          '<!doctype html><html><head><meta charset="utf-8"><title>SAIMETRIC Offline</title></head><body style="background:#0f172a;color:#fff;font-family:sans-serif;padding:2rem;"><h2>SAIMETRIC Offline POS</h2><p>Please open the app once while connected to complete initial offline caching.</p></body></html>',
          { headers: { 'Content-Type': 'text/html' } }
        );
      })()
    );
    return;
  }

  // Handle static assets (JS chunks, CSS, images, fonts, icons)
  // Cache-First with network fallback
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // 1. Try matching in current cache
      let cached =
        (await cache.match(event.request)) ||
        (await cache.match(event.request, { ignoreSearch: true })) ||
        (await cache.match(url.pathname, { ignoreSearch: true }));

      if (cached) {
        // If it's a non-hashed root asset, revalidate in background when online
        if (navigator.onLine && !url.pathname.includes('/assets/')) {
          fetch(event.request)
            .then(async (networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                await cache.put(event.request, networkResponse);
              }
            })
            .catch(() => {});
        }
        return cached;
      }

      // 2. Fetch from network and store in current cache
      try {
        const networkResponse = await fetch(event.request);
        if (networkResponse && networkResponse.status === 200) {
          cache.put(event.request, networkResponse.clone());
        }
        return networkResponse;
      } catch (networkErr) {
        return new Response(null, { status: 404, statusText: 'Offline Resource Not Found' });
      }
    })()
  );
});
