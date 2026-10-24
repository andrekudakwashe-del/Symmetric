/**
 * SAIMETRIC Service Worker (Offline-First Engine)
 * Provides 100% offline app loading, asset precaching, and network fallback.
 */

const CACHE_NAME = 'saimetric-v5-offline-v3';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
];

// Install: precache the core shell resiliently (Promise.allSettled)
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

// Activate: preserve previous cache assets to prevent offline starvation, claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // Keep current cache and immediate previous cache
      const oldCaches = keys.filter((k) => k !== CACHE_NAME);
      if (oldCaches.length > 2) {
        for (const k of oldCaches.slice(0, oldCaches.length - 2)) {
          await caches.delete(k);
        }
      }
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
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          // If online, try network with short timeout to catch fresh HTML
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);
          const networkResponse = await fetch(event.request, { signal: controller.signal });
          clearTimeout(timeoutId);

          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            const cache = await caches.open(CACHE_NAME);
            cache.put(event.request, copy.clone());
            cache.put('/', copy.clone());
            cache.put('/index.html', copy.clone());
          }
          return networkResponse;
        } catch (err) {
          // Network failed or offline: locate cached HTML shell
          const cached =
            (await caches.match(event.request)) ||
            (await caches.match(event.request, { ignoreSearch: true })) ||
            (await caches.match('/index.html')) ||
            (await caches.match('/'));
          if (cached) {
            return cached;
          }

          // Search across all available caches
          const allKeys = await caches.keys();
          for (const k of allKeys) {
            const c = await caches.open(k);
            const found =
              (await c.match('/index.html')) ||
              (await c.match('/')) ||
              (await c.match(event.request, { ignoreSearch: true }));
            if (found) return found;
          }

          return new Response(
            '<!doctype html><html><head><meta charset="utf-8"><title>SAIMETRIC Offline</title></head><body style="background:#0f172a;color:#fff;font-family:sans-serif;padding:2rem;"><h2>SAIMETRIC Offline POS</h2><p>Please open the app once while connected to complete initial offline caching.</p></body></html>',
            { headers: { 'Content-Type': 'text/html' } }
          );
        }
      })()
    );
    return;
  }

  // Handle static assets (JS chunks, CSS, images, fonts, icons)
  // Cache-First with network fallback & background revalidation
  event.respondWith(
    (async () => {
      // 1. Try matching in current cache first (ignoreSearch handles Vite query parameters)
      let cached =
        (await caches.match(event.request)) ||
        (await caches.match(event.request, { ignoreSearch: true })) ||
        (await caches.match(url.pathname, { ignoreSearch: true }));

      // If found in cache, return immediately (0ms instant offline load!)
      if (cached) {
        if (navigator.onLine) {
          fetch(event.request)
            .then(async (networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                const copy = networkResponse.clone();
                const cache = await caches.open(CACHE_NAME);
                cache.put(event.request, copy);
              }
            })
            .catch(() => {});
        }
        return cached;
      }

      // 2. Not in current cache: try fetching from network
      try {
        const networkResponse = await fetch(event.request);
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, responseToCache);
        }
        return networkResponse;
      } catch (networkErr) {
        // 3. Network failed (offline): search across all caches
        const allKeys = await caches.keys();
        for (const k of allKeys) {
          const c = await caches.open(k);
          const match =
            (await c.match(event.request)) ||
            (await c.match(event.request, { ignoreSearch: true })) ||
            (await c.match(url.pathname, { ignoreSearch: true }));
          if (match) return match;
        }

        return new Response(null, { status: 404, statusText: 'Offline Resource Not Found' });
      }
    })()
  );
});
