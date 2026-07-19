/* Register the offline service worker and surface an "Offline ready" badge
   when the current page load actually came through it (issue #45).
   Everything is best-effort: on file:// (the saved single-file use case),
   on PR previews, or when sw.js was not deployed next to the page, this
   silently does nothing and the app behaves exactly as before. */
export function initServiceWorker() {
  try {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.protocol !== 'http:') return; // saved file:// copy
    if (location.pathname.includes('/previews/')) return; // PR previews stay SW-free
    navigator.serviceWorker.register('sw.js').catch(() => {}); // missing sidecar → no-op

    // controller is only set when this load went through the worker's fetch
    // handler — i.e. the shell came from the offline cache. First visits
    // (and SW-less pages) leave the badge hidden.
    const ctrl = navigator.serviceWorker.controller;
    if (!ctrl) return;
    const badge = document.getElementById('hswbadge');
    if (badge) {
      badge.style.display = 'inline-flex';
      try {
        const mc = new MessageChannel();
        mc.port1.onmessage = ev => {
          if (ev.data && ev.data.version) badge.title = `Loaded from the offline cache (build ${ev.data.version})`;
        };
        ctrl.postMessage({ type: 'H_SW_VERSION' }, [mc.port2]);
      } catch {}
    }
    // Ask the browser not to evict our storage: iOS can drop the SW cache
    // and localStorage after ~7 idle days unless storage is persistent (or
    // the app is on the home screen).
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch {}
}
