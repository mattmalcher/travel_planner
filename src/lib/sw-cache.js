// Request-classification logic for the offline service worker (issue #45).
// The worker itself (src/sw.js) stays thin; every decidable rule lives here
// so it can be unit tested without a worker environment.

/* App-shell files precached on install and refreshed with
   stale-while-revalidate. CRITICAL entries must all cache or the install
   fails and retries next visit; OPTIONAL ones (manifest, icons) are
   best-effort. Paths are relative to the worker's scope (the deploy dir). */
export const PRECACHE_CRITICAL = [
  './',
  'index.html',
  'holiday_itinerary_viewer.html',
  'holiday_itinerary_schema.json',
];
export const PRECACHE_OPTIONAL = [
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
];

/* Third-party hosts the page loads from (Leaflet on cdnjs, Tabler icons on
   jsdelivr, ajv on esm.sh). Version-pinned URLs, so a cached copy never
   goes stale — cache-first. */
export const CDN_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'esm.sh'];

/**
 * Decide how the service worker should handle a GET request.
 *
 * @param {string} requestUrl absolute URL of the request
 * @param {string} scopeUrl   the registration scope (directory URL)
 * @returns {'shell'|'cdn'|'bypass'} shell → stale-while-revalidate,
 *   cdn → cache-first, bypass → straight to the network (map tiles,
 *   OpenRouter, PR previews, anything unknown).
 */
export function classify(requestUrl, scopeUrl) {
  let u, s;
  try {
    u = new URL(requestUrl);
    s = new URL(scopeUrl);
  } catch {
    return 'bypass';
  }
  if (CDN_HOSTS.includes(u.hostname)) return 'cdn';
  if (u.origin !== s.origin) return 'bypass';
  // PR previews share the production origin under previews/ — never serve
  // them (or their assets) the production shell.
  if (u.pathname.includes('/previews/')) return 'bypass';
  if (!u.pathname.startsWith(s.pathname)) return 'bypass';
  const rest = u.pathname.slice(s.pathname.length);
  if (rest === '') return 'shell'; // the scope root itself, i.e. './'
  if (PRECACHE_CRITICAL.includes(rest) || PRECACHE_OPTIONAL.includes(rest)) return 'shell';
  return 'bypass';
}
