/**
 * Form model for the edit modal (issue #65).
 *
 * Which fields are worth a form control, in what order and under what label is
 * a UI decision, so that part is the hand-declared LAYOUT below. Everything
 * else — input type, enum options, required markers, numeric bounds — is
 * resolved out of the itinerary JSON Schema by specFromSchema(), so the form
 * cannot drift from the schema: an unknown path throws at build time.
 *
 * specFromSchema() runs in scripts/build.mjs and its output is baked into the
 * bundle (src/form-spec.js), rather than being derived at runtime from
 * window.hSchemaText, so the form still works on a saved file:// page where
 * the schema fetch never resolves.
 *
 * Pure: no DOM, no state. views/edit-form.js renders these descriptors and
 * app.js applies the collected values back onto the edited object.
 */

// The schema's HH:MM pattern — the marker for a <input type="time"> field.
const TIME_PATTERN = '^([01]\\d|2[0-3]):[0-5]\\d$';

/* Fields every segment type ends with: how it is being paid for, where it is
   in the group's decision-making, and freeform notes. */
const COST = [
  ['cost.status', 'Cost status'],
  ['cost.amount', 'Amount'],
  ['cost.currency', 'Currency', { placeholder: 'GBP' }],
  ['cost.paid_by', 'Paid by'],
  ['cost.due', 'Payment due'],
];
const TAIL = [
  ['proposal.status', 'Proposal status'],
  ['notes', 'Notes', { wide: true, multiline: true }],
];

/** [path, label, opts] per target type. opts: wide (full-width row),
    multiline (textarea), placeholder. Two entries fill one row of the grid. */
export const LAYOUT = {
  trip: [
    ['name', 'Trip name', { wide: true }],
    ['travellers', 'Travellers', { wide: true, placeholder: 'Comma separated' }],
    ['start', 'Start date'],
    ['end', 'End date'],
    ['currency_primary', 'Currency', { placeholder: 'GBP' }],
  ],
  transport: [
    ['mode', 'Mode'],
    ['operator', 'Operator'],
    ['service', 'Service'],
    ['ref', 'Booking ref'],
    ['date', 'Date'],
    ['duration_min', 'Duration (min)'],
    ['departs.place', 'From', { wide: true }],
    ['departs.time', 'Departs'],
    ['arrives.time', 'Arrives'],
    ['arrives.place', 'To', { wide: true }],
    ...COST,
    ...TAIL,
  ],
  accommodation: [
    ['name', 'Name', { wide: true }],
    ['host', 'Host'],
    ['ref', 'Booking ref'],
    ['address', 'Address', { wide: true }],
    ['lat', 'Latitude'],
    ['lng', 'Longitude'],
    ['phone', 'Host phone'],
    ['self_checkin', 'Self check-in'],
    ['checkin.date', 'Check-in date'],
    ['checkin.from', 'Check-in from'],
    ['checkout.date', 'Check-out date'],
    ['checkout.by', 'Check-out by'],
    ...COST,
    ...TAIL,
  ],
  event: [
    ['name', 'Name', { wide: true }],
    ['subtype', 'Kind'],
    ['date', 'Date'],
    ['time', 'Start time'],
    ['duration_min', 'Duration (min)'],
    ['end_date', 'End date'],
    ['end_time', 'End time'],
    ['all_day', 'All day'],
    ['venue', 'Venue', { wide: true }],
    ['address', 'Address', { wide: true }],
    ['lat', 'Latitude'],
    ['lng', 'Longitude'],
    ['url', 'Link', { wide: true }],
    ['tickets_url', 'Tickets link', { wide: true }],
    ...COST,
    ...TAIL,
  ],
  // Lists and their items (issue #72). A list's `items` and an item's
  // `segment_id` are deliberately absent: items are edited one at a time from
  // the Lists view, and segment_id is written by the Schedule action.
  list: [
    ['name', 'List name', { wide: true }],
    ['kind', 'Kind'],
  ],
  'list-item': [
    ['name', 'Name', { wide: true }],
    ['local_name', 'Local name', { wide: true }],
    ['url', 'Link', { wide: true }],
    ['note', 'Note', { wide: true, multiline: true }],
    ['done', 'Done'],
  ],
};

/** Keys the form deliberately never shows: identity, not content. */
export const HIDDEN_KEYS = ['id', 'type', 'schema_version'];

function deref(schema, node) {
  if (node && node.$ref) return schema.definitions[String(node.$ref).split('/').pop()];
  return node;
}

/** Walk a dotted path from a definition node, tracking whether every step of
    the way was declared required. Throws when the path is not in the schema —
    that is a build-time failure, not something to paper over at runtime. */
function resolve(schema, root, path, where) {
  let node = root, required = true;
  for (const key of path.split('.')) {
    const next = deref(schema, (node.properties || {})[key]);
    if (!next) throw new Error(`edit-form: ${where}.${path} is not in the schema`);
    required = required && (node.required || []).includes(key);
    node = next;
  }
  return { node, required };
}

function kindOf(node, opts) {
  if (node.enum) return 'select';
  if (node.type === 'boolean') return 'checkbox';
  if (node.type === 'array') return 'csv';
  if (node.type === 'integer' || node.type === 'number') return 'number';
  if (opts.multiline) return 'textarea';
  if (node.format === 'date') return 'date';
  if (node.pattern === TIME_PATTERN) return 'time';
  if (node.format === 'uri') return 'url';
  return 'text';
}

function field(schema, root, entry, where) {
  const [path, label, opts = {}] = entry;
  const { node, required } = resolve(schema, root, path, where);
  const f = { path, label, kind: kindOf(node, opts) };
  if (required) f.required = true;
  if (opts.wide) f.wide = true;
  if (opts.placeholder) f.placeholder = opts.placeholder;
  if (f.kind === 'select') {
    f.options = node.enum.slice();
    if (!required) f.allowEmpty = true;
  }
  if (f.kind === 'number') {
    f.step = node.type === 'integer' ? '1' : 'any';
    if (node.minimum !== undefined) f.min = node.minimum;
    if (node.maximum !== undefined) f.max = node.maximum;
  }
  return f;
}

/** Resolve every LAYOUT entry against the schema → {trip, transport,
    accommodation, event} field descriptor lists. Run at build time. */
export function specFromSchema(schema) {
  const roots = {
    trip: schema.properties.trip,
    transport: schema.definitions.TransportSegment,
    accommodation: schema.definitions.AccommodationSegment,
    event: schema.definitions.EventSegment,
    list: schema.definitions.List,
    'list-item': schema.definitions.ListItem,
  };
  const spec = {};
  for (const [where, entries] of Object.entries(LAYOUT))
    spec[where] = entries.map(e => field(schema, roots[where], e, where));
  return spec;
}

/** The field list for an edit target, or null when the form cannot describe it
    (an unrecognised or missing segment type) and JSON is the only option. */
export function fieldsFor(spec, kind) {
  return (spec && spec[kind]) || null;
}

export function getValue(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setValue(obj, path, val) {
  const keys = path.split('.');
  const last = keys.pop();
  let node = obj;
  for (const k of keys) {
    if (!node[k] || typeof node[k] !== 'object' || Array.isArray(node[k])) node[k] = {};
    node = node[k];
  }
  node[last] = val;
}

function deleteValue(obj, path) {
  const keys = path.split('.');
  const last = keys.pop();
  let node = obj;
  for (const k of keys) {
    if (!node[k] || typeof node[k] !== 'object') return;
    node = node[k];
  }
  delete node[last];
}

/** The string (or boolean, for a checkbox) a field's input should display. */
export function inputValue(field, obj) {
  const v = getValue(obj, field.path);
  if (field.kind === 'checkbox') return v === true;
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** One raw input value → the value to store, or undefined to drop the key.
    A number that will not parse is kept as the typed string rather than
    silently discarded, so schema validation reports it on save. Every kind
    but the notes textarea is a single-line string: the wide fields are drawn
    as wrapping controls (so a long address doesn't scroll sideways on a
    phone), and any newline that gets into one collapses to a space. */
export function parseField(field, raw) {
  if (field.kind === 'checkbox') return raw ? true : (field.required ? false : undefined);
  let s = String(raw == null ? '' : raw).trim();
  if (field.kind !== 'textarea') s = s.replace(/\s*\n\s*/g, ' ');
  if (s === '') return undefined;
  if (field.kind === 'csv') {
    const items = s.split(',').map(x => x.trim()).filter(Boolean);
    return items.length ? items : undefined;
  }
  if (field.kind === 'number') {
    const n = Number(s);
    return Number.isFinite(n) ? n : s;
  }
  return s;
}

/**
 * Apply raw form inputs onto a copy of the edited object. Anything the form
 * does not cover (seats, payments, pricing tiers, warnings) rides along
 * untouched, so switching between the form and the JSON tab never loses
 * fields. Emptying every field of an optional container (proposal, cost)
 * removes the container rather than leaving `{}` behind.
 */
export function applyForm(obj, fields, raw) {
  const out = JSON.parse(JSON.stringify(obj || {}));
  for (const f of fields) {
    const v = parseField(f, raw[f.path]);
    if (v === undefined) deleteValue(out, f.path);
    else setValue(out, f.path, v);
  }
  for (const parent of new Set(fields.map(f => f.path.split('.').slice(0, -1).join('.')).filter(Boolean))) {
    const node = getValue(out, parent);
    if (node && typeof node === 'object' && !Array.isArray(node) && !Object.keys(node).length)
      deleteValue(out, parent);
  }
  return out;
}

/**
 * Dotted paths present on the object that no form field covers — what the
 * "also in this segment" hint lists, so the form never silently implies the
 * JSON tab holds nothing more.
 */
export function uncoveredPaths(obj, fields) {
  const covered = new Set(fields.map(f => f.path));
  const parents = new Set(fields.map(f => f.path.split('.').slice(0, -1).join('.')).filter(Boolean));
  const out = [];
  (function walk(node, base) {
    for (const [k, v] of Object.entries(node || {})) {
      const path = base ? base + '.' + k : k;
      if (covered.has(path) || (!base && HIDDEN_KEYS.includes(k))) continue;
      if (parents.has(path) && v && typeof v === 'object' && !Array.isArray(v)) walk(v, path);
      else out.push(path);
    }
  })(obj, '');
  return out;
}
