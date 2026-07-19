import { test, expect } from '@playwright/test';

// Offline-first service worker (issue #45). Every other spec runs with
// serviceWorkers: 'block' (playwright.config.js) so their page.route stubs
// keep working; this file opts back in to exercise the real worker against
// the built dist/ artifact.
test.use({ serviceWorkers: 'allow' });

test.describe('offline service worker (issue #45)', () => {

  test('build emits the sidecar files next to the page', async ({ request }) => {
    expect((await request.get('/sw.js')).ok()).toBe(true);
    const man = await request.get('/manifest.webmanifest');
    expect(man.ok()).toBe(true);
    const manifest = JSON.parse(await man.text());
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons).toHaveLength(2);
    for (const icon of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) {
      const res = await request.get('/' + icon);
      expect(res.ok(), icon).toBe(true);
      expect((await res.body()).subarray(1, 4).toString('ascii'), icon).toBe('PNG');
    }
  });

  test('first load precaches the shell; a reload is served by the worker and shows the badge', async ({ page }) => {
    await page.goto('/holiday_itinerary_viewer.html');
    // First visit came from the network: no badge.
    await expect(page.locator('#hswbadge')).toBeHidden();

    // ready resolves once the worker has activated, which is after the
    // install step's precache completed.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    const cachedPaths = await page.evaluate(async () => {
      const key = (await globalThis.caches.keys()).find(k => k.startsWith('h-shell-'));
      if (!key) return [];
      return (await (await globalThis.caches.open(key)).keys()).map(r => new URL(r.url).pathname);
    });
    expect(cachedPaths).toContain('/holiday_itinerary_viewer.html');
    expect(cachedPaths).toContain('/holiday_itinerary_schema.json');

    // Second load goes through the worker's fetch handler.
    await page.reload();
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await expect(page.locator('#hswbadge')).toBeVisible();
    await expect(page.locator('#hswbadge')).toContainText('Offline ready');
    // The badge tooltip picks up the build tag from the worker.
    await expect.poll(() => page.locator('#hswbadge').getAttribute('title')).toContain('build');
    // The app itself still boots normally underneath.
    await expect(page.locator('#hupl')).toBeVisible();
  });

  test('the page still renders when the network goes away', async ({ page, context }) => {
    await page.goto('/holiday_itinerary_viewer.html');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload();
    await expect(page.locator('#hswbadge')).toBeVisible();

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#hupl')).toBeVisible();
    await expect(page.locator('#hswbadge')).toBeVisible();
    await context.setOffline(false);
  });

  test.describe('without a service worker', () => {
    // Registration is blocked → navigator.serviceWorker.register rejects,
    // which is the same no-op path as a missing sw.js sidecar or file://.
    test.use({ serviceWorkers: 'block' });

    test('the page boots normally and the badge never appears', async ({ page }) => {
      await page.goto('/holiday_itinerary_viewer.html');
      await expect(page.locator('#hupl')).toBeVisible();
      await expect(page.locator('#hswbadge')).toBeHidden();
    });
  });
});
