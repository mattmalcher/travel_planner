// Diff preview for AI edits: lists the recorded operations, blocks Apply
// while the draft fails schema validation, and swaps the draft in on apply.
import { state, persist } from '../state.js';
import { esc } from '../lib/escape.js';
import { updateHeader, refreshAfterChange, showApp } from '../render.js';
import { chatPush, validateSafe } from './chat.js';

function opLabel(seg) {
  if (!seg) return 'segment';
  const id = seg.id ? ' (' + seg.id + ')' : '';
  if (seg.type === 'transport') return 'transport' + id + ': ' + (seg.operator || '') + ' ' + ((seg.departs && seg.departs.station) || '?') + ' → ' + ((seg.arrives && seg.arrives.station) || '?');
  if (seg.type === 'accommodation') return 'accommodation' + id + ': ' + (seg.name || '');
  if (seg.type === 'event') return 'event' + id + ': ' + (seg.name || '');
  return 'segment' + id;
}

export function showPreview() {
  const v = validateSafe(state.draft);
  const ops = state.ops.map(o => {
    if (o.kind === 'add') return `<div class="hpv-op" style="color:var(--color-text-success)">+ Added ${esc(opLabel(o.after))}</div>`;
    if (o.kind === 'remove') return `<div class="hpv-op" style="color:var(--color-text-danger)">− Removed ${esc(opLabel(o.before))}</div>`;
    if (o.kind === 'update') return `<div class="hpv-op" style="color:var(--color-text-warning)">~ Updated ${esc(opLabel(o.after))}</div>`;
    if (o.kind === 'trip') return `<div class="hpv-op" style="color:var(--color-text-warning)">~ Updated trip details</div>`;
    return '';
  }).join('');
  const details = state.ops.map((o, i) => {
    const body = (o.kind === 'remove')
      ? JSON.stringify(o.before, null, 2)
      : (o.before ? JSON.stringify(o.before, null, 2) + '\n\n→\n\n' : '') + JSON.stringify(o.after, null, 2);
    return `<details style="margin-top:4px"><summary style="cursor:pointer;font-size:11px;color:var(--color-text-secondary)">details ${i + 1}</summary><pre style="font-size:10px;overflow-x:auto;margin:4px 0">${esc(body)}</pre></details>`;
  }).join('');
  const err = v.ok ? '' : `<div class="hpv-err"><strong>Cannot apply — schema errors remain:</strong>\n${esc(JSON.stringify(v.errors, null, 2))}</div>`;
  const btns = `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:.6rem">
      <button onclick="hDiscardDraft()" style="font-size:12px">Discard</button>
      <button onclick="hApplyDraft()" style="font-size:12px;font-weight:500" ${v.ok ? '' : 'disabled'}>Apply changes</button>
    </div>`;
  const pv = document.getElementById('hchat-preview');
  pv.innerHTML = `<div style="font-weight:500;margin-bottom:.35rem">Proposed changes</div>${ops}${details}${err}${btns}`;
  pv.classList.add('on');
}

export function hidePreview() {
  const pv = document.getElementById('hchat-preview');
  pv.classList.remove('on');
  pv.innerHTML = '';
}

export function discardDraft() {
  state.draft = null; state.ops = [];
  hidePreview();
  chatPush('assistant', 'Changes discarded.');
}

export function applyDraft() {
  if (!state.draft) return;
  const v = validateSafe(state.draft); if (!v.ok) return;
  state.HD = state.draft; state.draft = null; state.ops = [];
  persist();
  showApp();
  updateHeader();
  refreshAfterChange();
  hidePreview();
  chatPush('assistant', '✅ Changes applied.');
}
