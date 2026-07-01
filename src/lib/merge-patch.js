/** JSON Merge Patch (RFC 7386): nested objects merge key-by-key, a null
    value removes the key, and arrays/scalars replace wholesale. Backs the
    AI assistant's patch_segment tool (issue #24) so partial edits don't
    require re-emitting a whole segment. Never mutates its inputs — the
    diff preview keeps the original as "before". */
export function mergePatch(target, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = (target && typeof target === 'object' && !Array.isArray(target)) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out;
}
