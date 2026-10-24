// Glow service worker: makes the app installable and keeps the app shell working on spotty signal.
// Live data (/api/...) always comes from the network.
const VERSION = 'glow-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return; // never cache live data
  if (url.hostname.endsWith('tile.openstreetmap.org')) return;                      // map tiles go straight to the network

  // Pages: network first, fall back to the cached app shell when offline
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put('/', copy)); return r; }).catch(() => caches.match('/')));
    return;
  }
  // Everything else (fonts, Leaflet, icons): cache first, then network
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok && (url.origin === location.origin || url.hostname.includes('cdnjs') || url.hostname.includes('fonts.g'))) {
      const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy));
    }
    return r;
  })));
});
