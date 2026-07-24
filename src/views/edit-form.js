/* Renders the edit modal's form fields (issue #65) from the descriptors in
   lib/edit-form.js and reads the typed values back out. DOM only — every
   decision about which fields exist and how a value is interpreted lives in
   lib/edit-form.js. */
import { esc } from '../lib/escape.js';
import { inputValue, uncoveredPaths } from '../lib/edit-form.js';

/** Enum values are schema tokens ("not_booked"); show them as words. */
function optionLabel(v) {
  return String(v).replace(/_/g, ' ');
}

function control(f, obj) {
  const v = inputValue(f, obj);
  const p = ` data-p="${esc(f.path)}"`;
  if (f.kind === 'select') {
    // A required field with no value yet still gets the blank option: without
    // it the browser would pre-select the first enum member and save a value
    // the user never chose.
    const opts = [...f.options];
    if (v !== '' && !opts.includes(v)) opts.push(v);
    const blank = (f.allowEmpty || v === '') ? '<option value=""></option>' : '';
    return `<select class="hef-in"${p}>${blank}${opts.map(o =>
      `<option value="${esc(o)}"${o === v ? ' selected' : ''}>${esc(optionLabel(o))}</option>`).join('')}</select>`;
  }
  if (f.kind === 'textarea')
    return `<textarea class="hef-in" rows="3"${p}>${esc(v)}</textarea>`;
  const attrs = [
    f.kind === 'number' ? 'type="number"' : f.kind === 'text' || f.kind === 'csv' ? 'type="text"' : `type="${f.kind}"`,
    f.step ? `step="${esc(f.step)}"` : '',
    f.min !== undefined ? `min="${esc(f.min)}"` : '',
    f.max !== undefined ? `max="${esc(f.max)}"` : '',
    f.placeholder ? `placeholder="${esc(f.placeholder)}"` : '',
  ].filter(Boolean).join(' ');
  return `<input class="hef-in" ${attrs}${p} value="${esc(v)}">`;
}

function row(f, obj) {
  if (f.kind === 'checkbox')
    return `<label class="hef-f hef-ck"><input type="checkbox" data-p="${esc(f.path)}"${inputValue(f, obj) ? ' checked' : ''}><span>${esc(f.label)}</span></label>`;
  const req = f.required ? '<span class="hef-req" title="Required by the schema">*</span>' : '';
  return `<label class="hef-f${f.wide ? ' wide' : ''}"><span class="hef-lbl">${esc(f.label)}${req}</span>${control(f, obj)}</label>`;
}

/** Draw the form for `obj` into `el`, with a note about anything only the
    JSON tab can reach. */
export function renderForm(el, fields, obj) {
  const extra = uncoveredPaths(obj, fields);
  const note = extra.length
    ? `<div class="hef-more"><i class="ti ti-code" aria-hidden="true"></i> Also set here, editable on the JSON tab: ${extra.map(p => `<code>${esc(p)}</code>`).join(', ')}</div>`
    : '';
  el.innerHTML = `<div class="hef-grid">${fields.map(f => row(f, obj)).join('')}</div>${note}`;
}

/** Collect the raw input values, keyed by field path, for lib/applyForm. */
export function readForm(el, fields) {
  const raw = {};
  for (const f of fields) {
    const input = el.querySelector(`[data-p="${CSS.escape(f.path)}"]`);
    if (!input) continue;
    raw[f.path] = f.kind === 'checkbox' ? input.checked : input.value;
  }
  return raw;
}
