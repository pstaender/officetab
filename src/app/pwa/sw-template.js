// Service worker template; tools/build/precache-plugin.ts fills in the placeholders at build time.
const CACHE = 'lo-writer-__CACHE_VERSION__';
const FILES = __PRECACHE_FILES__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('lo-writer-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Fonts (Fontsource packages on jsDelivr, and the app's own fonts/) are fetched when a document
// uses them and kept for offline use in a cache that outlives deployments: their URLs are versioned.
const FONT_CACHE = 'writer-fonts-v1';
const isFont = (url) => (url.origin === 'https://cdn.jsdelivr.net' && url.pathname.startsWith('/npm/@fontsource/')) || (url.origin === self.location.origin && url.pathname.includes('/fonts/'));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'GET' && isFont(url)) {
    event.respondWith(caches.open(FONT_CACHE).then(async (cache) => {
      const hit = await cache.match(event.request, { ignoreVary: true });
      if (hit) return hit;
      const res = await fetch(event.request);
      if (res.ok) await cache.put(event.request, res.clone()).catch(() => {});
      return res;
    }));
    return;
  }
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Navigations always resolve to the app shell, so any URL under the scope works offline.
  const lookup = event.request.mode === 'navigate' ? './' : event.request;
  // ignoreVary: script tags are requested with CORS, the precache without. A server sending
  // `Vary: Origin` would otherwise turn every precached asset into a cache miss when offline.
  event.respondWith(caches.match(lookup, { cacheName: CACHE, ignoreVary: true }).then((hit) => hit ?? fetch(event.request)));
});
