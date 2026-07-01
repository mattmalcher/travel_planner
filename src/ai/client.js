// OpenRouter chat-completions client. Browser-only: the key lives in
// localStorage and requests go straight to OpenRouter (no backend).
import { buildTools } from './tools.js';

export const HOR_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const HOR_DEFAULT_MODEL = 'google/gemini-3.5-flash';

export async function callOpenRouter(messages) {
  const key = localStorage.getItem('hOpenRouterKey');
  const model = localStorage.getItem('hOpenRouterModel') || HOR_DEFAULT_MODEL;
  const res = await fetch(HOR_URL, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'HTTP-Referer': location.origin, 'X-Title': 'Itinerary viewer' },
    body: JSON.stringify({ model, messages, tools: buildTools(), tool_choice: 'auto' }),
  });
  if (!res.ok) { let t = ''; try { t = await res.text(); } catch (e) {} throw new Error('OpenRouter ' + res.status + ': ' + t.slice(0, 300)); }
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data;
}
