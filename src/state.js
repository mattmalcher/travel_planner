// Shared mutable application state. All modules read and write through this
// single object so there is exactly one copy of each piece of state.
export const state = {
  HD: null,            // loaded itinerary document (the HolidayItinerary JSON)
  HM: null,            // Leaflet map instance (also mirrored on window.HM for inline handlers)
  mapReady: false,     // map view has been initialised since the last load/reset
  ganttCompact: false, // gantt view: compact vs proportional time scale
  ganttBlocks: [],     // block metadata for the gantt hover popover
  chat: [],            // visible conversation: {role:'user'|'assistant'|'sys', content}
  draft: null,         // pending AI-edited itinerary (clone), not yet applied
  ops: [],             // tracked operations for the AI diff preview
  reads: new Set(),    // segment ids the AI has fetched this turn (read-before-edit guard, issue #31)
  listReads: new Set(),// list ids the AI has fetched this turn (same guard for lists, issue #40)
  phraseReads: new Set(), // phrase group ids the AI has fetched this turn (same guard, issue #75)
  busy: false,         // an AI request is in flight
  editTarget: null,    // {type:'segment',idx} or {type:'trip'} for the edit modal
  editValue: null,     // the object the open modal is editing (form ⇄ JSON round-trip through it)
  editFields: null,    // form field descriptors for it, null when JSON-only (issue #65)
  editMode: 'form',    // which editor tab is showing: 'form' or 'json'
  pendingUpload: null, // uploaded doc held back by the version/validation guard (issue #15)
  pendingImport: null, // uploaded doc waiting on a replace/keep-both decision (issue #80)
  pendingShare: null,  // {doc, suffix} the share toast's fallback buttons act on (issue #114)
};

/* Schema version this build of the app expects. The placeholder below is
   replaced at build time (scripts/build.mjs) with the "version" field of
   schema/holiday_itinerary_schema.json, so it cannot drift from the schema.
   The MAJOR part guards saved localStorage data written by a different
   deployment (same origin → shared localStorage): bump the schema's MAJOR
   version on any breaking change to the stored itinerary shape. */
export const H_SCHEMA_VERSION = '__H_SCHEMA_VERSION__';

export function major(v) {
  return String(v || '').split('.')[0];
}

/* persist() used to live here, writing the single `hItinerary` slot. It moved
   to store.js when that slot became a library of trips (issue #80) — saving
   now needs a clock, an encoder and the library's index, none of which belong
   in the state object. */
