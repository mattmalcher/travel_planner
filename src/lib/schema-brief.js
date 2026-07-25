/** Condense the itinerary JSON Schema into a short plain-text reference for
    the AI system prompt (issue #24: the raw schema is ~17 KB of draft-07
    boilerplate). Keeps what a model needs to write valid payloads — property
    names, required markers, enums, consts, patterns/formats and $ref names —
    and drops descriptions and structural noise. Anything this summary omits
    is still enforced by the ajv validation of every tool call, whose errors
    are fed back to the model. */
/* Top-level bookkeeping the viewer owns, not the model (issue #80): the trip
   library maintains these, no tool call can reach them, and listing them here
   would only invite a model to invent a trip_id or renumber a rev. */
const APP_MANAGED = new Set(['trip_id', 'rev', 'updated_at', 'updated_by', 'forked_from']);

export function condenseSchema(schema) {
  const lines = ['Document: ' + objBrief(schema, APP_MANAGED)];
  for (const [name, def] of Object.entries(schema.definitions || {}))
    lines.push(name + ': ' + objBrief(def));
  return lines.join('\n');
}

function objBrief(def, omit) {
  const req = new Set(def.required || []);
  const parts = Object.entries(def.properties || {})
    .filter(([k]) => !(omit && omit.has(k)))
    .map(([k, v]) => k + (req.has(k) ? '*' : '') + ':' + hint(v));
  if (def.additionalProperties && typeof def.additionalProperties === 'object')
    parts.push('<any key>:' + hint(def.additionalProperties));
  return '{' + parts.join(', ') + '}';
}

function hint(s) {
  if (!s || typeof s !== 'object') return '?';
  if (s.$ref) return String(s.$ref).split('/').pop();
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum) return '(' + s.enum.join('|') + ')';
  if (s.oneOf) return s.oneOf.map(hint).join('|');
  if (s.type === 'array') return '[' + hint(s.items) + ']';
  if (s.type === 'object') return objBrief(s);
  if (s.type === 'string') return s.format || (s.pattern ? 'str ' + s.pattern : 'str');
  if (s.type === 'integer') return 'int';
  if (s.type === 'number') return 'num';
  if (s.type === 'boolean') return 'bool';
  return s.type || '?';
}
