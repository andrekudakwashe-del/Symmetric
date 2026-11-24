/**
 * SAIMETRIC Service Worker (Offline-First Engine)
 * Provides 100% offline app loading, clean cache management, and instant updates.
 */

const CACHE_NAME = 'saimetric-v5-offline-v14';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
];

// Install: precache the core shell resiliently and activate immediately so stale bundles never linger
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

  // Skip non-GET requests, API routes, Hub OTA releases, and WebSocket connections
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/hub-ota/')) return;
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
  // True Offline-First (Stale-While-Revalidate): serve cached shell in 0ms immediately,
  // then silently refresh from network in the background when online so flaky WiFi / LAN Hub never stalls startup.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached =
          (await cache.match(event.request)) ||
          (await cache.match(event.request, { ignoreSearch: true })) ||
          (await cache.match('/index.html')) ||
          (await cache.match('/'));

        const revalidateInBackground = async () => {
          if (!navigator.onLine) return null;
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2500);
            const networkResponse = await fetch(event.request, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (networkResponse && networkResponse.status === 200) {
              const copy = networkResponse.clone();
              await cache.put(event.request, copy.clone());
              await cache.put('/', copy.clone());
              await cache.put('/index.html', copy.clone());
              return networkResponse;
            }
          } catch {
            // Silent offline fallback
          }
          return null;
        };

        if (cached) {
          // Instant 0ms offline-first load; refresh cache silently in background
          event.waitUntil(revalidateInBackground());
          return cached;
        }

        // Cold first visit (no cached shell yet): fetch from network
        const networkFresh = await revalidateInBackground();
        if (networkFresh) {
          return networkFresh;
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
