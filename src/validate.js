/**
 * Client-side schema validation: ajv plus the itinerary schema, both compiled
 * into the page at build time.
 *
 * This used to be injected as a separate module script that imported ajv from
 * esm.sh and fetched the schema next to the page. Both of those are network
 * calls, and both fail in exactly the situations the app is built for — a
 * saved `file://` copy, an offline phone, a blocked CDN — so validation was
 * advisory in practice: every caller falls back to `{ok: true}` when
 * `window.hValidate` is missing, which meant an unvalidated document loaded
 * silently. A share link is untrusted input that arrives by URL, so "the
 * guard is skipped when the network is down" was the wrong default (the badge
 * XSS this pairs with is in views/badges.js).
 *
 * Bundling costs ~125 kB of page weight and rules out a script-src CSP
 * without 'unsafe-eval' (ajv compiles validators with `new Function`). In
 * exchange the guard is always there, including on the saved single file.
 *
 * The window.* surface is unchanged: the callers (app.js, ai/tools.js,
 * ai/chat.js) still reach these through `window`, and still keep their
 * `{ok: true}` fallback — it now only covers ajv failing to compile the
 * schema, which is a build error rather than a network condition.
 */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

/* The schema itself, substituted for the identifier below by esbuild's define
   (scripts/build.mjs) as a JSON string literal — parsing one is cheaper than
   evaluating an equivalent object literal, and it doubles as
   window.hSchemaText for the AI prompt's schema brief. */
const SCHEMA_TEXT = __H_SCHEMA_TEXT__;

const draft7 = 'http://json-schema.org/draft-07/schema#';

/** Wrap a compiled ajv validator in the {ok, errors} shape the callers use. */
function wrap(validate) {
  return function (data) {
    const ok = validate(data);
    return {
      ok,
      errors: ok ? [] : (validate.errors || []).map(e => ({
        path: e.instancePath || '/', message: e.message, params: e.params,
      })),
    };
  };
}

/**
 * Compile on first use, not at boot.
 *
 * ajv compiles a schema by generating source and running it through
 * `new Function`, which is not cheap: compiling all nine validators eagerly
 * cost ~1.5s of main-thread time on a 6x-throttled CPU (a low-end phone),
 * paid by every page load — including the many that never open a document at
 * all. Deferring it moves that work to the first validate call, where there
 * is a document in hand and the user is already waiting on it.
 *
 * This changes nothing about *whether* the guard is there. Compilation is
 * synchronous and local, so the first caller gets a real validator with no
 * network and no await — which is the property that made bundling worth it.
 */
function lazy(compile) {
  let validate;
  return data => {
    if (validate === undefined) {
      try {
        validate = wrap(compile());
      } catch (e) {
        // Only reachable if the baked-in schema cannot be compiled, which is a
        // build-time mistake — tests/unit/validate-compile.test.js compiles all
        // of them in CI so it cannot reach a deploy. Degrade rather than throw
        // into the upload path: the callers' {ok: true} fallback is the same
        // contract they had when ajv came off the network.
        console.error('Schema validation unavailable (ajv failed to compile):', e);
        validate = null;
      }
    }
    return validate ? validate(data) : { ok: true, errors: [] };
  };
}

/**
 * Compile every validator the app needs and publish them on `window`.
 * Called from main.js before boot(), so a share link arriving in the fragment
 * meets a validator that is already there — no race, and none of the polling
 * the esm.sh import used to need.
 */
export function setupValidation() {
  try {
    const schema = JSON.parse(SCHEMA_TEXT);
    window.hSchemaText = SCHEMA_TEXT;
    window.hSchemaVersion = schema.version;

    // One ajv instance, also built on first use — nothing below compiles
    // anything until someone actually validates (see lazy() above).
    let ajv = null;
    const instance = () => {
      if (!ajv) { ajv = new Ajv({ allErrors: true, strict: false }); addFormats(ajv); }
      return ajv;
    };
    /** A subschema compiled against the same definitions as the whole. */
    const sub = body => lazy(() =>
      instance().compile({ $schema: draft7, definitions: schema.definitions, ...body }));

    window.hValidate = lazy(() => instance().compile(schema));

    /* Segments are validated against the ONE subschema their type names, with
       the oneOf as the fallback for a segment that names no known type. Under
       the oneOf, ajv reports every branch's failures, so a half-filled event
       comes back demanding "mode" and "departs" — the transport branch's
       requirements — which is worse than useless in the edit modal (#76). */
    const segDefs = { transport: 'TransportSegment', accommodation: 'AccommodationSegment', event: 'EventSegment' };
    const segByType = {};
    for (const [t, def] of Object.entries(segDefs)) segByType[t] = sub({ $ref: '#/definitions/' + def });
    const segAny = sub({ oneOf: Object.values(segDefs).map(d => ({ $ref: '#/definitions/' + d })) });
    window.hValidateSegment = seg => ((seg && segByType[seg.type]) || segAny)(seg);

    window.hValidateTrip = sub(schema.properties.trip);
    window.hValidateList = sub({ $ref: '#/definitions/List' });
    window.hValidateListItem = sub({ $ref: '#/definitions/ListItem' });
    window.hValidatePhraseGroup = sub({ $ref: '#/definitions/PhraseGroup' });
    window.hValidatePhrase = sub({ $ref: '#/definitions/Phrase' });
  } catch (e) {
    // A schema ajv cannot compile is a build-time mistake, not a runtime
    // condition — but it must not take the whole page down with it.
    console.error('Schema validation unavailable (ajv failed to compile the schema):', e);
  }
}
