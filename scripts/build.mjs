// Build the standalone viewer: bundle src/ into a single self-contained HTML
// file plus the schema it links to.
//
//   dist/holiday_itinerary_viewer.html  — the deliverable (JS + CSS inlined)
//   dist/index.html                     — copy, so the folder has a default page
//   dist/holiday_itinerary_schema.json  — served next to the page (the app
//                                         fetches it at runtime for validation)
//
// The schema's "version" field is injected into the bundle, replacing the
// __H_SCHEMA_VERSION__ placeholder in src/state.js, so the app's expected
// schema version can never drift from the schema itself.
import { build, transform } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeIcons } from './icons.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = p => join(root, 'src', p);
const out = p => join(root, 'dist', p);

const schemaPath = join(root, 'schema', 'holiday_itinerary_schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
if (!schema.version) throw new Error('schema/holiday_itinerary_schema.json has no "version" field');

const bundle = await build({
  entryPoints: [src('main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  legalComments: 'none',
  write: false,
});
const js = bundle.outputFiles[0].text.replaceAll('__H_SCHEMA_VERSION__', schema.version);
if (js.includes('__H_SCHEMA_VERSION__')) throw new Error('schema version placeholder not replaced');

const css = (await transform(readFileSync(src('styles.css'), 'utf8'), { loader: 'css', minify: true })).code;
const validate = readFileSync(src('validate.js'), 'utf8');

// A literal "</script>" inside inlined code would truncate the page early.
if (js.includes('</script') || validate.includes('</script')) {
  throw new Error('inlined script contains "</script>" — escape it before inlining');
}

// Placeholder replacement uses replacer functions so '$' sequences in the
// generated code are never interpreted as String.replace patterns.
let html = readFileSync(src('index.html'), 'utf8');
const inject = (placeholder, text) => {
  if (!html.includes(placeholder)) throw new Error(`placeholder ${placeholder} missing from src/index.html`);
  html = html.replace(placeholder, () => text);
};
inject('<!-- build:styles -->', `<style>\n${css}</style>`);
inject('<!-- build:app -->', `<script>\n${js}</script>`);
inject('<!-- build:validate -->', `<script type="module">\n${validate}</script>`);

mkdirSync(out(''), { recursive: true });
writeFileSync(out('holiday_itinerary_viewer.html'), html);
writeFileSync(out('index.html'), html);
copyFileSync(schemaPath, out('holiday_itinerary_schema.json'));

// Offline sidecars (issue #45): service worker, manifest and icons emitted
// next to the page. They are deploy conveniences, not dependencies — the
// HTML above stays fully self-contained. The SW cache name carries the
// schema version plus a hash of the built page so a deploy with any change
// gets a fresh shell cache (old ones are dropped on activate).
const buildTag = `${schema.version}-${createHash('sha256').update(html).digest('hex').slice(0, 8)}`;
const swBundle = await build({
  entryPoints: [src('sw.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  legalComments: 'none',
  write: false,
});
const sw = swBundle.outputFiles[0].text.replaceAll('__H_SW_VERSION__', buildTag);
if (sw.includes('__H_SW_VERSION__')) throw new Error('SW version placeholder not replaced');
writeFileSync(out('sw.js'), sw);

writeFileSync(out('manifest.webmanifest'), JSON.stringify({
  name: 'Holiday Itinerary Viewer',
  short_name: 'Itinerary',
  description: 'Timeline, budget, map and gantt views for HolidayItinerary JSON files',
  start_url: './',
  scope: './',
  display: 'standalone',
  background_color: '#f8fafc',
  theme_color: '#f8fafc',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
  ],
}, null, 2));
writeIcons(out(''));

console.log(`built dist/holiday_itinerary_viewer.html (schema ${schema.version}, ${(html.length / 1024).toFixed(0)} kB) + sw.js/manifest/icons (build ${buildTag})`);
