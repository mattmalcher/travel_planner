// The chat transcript, kept in localStorage so it survives a reload (issue
// #99) — it used to vanish the moment the page went away.
//
// Two decisions worth keeping:
//   * It is scoped to one trip. A transcript is about the document it edited,
//     so it comes back with that trip and stays hidden under another. One slot,
//     not one per trip: this is convenience, not the library.
//   * It is expendable, and it shares its quota with the trips themselves,
//     which are not (see the quota policy in lib/library.js). A write that
//     does not fit drops the history rather than crowding out a save.
// The store is a parameter, like lib/library.js, so all of it is unit-testable.

export const CHAT_KEY = 'hChatHistory';
export const MAX_MESSAGES = 30;
export const MAX_CHARS = 20000;

/**
 * The tail of `chat` that fits both caps — the newest messages win, the oldest
 * drop off. A single message longer than the whole budget is truncated rather
 * than dropped, so an over-long reply cannot empty the transcript.
 */
export function trimChat(chat, maxMessages = MAX_MESSAGES, maxChars = MAX_CHARS) {
  const out = [];
  let chars = 0;
  for (let i = chat.length - 1; i >= 0 && out.length < maxMessages; i--) {
    const m = chat[i];
    if (!m) continue;
    const content = String(m.content == null ? '' : m.content);
    if (out.length && chars + content.length > maxChars) break;
    chars += content.length;
    out.unshift({ role: m.role, content: content.slice(0, maxChars) });
  }
  return out;
}

/** Save the transcript against `tripId`. Returns false if it could not be kept. */
export function writeChat(store, tripId, chat) {
  const messages = trimChat(chat || []);
  try {
    if (!messages.length) { store.removeItem(CHAT_KEY); return true; }
    store.setItem(CHAT_KEY, JSON.stringify({ trip_id: tripId || null, messages }));
    return true;
  } catch (e) {
    // Out of quota (or storage refused outright): let the history go.
    try { store.removeItem(CHAT_KEY); } catch (e2) { /* nothing else to try */ }
    return false;
  }
}

/** The saved transcript for `tripId`, or [] — including when it belongs to another trip. */
export function readChat(store, tripId) {
  let saved;
  try { saved = JSON.parse(store.getItem(CHAT_KEY)); } catch (e) { return []; }
  if (!saved || !Array.isArray(saved.messages)) return [];
  if ((saved.trip_id || null) !== (tripId || null)) return [];
  return saved.messages.filter(m => m && typeof m.content === 'string'
    && (m.role === 'user' || m.role === 'assistant'));
}

export function clearChat(store) {
  try { store.removeItem(CHAT_KEY); } catch (e) { /* nothing to clear */ }
}
