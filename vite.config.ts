import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';

/** Bump this when a stuck phone must drop the previous service worker. */
const APP_VERSION = '2026-10-19-r7';

/** Versjonert service worker. HTML hentes på nytt, gamle cacher slettes, så /Gasskontroll/ ikke blir stående på et gammelt skall. */
function serviceWorker(version: string): Plugin {
  return {
    name: 'kontrollplan-sw',
    apply: 'build',
    closeBundle() {
      const dist = join(process.cwd(), 'dist');
      const files: string[] = [];
      const walk = (dir: string, prefix: string) => {
        for (const name of readdirSync(dir)) {
          const path = join(dir, name);
          if (statSync(path).isDirectory()) walk(path, `${prefix}${name}/`);
          else if (name !== 'sw.js') files.push(`${prefix}${name}`);
        }
      };
      walk(dist, './');
      const body = `/* Kontrollplan ${version} */
const VERSION = ${JSON.stringify(version)};
const CACHE = 'kontrollplan-' + VERSION;
const ASSETS = ${JSON.stringify(files)};

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
`;
      writeFileSync(join(dist, 'sw.js'), body);
    },
  };
}

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  plugins: [preact(), serviceWorker(APP_VERSION)],
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 },
  test: { environment: 'node' },
} as any);
