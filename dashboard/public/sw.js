const CACHE_NAME = 'adguard-dashboard-v1';
const STATIC_ASSETS = ['/', '/index.html', '/favicon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Always pass real-time API calls, SSE streams, and non-GET requests directly to network
  if (
    e.request.method !== 'GET' ||
    e.request.url.includes('/api/') ||
    e.request.url.includes('/querylog/')
  ) {
    return;
  }

  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
