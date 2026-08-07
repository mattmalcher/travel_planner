/**
 * Where the hosted share store lives (issue #116).
 *
 * A build-time constant rather than a runtime lookup: the deliverable is one
 * self-contained HTML file that has to work from `file://`, so there is no
 * config to fetch. `scripts/build.mjs` substitutes `__H_SHARE_ENDPOINT__` from
 * the `SHARE_ENDPOINT` environment variable, defaulting to the deployed
 * Worker; set `SHARE_ENDPOINT=` (empty) to build a page that never uploads
 * anything and shares long fragment links only.
 */
export const SHARE_ENDPOINT = __H_SHARE_ENDPOINT__;
