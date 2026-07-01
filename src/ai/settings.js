// AI assistant settings modal (OpenRouter key, model, web search opt-in).
// Everything is stored in localStorage only.
import { HOR_DEFAULT_MODEL } from './client.js';

export function settingsOpen() {
  document.getElementById('hset-key').value = localStorage.getItem('hOpenRouterKey') || '';
  document.getElementById('hset-model').value = localStorage.getItem('hOpenRouterModel') || HOR_DEFAULT_MODEL;
  document.getElementById('hset-web').checked = localStorage.getItem('hOpenRouterWeb') === '1';
  document.getElementById('hset-modal').classList.add('on');
}

export function settingsClose() {
  document.getElementById('hset-modal').classList.remove('on');
}

export function settingsSave() {
  const k = document.getElementById('hset-key').value.trim();
  const m = document.getElementById('hset-model').value.trim() || HOR_DEFAULT_MODEL;
  if (k) localStorage.setItem('hOpenRouterKey', k);
  localStorage.setItem('hOpenRouterModel', m);
  localStorage.setItem('hOpenRouterWeb', document.getElementById('hset-web').checked ? '1' : '0');
  settingsClose();
  if (localStorage.getItem('hOpenRouterKey')) document.getElementById('hchat-input').focus();
}

export function settingsClearKey() {
  localStorage.removeItem('hOpenRouterKey');
  document.getElementById('hset-key').value = '';
}
