/* Field descriptors for the edit modal's form, generated from
   schema/holiday_itinerary_schema.json at build time: scripts/build.mjs runs
   specFromSchema() (src/lib/edit-form.js) and esbuild substitutes the result
   for the identifier below. Baking it in rather than deriving it from the
   runtime schema fetch keeps the form working on a saved file:// page.
   Never hand-write this shape — change src/lib/edit-form.js's LAYOUT instead. */
export const FORM_SPEC = __H_FORM_SPEC__;
