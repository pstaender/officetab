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

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  // Navigations always resolve to the app shell, so any URL under the scope works offline.
  const lookup = event.request.mode === 'navigate' ? './' : event.request;
  // ignoreVary: script tags are requested with CORS, the precache without. A server sending
  // `Vary: Origin` would otherwise turn every precached asset into a cache miss when offline.
  event.respondWith(caches.match(lookup, { cacheName: CACHE, ignoreVary: true }).then((hit) => hit ?? fetch(event.request)));
});
