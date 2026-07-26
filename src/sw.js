/* Offline-first service worker (issue #45). Bundled to dist/sw.js by
   scripts/build.mjs, which stamps __H_SW_VERSION__ with the schema version
   plus a content hash of the built page. Deployed as a sidecar next to the
   HTML by the pages workflow; the page works without it (registration in
   src/sw-register.js no-ops when this file is missing).

   Strategy (see lib/sw-cache.js for the routing rules):
   - shell (page, schema, manifest, icons): precache on install, then
     stale-while-revalidate — the cached copy is served instantly and a
     fresh copy is fetched in the background, so a new deploy takes effect
     on the next visit and rendering never blocks on the network.
   - CDN assets (Leaflet, Tabler icons, ajv): cache-first; the URLs are
     version-pinned so they load once and stick.
   - everything else (map tiles, OpenRouter, previews/): network only. */
import { classify, PRECACHE_CRITICAL, PRECACHE_OPTIONAL } from './lib/sw-cache.js';

const VERSION = '__H_SW_VERSION__';
const SHELL_CACHE = `h-shell-${VERSION}`;
/* v2: v1 holds cache-first responses fetched before the CDN assets carried SRI
   hashes, including ones from hosts the page no longer loads from at all
   (esm.sh, cdnjs). Those were never integrity-checked, so they are not
   entries to keep serving — the bump drops them on activate. */
const CDN_CACHE = 'h-cdn-v2';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(PRECACHE_CRITICAL);
    await Promise.allSettled(PRECACHE_OPTIONAL.map(p => cache.add(p)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  // Drop shell caches left behind by previous builds. The CDN cache is shared
  // across builds (its URLs are version-pinned), so only a superseded
  // generation of it goes — see the CDN_CACHE note above.
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => (k.startsWith('h-shell-') && k !== SHELL_CACHE)
        || (k.startsWith('h-cdn-') && k !== CDN_CACHE))
      .map(k => caches.delete(k)));
  })());
});

// The page asks which build is cached to label its "Offline ready" badge.
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'H_SW_VERSION' && event.ports[0]) {
    event.ports[0].postMessage({ version: VERSION });
  }
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const kind = classify(req.url, self.registration.scope);
  if (kind === 'cdn') event.respondWith(cacheFirst(req));
  else if (kind === 'shell') event.respondWith(staleWhileRevalidate(event, req));
});

async function cacheFirst(req) {
  const cache = await caches.open(CDN_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  // The CDN tags carry crossorigin="anonymous" for SRI, so these are CORS
  // requests and the responses are ordinary (not opaque). A replay out of this
  // cache is still hash-checked by the browser, which is what makes holding
  // them indefinitely safe. The opaque case is kept for any no-cors request
  // that reaches here: status 0, cacheable, replayable for the same consumer.
  if (res.ok || res.type === 'opaque') await cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(event, req) {
  const cache = await caches.open(SHELL_CACHE);
  // ?v=… cache-busting stamps (issue #29) must hit the same entry.
  const key = req.url.split('?')[0];
  const cached = await cache.match(key);
  const refresh = (async () => {
    try {
      const res = await fetch(req);
      if (res.ok) await cache.put(key, res.clone());
      return res;
    } catch {
      return null;
    }
  })();
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  const fresh = await refresh;
  if (fresh) return fresh;
  // Offline with an unprimed entry: for a navigation, fall back to the
  // precached page rather than erroring out to a blank tab.
  if (req.mode === 'navigate') {
    const fallback = await cache.match('holiday_itinerary_viewer.html');
    if (fallback) return fallback;
  }
  return Response.error();
}
