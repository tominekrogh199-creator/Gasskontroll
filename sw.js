/* Kontrollplan 2026-10-19-r7 */
const VERSION = "2026-10-19-r7";
const CACHE = 'kontrollplan-' + VERSION;
const ASSETS = ["./apple-touch-icon.png","./assets/__vite-browser-external-BIHI7g3E.js","./assets/index-CJH5K4q4.js","./assets/index-DNh5Oz4M.css","./assets/index-DTYGp-1m.js","./assets/node.browser-DXWZx-Qx.js","./assets/node.browser-TPVSrCNd.js","./assets/pdf.worker.min-GB3t0DcA.mjs","./assets/pdfText-DV7VZzP3.js","./favicon.svg","./index.html","./manifest.webmanifest"];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS.map((path) => new URL(path, self.location).toString()));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      client.postMessage({ type: 'RELOAD' });
      try {
        const next = new URL(client.url);
        if (next.searchParams.get('v') !== VERSION) {
          next.searchParams.set('v', VERSION);
          await client.navigate(next.toString());
        }
      } catch { /* eldre nettleser: siden laster på nytt via postMessage */ }
    }
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;
  const shell = new URL('./index.html', self.location).toString();
  const isDocument = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html');
  if (isDocument) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(shell, fresh.clone());
        }
        return fresh;
      } catch {
        return (await caches.match(req)) || (await caches.match(shell)) || Response.error();
      }
    })());
    return;
  }
  event.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    const fresh = await fetch(req);
    const cache = await caches.open(CACHE);
    await cache.put(req, fresh.clone());
    return fresh;
  })());
});
