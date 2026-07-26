// Record the README's demo animation: drive the *built* page through a short
// scripted tour and turn the frames into demo/demo.gif.
//
//   npm run demo            # build first (make demo does it for you)
//   npm run demo -- --keep-frames demo/demo.gif
//
// The GIF is build output, like dist/: CI records it and publishes it to the
// gh-pages root next to the viewer, and the README links it from there. It is
// never committed — a recording re-encodes differently every run, so a
// committed one would churn a binary in git on every change to src/.
//
// Why frames + ffmpeg rather than shot-scraper: shot-scraper takes stills, not
// video, and would add a Python toolchain next to the Playwright one this repo
// already pins for the E2E suite. The scenario below is the same kind of
// scripted browser walk, driven by the browser we already install in CI, and
// ffmpeg's palettegen/paletteuse pair is what turns it into a GIF small enough
// to sit in a README.
//
// Determinism matters more than smoothness here — an unattended job publishes
// whatever this produces. Every frame is captured between scripted steps
// (never from a concurrent timer, which would race the actions it is
// photographing), the trip is the fixed examples/ fixture rather than anything
// of the user's, and the run fails instead of publishing if the page's CDN
// assets or the map tiles never arrived.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, rmSync, readFileSync, statSync, createReadStream, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeShare, shareDocument } from '../src/lib/sharelink.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const PAGE = 'holiday_itinerary_viewer.html';

const args = process.argv.slice(2);
const keepFrames = args.includes('--keep-frames');
const outGif = join(root, args.find(a => !a.startsWith('-')) || 'demo/demo.gif');
const framesDir = join(root, '.demo-frames');

// 10 fps: fast enough to read as motion, slow enough that a ~15s tour stays
// inside a couple of megabytes of GIF.
const FPS = 10;
const VIEWPORT = { width: 880, height: 660 };
const GIF_WIDTH = 800;

/** Serve dist/ — the recording must show the shipped single-file artifact,
    and the service worker + share-link boot want a real http origin. */
function serve(dir) {
  const types = {
    '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
    '.png': 'image/png', '.webmanifest': 'application/manifest+json',
  };
  const server = createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = join(dir, rel);
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
  if (!existsSync(join(dist, PAGE))) {
    throw new Error(`dist/${PAGE} is missing — run "npm run build" first`);
  }
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  mkdirSync(dirname(outGif), { recursive: true });

  const server = await serve(dist);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    // Same reason as playwright.config.js: a controlling worker changes what
    // the page does on reload, and none of it is what the tour is showing.
    serviceWorkers: 'block',
  });
  const page = await context.newPage();

  let frame = 0;
  const shoot = async (n = 1, gap = 1000 / FPS) => {
    for (let i = 0; i < n; i++) {
      if (i) await page.waitForTimeout(gap);
      await page.screenshot({ path: join(framesDir, `f${String(++frame).padStart(4, '0')}.png`) });
    }
  };

  try {
    await tour(page, base, shoot);
  } finally {
    await browser.close();
    server.close();
  }
  if (!frame) throw new Error('no frames were captured');

  await gif(framesDir, outGif);
  const kb = Math.round(statSync(outGif).size / 1024);
  console.log(`recorded ${frame} frames → ${outGif.replace(root + '/', '')} (${kb} kB, ${(frame / FPS).toFixed(1)}s)`);
  if (!keepFrames) rmSync(framesDir, { recursive: true, force: true });
}

/** The scripted walk: open a shared trip, then visit each tab in turn. */
async function tour(page, base, shoot) {
  // The example trip arrives the way a trip usually does — as a share link —
  // so the recording starts on a loaded itinerary with no file picker in it.
  const doc = JSON.parse(readFileSync(join(root, 'examples', 'paris_weekend.json'), 'utf8'));
  const payload = await encodeShare(shareDocument(doc, doc.schema_version));
  await page.goto(`${base}/${PAGE}#${payload}`, { waitUntil: 'load' });
  await page.locator('#htname').waitFor();
  await page.waitForTimeout(800);
  await requireAssets(page);

  await shoot(14);                 // the itinerary, as it lands
  await scrollTour(page, shoot);   // down through the days, and back up

  await tab(page, shoot, 'map', async () => {
    // Tiles come off the network. Wait for them rather than photograph a grey
    // grid — and say so if they never arrive, since a published recording of
    // an empty map is worse than a failed job.
    const tiles = page.locator('#hmap img.leaflet-tile-loaded');
    await tiles.first().waitFor({ timeout: 20000 })
      .catch(() => { throw new Error('the map never loaded a tile — refusing to record a blank map'); });
    await page.waitForTimeout(2000);
  }, 14);

  await tab(page, shoot, 'gantt', null, 16);

  await tab(page, shoot, 'lists', async () => {
    // Tick something off — the Lists view is about progress, and a static
    // shot of it says nothing about that.
    const box = page.locator('#hvlists input[type=checkbox]').first();
    if (await box.count()) {
      await shoot(6);
      await box.click();
    }
  }, 12);

  await tab(page, shoot, 'phrases', null, 14);
  await tab(page, shoot, 'budget', null, 20);
}

/**
 * The page's two CDN subresources have to be there before anything is
 * photographed: without Leaflet the map tab is an empty box, and without the
 * Tabler webfont every icon renders as nothing at all — both silently, and
 * both would go straight into the published GIF.
 */
async function requireAssets(page) {
  const missing = await page.evaluate(async () => {
    const out = [];
    if (typeof globalThis.L === 'undefined') out.push('Leaflet (cdn.jsdelivr.net)');
    try { await globalThis.document.fonts.ready; } catch (e) { /* older engine: fall through */ }
    if (!globalThis.document.fonts.check('16px "tabler-icons"')) out.push('the Tabler icon webfont');
    return out;
  });
  if (missing.length) throw new Error(`${missing.join(' and ')} did not load — refusing to record a broken page`);
}

/** Down through the itinerary and back to the top — but only as far as there
    is itinerary to scroll, so a short trip doesn't buy a still frame. */
async function scrollTour(page, shoot) {
  const room = await page.evaluate(() =>
    globalThis.document.documentElement.scrollHeight - globalThis.innerHeight);
  const steps = Math.min(20, Math.round(room / 90));
  if (steps < 2) return;
  await scroll(page, shoot, steps, 90);
  await shoot(6);
  await scroll(page, shoot, Math.ceil(steps / 3), -280);
}

/** Switch to a tab, run an optional beat inside it, and hold on it. */
async function tab(page, shoot, view, during, hold) {
  await page.locator(`.htab[data-v="${view}"]`).click();
  await page.waitForTimeout(400);
  await shoot(4);
  if (during) await during();
  await shoot(hold);
}

/** Wheel-scroll the content in steps, one frame per step, so the movement
    reads as movement rather than as a jump cut. */
async function scroll(page, shoot, steps, dy) {
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(60);
    await shoot(1);
  }
}

/** frames → GIF, via ffmpeg's two-pass palette. One shared palette
    (stats_mode=single would re-quantise per frame and shimmer); Bayer
    dithering because it compresses far better than error diffusion. */
function gif(dir, out) {
  const filter = [
    `fps=${FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,split[a][b]`,
    '[a]palettegen=max_colors=128:stats_mode=diff[p]',
    '[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
  ].join(';');
  return run(process.env.FFMPEG || 'ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-framerate', String(FPS), '-i', join(dir, 'f%04d.png'),
    '-filter_complex', filter, '-loop', '0', out,
  ]);
}

function run(cmd, argv) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: 'inherit' });
    p.on('error', e => reject(e.code === 'ENOENT'
      ? new Error(`${cmd} not found — install ffmpeg (apt-get install ffmpeg / brew install ffmpeg)`)
      : e));
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)));
  });
}

await main();
