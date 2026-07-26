#!/usr/bin/env node
/**
 * Print the share link for an itinerary JSON file — the same `#d1=` fragment
 * the app's share sheet builds, produced from src/lib/sharelink.js so there is
 * only one encoder.
 *
 * It exists for the example link in the README (issue #81): that link is an
 * opaque blob, so editing the example itinerary means regenerating it.
 *
 *   node scripts/share-link.mjs examples/orbit_city_weekend.json
 *   node scripts/share-link.mjs examples/orbit_city_weekend.json http://localhost:8345/holiday_itinerary_viewer.html
 *
 * The document is stamped with the schema's current version on the way in, as
 * shareDocument does in the browser, so a regenerated link always declares the
 * version this repo's schema is at.
 */
import { readFileSync } from 'node:fs';
import { shareDocument, shareUrl, isOverlong } from '../src/lib/sharelink.js';

const DEFAULT_BASE = 'https://mattmalcher.github.io/travel_planner/holiday_itinerary_viewer.html';

const [file, base = DEFAULT_BASE] = process.argv.slice(2);
if (!file) {
  console.error('usage: node scripts/share-link.mjs <itinerary.json> [viewer-url]');
  process.exit(2);
}

const schema = JSON.parse(readFileSync(new URL('../schema/holiday_itinerary_schema.json', import.meta.url), 'utf8'));
const doc = JSON.parse(readFileSync(file, 'utf8'));

const url = await shareUrl(base, shareDocument(doc, schema.version));
if (isOverlong(url)) console.error(`warning: ${url.length} chars — long enough to risk truncation in transit`);
console.log(url);
