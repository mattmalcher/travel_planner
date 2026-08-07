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
import { statusLine } from '../lib/ai-status.js';
import { readChat, writeChat, clearChat } from '../lib/chat-history.js';

export function emptyItinerary() {
  return { trip: { name: '', travellers: [], start: '', end: '', currency_primary: 'GBP' }, segments: [] };
}

/** Validate a full document. ajv is compiled into the bundle, so the fallback
    only covers a schema it could not compile (see src/validate.js). */
export function validateSafe(doc) {
  return window.hValidate ? window.hValidate(doc) : { ok: true, errors: [], note: 'validator not loaded' };
}

// The hchat-open body class drives the small-screen fullscreen mode (issue
// #48): CSS hides the page behind the panel and locks body scrolling, so
// there is nothing behind the panel for a touch drag to scroll — replacing
// the old touchmove-interception scroll lock from issue #25.
export function chatOpen() {
  document.getElementById('hchat').classList.add('on');
  document.body.classList.add('hchat-open');
  syncChatViewport();
  if (!localStorage.getItem('hOpenRouterKey')) settingsOpen();
  else document.getElementById('hchat-input').focus();
}

export function chatClose() {
  document.getElementById('hchat').classList.remove('on');
  document.body.classList.remove('hchat-open');
  syncChatViewport();
}

// Pin the fixed chat panel to the *visual* viewport. CSS dvh only tracks the
// mobile URL bar — by spec it ignores the on-screen keyboard — so the input
// footer still ends up behind the keyboard (issue #25), and iOS Safari has no
// CSS lever for it at all. visualViewport is the one API that reflects the
// keyboard on every mobile browser: match the panel's height to it and follow
// its offset so the footer stays above the keyboard. Cleared when closed so
// the CSS dvh/vh rules take over again.
export function syncChatViewport() {
  const el = document.getElementById('hchat');
  const vv = window.visualViewport;
  if (!vv || !el.classList.contains('on')) {
    el.style.height = '';
    el.style.transform = '';
    return;
  }
  el.style.height = vv.height + 'px';
  el.style.transform = `translateY(${vv.offsetTop}px)`;
}

export function chatClear() {
  state.chat = []; state.draft = null; state.ops = []; state.reads = new Set(); state.listReads = new Set(); state.phraseReads = new Set();
  clearChat(localStorage);
  renderChat(); hidePreview();
}

/* The transcript is saved per trip and comes back with it (issue #99). Only
   state.chat is stored — the draft, the ops and the read guards are a single
   turn's working state and must not survive a reload, or the preview would
   offer to apply changes computed against a document that has since moved on.
   Restoring does mean an old transcript is replayed to the model on the next
   turn, exactly as it would have been before the reload. */
function saveChat() {
  writeChat(localStorage, state.HD && state.HD.trip_id, state.chat);
}

/** Load the saved transcript for the open trip. Called by load() once persist()
    has settled the document's trip_id. */
export function restoreChat() {
  state.chat = readChat(localStorage, state.HD && state.HD.trip_id);
  renderChat();
}

export function chatPush(role, content) {
  state.chat.push({ role, content });
  renderChat();
  saveChat();
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
  if (b) setStatus('Thinking…');
  const box = document.getElementById('hchat-msgs'); box.scrollTop = box.scrollHeight;
}

/** The busy line's text. Built by lib/ai-status.js from the model's own tool
    names, so it is escaped here like any other model output. */
function setStatus(text) {
  document.getElementById('hchat-busy').innerHTML =
    `<i class="ti ti-loader-2" aria-hidden="true"></i> ${esc(text)}`;
}

export function chatSubmit() {
  const ta = document.getElementById('hchat-input');
  const text = ta.value.trim();
  if (!text || state.busy) return;
  ta.value = ''; ta.style.height = ''; // hand the height back to the CSS min-height
  llmSend(text);
}

async function llmSend(text) {
  if (!localStorage.getItem('hOpenRouterKey')) { chatPush('assistant', 'Add your OpenRouter API key in settings (the gear icon) to get started.'); settingsOpen(); return; }
  hidePreview();
  chatPush('user', text);
  state.draft = state.HD ? structuredClone(state.HD) : emptyItinerary();
  state.ops = [];
  // Tool results (get_segment/get_list/get_phrase_group reads) are not kept in
  // state.chat, so the model starts each turn blind again — reads must not
  // carry over between turns.
  state.reads = new Set();
  state.listReads = new Set();
  state.phraseReads = new Set();
  const working = [{ role: 'system', content: buildSystem() }, ...state.chat.map(m => ({ role: m.role, content: m.content }))];
  setBusy(true);
  // 12 iterations (up from 8): the read-then-patch pattern the digest prompt
  // mandates (issue #31) costs a get_segment round trip before each edit, so
  // a multi-segment request can legitimately need many steps — and an unused
  // iteration costs nothing (issue #44).
  const MAX_STEPS = 12;
  let finished = false;
  // What the model asked for on the step before, so the busy line can say what
  // is happening rather than "Thinking…" for the length of a 12-step turn
  // (issue #99). It is set as the next step *starts*, which is the moment the
  // tools have all been applied.
  let lastTools = [];
  try {
    for (let i = 0; i < MAX_STEPS; i++) {
      setStatus(statusLine(i + 1, MAX_STEPS, lastTools));
      const data = await callOpenRouter(working);
      const msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
      working.push(msg);
      if (msg.tool_calls && msg.tool_calls.length) {
        // A model that narrates before it acts said something worth keeping:
        // it explains the tool calls that follow, and it is the only account
        // of a turn that later runs out of steps.
        if (msg.content) chatPush('assistant', msg.content);
        lastTools = [];
        for (const tc of msg.tool_calls) {
          if (tc.type && tc.type !== 'function') continue; // server tools resolved by OpenRouter
          const result = applyTool(tc);
          lastTools.push(tc.function && tc.function.name);
          working.push({ role: 'tool', tool_call_id: tc.id, content: result });
        }
        continue;
      }
      if (msg.content) chatPush('assistant', msg.content);
      else if (!state.ops.length) chatPush('assistant', '(no changes)');
      finished = true;
      break;
    }
    // Every iteration returned tool calls: say so instead of ending the turn
    // silently (issue #44). The note lands in state.chat, so the next turn's
    // model sees it too and can pick up where it stopped.
    if (!finished)
      chatPush('assistant', `Stopped after ${MAX_STEPS} tool steps — the changes recorded so far are in the preview below; ask me to continue for the rest.`);
  } catch (e) { chatPush('assistant', '⚠️ ' + e.message); }
  setBusy(false);
  if (state.ops.length) showPreview();
}
