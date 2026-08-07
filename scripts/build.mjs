// Build the standalone viewer: bundle src/ into a single self-contained HTML
// file plus the schema it links to (the copy in dist/ is what the upload
// screen's "JSON Schema" link points at — the app no longer fetches it, since
// validate.js has the schema compiled in).
//
//   dist/holiday_itinerary_viewer.html  — the deliverable (JS + CSS inlined)
//   dist/index.html                     — copy, so the folder has a default page
//   dist/holiday_itinerary_schema.json  — served next to the page, purely so
//                                         the upload screen's "JSON Schema"
//                                         link resolves; nothing fetches it
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
import { specFromSchema } from '../src/lib/edit-form.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = p => join(root, 'src', p);
const out = p => join(root, 'dist', p);

// The deployed share Worker (worker/wrangler.jsonc). Kept here rather than in
// src/ so a fork can point a build at its own deploy without touching the app.
const DEFAULT_SHARE_ENDPOINT = 'https://travel-planner-share.mattmalcher.workers.dev';

const schemaPath = join(root, 'schema', 'holiday_itinerary_schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
if (!schema.version) throw new Error('schema/holiday_itinerary_schema.json has no "version" field');

// The edit modal's form fields are resolved from the schema here rather than
// from the runtime schema fetch, so the form works on a saved file:// page
// (issue #65). A LAYOUT path the schema no longer has fails the build.
//
// The schema itself is injected the same way, as a JSON string literal that
// src/validate.js parses. ajv is bundled alongside it, so the upload/share-link
// guard no longer depends on reaching esm.sh or on the schema sidecar being
// served next to the page — it works on a saved single file too.
// Where hosted share links are stored (issue #116). A build-time constant
// because the page must run from file:// with no config to fetch. Override
// with SHARE_ENDPOINT=… (or SHARE_ENDPOINT= to build a page that only ever
// produces the long fragment links, which is still a working share).
const shareEndpoint = process.env.SHARE_ENDPOINT ?? DEFAULT_SHARE_ENDPOINT;

const bundle = await build({
  entryPoints: [src('main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  legalComments: 'none',
  define: {
    __H_FORM_SPEC__: JSON.stringify(specFromSchema(schema)),
    __H_SCHEMA_TEXT__: JSON.stringify(JSON.stringify(schema)),
    __H_SHARE_ENDPOINT__: JSON.stringify(shareEndpoint),
  },
  write: false,
});
const js = bundle.outputFiles[0].text.replaceAll('__H_SCHEMA_VERSION__', schema.version);
if (js.includes('__H_SCHEMA_VERSION__')) throw new Error('schema version placeholder not replaced');

const css = (await transform(readFileSync(src('styles.css'), 'utf8'), { loader: 'css', minify: true })).code;

// A literal "</script>" inside inlined code would truncate the page early.
// The bundle now carries the schema text, so this guards that too.
if (js.includes('</script')) {
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
  description: 'Itinerary, schedule, budget and map views for HolidayItinerary JSON files',
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
console.log(`  share store: ${shareEndpoint || '(none — long links only)'}`);
