/* Hy_stepper service worker — cache bust / network-first.
 * Bump CACHE_VERSION whenever we need phones to drop stale assets.
 */
const CACHE_VERSION = 'hystepper-v20260813-brand';
const LEGACY_CACHES_PREFIX = 'hystepper';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION && key.includes(LEGACY_CACHES_PREFIX))
          .map((key) => caches.delete(key))
      );
      // Also wipe everything else left over from older SW builds.
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        client.postMessage({ type: 'CACHE_CLEARED', version: CACHE_VERSION });
      }
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
    );
  }
});

// Network-first: never serve stale HTML/JS from Cache Storage.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  event.respondWith(
    fetch(req)
      .then((res) => res)
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        throw new Error('Network unavailable');
      })
  );
});
