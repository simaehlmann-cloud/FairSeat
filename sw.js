/* FairSeat – Service Worker
   Strategie:
   - Navigation (index.html): erst Netz, dann Cache  -> Updates greifen sofort
   - Übrige Dateien: erst Cache, Aktualisierung im Hintergrund
   Der Worker übernimmt erst nach Bestätigung durch die App (SKIP_WAITING). */

/* Der Name traegt die App-Version. validate.js vergleicht ihn mit
   APP_VERSION in der index.html: Wer die Version anhebt, ohne diese Zeile
   nachzuziehen, liefert Rueckkehrern sonst weiter die alte Fassung aus
   dem Cache aus. */
const CACHE = 'fairseat-2.0.0';

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './datenschutz.html',
  './impressum.html',
  './datenschutz-en.html',
  './impressum-en.html',
  './icon.png',
  './icon-192.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS)).catch(err => {
      console.warn('Vorab-Caching unvollständig:', err);
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(hit => {
      const network = fetch(req)
        .then(res => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
