/* XO LAB service worker — caches the app shell so it opens offline once installed.
   Imported media never touches the network; it stays as local blob URLs in the page. */
const CACHE = 'xo-lab-v5.0.1';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/words.js', './js/look3d.js', './js/settings.js', './js/ui.js', './js/schema.js', './js/filters.js', './js/audio.js', './js/gl.js',
  './js/model3d.js', './js/blobs.js', './js/strobe.js', './js/exporter.js', './js/history.js', './js/project.js', './js/app.js', './js/desktop.js',
  './vendor/three/three-all-0.170.0.bundle.js', './vendor/mediabunny/mediabunny-subset.js', './vendor/three/draco-decoder-inline.js',
  './assets/brand/Futuristic XO LAB Wordmark.png', './assets/brand/Futuristic XO emblem on black.png',
  './assets/icons/xo-emblem-32.png', './assets/icons/xo-emblem-180.png', './assets/icons/xo-emblem-192.png', './assets/icons/xo-emblem-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});
