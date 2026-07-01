// Chat panel: conversation state, the tool-call loop against OpenRouter, and
// panel open/close. Edits accumulate on a draft (state.draft) and are only
// applied via the preview (see preview.js).
import { state } from '../state.js';
import { esc } from '../lib/escape.js';
import { callOpenRouter } from './client.js';
import { applyTool } from './tools.js';
import { buildSystem } from './prompt.js';
import { settingsOpen } from './settings.js';
import { showPreview, hidePreview } from './preview.js';

export function emptyItinerary() {
  return { trip: { name: '', travellers: [], start: '', end: '', currency_primary: 'GBP' }, segments: [] };
}

/** Validate a full document if validate.js managed to load ajv. */
export function validateSafe(doc) {
  return window.hValidate ? window.hValidate(doc) : { ok: true, errors: [], note: 'validator not loaded' };
}

export function chatOpen() {
  document.getElementById('hchat').classList.add('on');
  if (!localStorage.getItem('hOpenRouterKey')) settingsOpen();
  else document.getElementById('hchat-input').focus();
}

export function chatClose() {
  document.getElementById('hchat').classList.remove('on');
}

export function chatClear() {
  state.chat = []; state.draft = null; state.ops = [];
  renderChat(); hidePreview();
}

export function chatPush(role, content) {
  state.chat.push({ role, content });
  renderChat();
}

export function renderChat() {
  const box = document.getElementById('hchat-msgs');
  if (!state.chat.length) { box.innerHTML = '<div class="hcmsg sys">Describe what to add or change. I can create a new itinerary or edit the current one — changes are previewed before they apply.</div>'; return; }
  box.innerHTML = state.chat.map(m => `<div class="hcmsg ${m.role}">${esc(m.content)}</div>`).join('');
  box.scrollTop = box.scrollHeight;
}

function setBusy(b) {
  state.busy = b;
  document.getElementById('hchat-busy').classList.toggle('on', b);
  document.getElementById('hchat-send').disabled = b;
  const box = document.getElementById('hchat-msgs'); box.scrollTop = box.scrollHeight;
}

export function chatSubmit() {
  const ta = document.getElementById('hchat-input');
  const text = ta.value.trim();
  if (!text || state.busy) return;
  ta.value = ''; ta.style.height = 'auto';
  llmSend(text);
}

async function llmSend(text) {
  if (!localStorage.getItem('hOpenRouterKey')) { chatPush('assistant', 'Add your OpenRouter API key in settings (the gear icon) to get started.'); settingsOpen(); return; }
  hidePreview();
  chatPush('user', text);
  state.draft = state.HD ? structuredClone(state.HD) : emptyItinerary();
  state.ops = [];
  const working = [{ role: 'system', content: buildSystem() }, ...state.chat.map(m => ({ role: m.role, content: m.content }))];
  setBusy(true);
  try {
    for (let i = 0; i < 6; i++) {
      const data = await callOpenRouter(working);
      const msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
      working.push(msg);
      if (msg.tool_calls && msg.tool_calls.length) {
        for (const tc of msg.tool_calls) {
          if (tc.type && tc.type !== 'function') continue; // server tools resolved by OpenRouter
          const result = applyTool(tc);
          working.push({ role: 'tool', tool_call_id: tc.id, content: result });
        }
        continue;
      }
      if (msg.content) chatPush('assistant', msg.content);
      else if (!state.ops.length) chatPush('assistant', '(no changes)');
      break;
    }
  } catch (e) { chatPush('assistant', '⚠️ ' + e.message); }
  setBusy(false);
  if (state.ops.length) showPreview();
}
