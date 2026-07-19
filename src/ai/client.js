// OpenRouter chat-completions client. Browser-only: the key lives in
// localStorage and requests go straight to OpenRouter (no backend).
import { buildTools } from './tools.js';

export const HOR_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const HOR_DEFAULT_MODEL = 'google/gemini-3.5-flash';

// Pure tool-calling: a low pinned temperature measurably reduces malformed
// calls on small models (issue #44). Overridable via the hOpenRouterTemp
// localStorage key (any float, e.g. "0.7") for experimentation.
export const HOR_DEFAULT_TEMPERATURE = 0.2;

export async function callOpenRouter(messages) {
  const key = localStorage.getItem('hOpenRouterKey');
  const model = localStorage.getItem('hOpenRouterModel') || HOR_DEFAULT_MODEL;
  const override = parseFloat(localStorage.getItem('hOpenRouterTemp'));
  const temperature = Number.isFinite(override) ? override : HOR_DEFAULT_TEMPERATURE;
  const res = await fetch(HOR_URL, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'HTTP-Referer': location.origin, 'X-Title': 'Itinerary viewer' },
    body: JSON.stringify({ model, messages, tools: buildTools(), tool_choice: 'auto', temperature }),
  });
  if (!res.ok) { let t = ''; try { t = await res.text(); } catch (e) {} throw new Error('OpenRouter ' + res.status + ': ' + t.slice(0, 300)); }
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data;
}
