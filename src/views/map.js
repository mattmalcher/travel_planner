// Map view: Leaflet markers for stations, stays and events plus a dashed
// route line following chronological order.
import { state } from '../state.js';
import { sortSegments, segDate } from '../lib/sort.js';
import { fmtDate } from '../lib/dates.js';
import { esc } from '../lib/escape.js';

/** Tear down the Leaflet instance so the next visit to the map tab rebuilds it. */
export function destroyMap() {
  if (state.HM) { state.HM.remove(); state.HM = null; window.HM = null; }
  state.mapReady = false;
}

export function renderMap() {
  if (!window.L || !state.HD) return;
  const HD = state.HD;
  if (state.HM) { state.HM.remove(); state.HM = null; }
  const HM = L.map('hmap');
  state.HM = HM;
  window.HM = HM; // inline handlers on the location cards use window.HM
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 18 }).addTo(HM);
  const mpin = (col, lbl) => L.divIcon({ html: `<div style="background:${col};width:22px;height:22px;border-radius:50%;border:2px solid white;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:white;font-family:sans-serif">${lbl}</div>`, className: '', iconAnchor: [11, 11], popupAnchor: [0, -13] });
  const allc = [], route = [], seen = new Set();
  for (const s of sortSegments(HD.segments)) {
    if (s.type === 'transport') {
      const dk = s.departs.place.toLowerCase(), ak = s.arrives.place.toLowerCase();
      const dc = s.departs.lat != null ? [s.departs.lat, s.departs.lng] : null;
      const ac = s.arrives.lat != null ? [s.arrives.lat, s.arrives.lng] : null;
      if (dc) { route.push(dc); if (!seen.has(dk)) { seen.add(dk); allc.push(dc); L.marker(dc, { icon: mpin('#4b5563', 'T') }).addTo(HM).bindPopup(`<strong>${esc(s.departs.place)}</strong><br>${esc(s.operator)}${s.service ? ' · ' + esc(s.service) : ''}<br>Departs ${esc(s.departs.time)}`); } }
      if (ac) { route.push(ac); if (!seen.has(ak)) { seen.add(ak); allc.push(ac); L.marker(ac, { icon: mpin('#4b5563', 'T') }).addTo(HM).bindPopup(`<strong>${esc(s.arrives.place)}</strong>`); } }
    } else if (s.type === 'accommodation') {
      const c = [s.lat, s.lng]; route.push(c); allc.push(c);
      L.marker(c, { icon: mpin('#b45309', 'H') }).addTo(HM).bindPopup(`<strong>${esc(s.name)}</strong><br>${esc(s.host)}<br>${esc(s.address)}<br>Check-in: ${fmtDate(s.checkin.date)}`);
    } else if (s.type === 'event' && s.lat) {
      const c = [s.lat, s.lng]; allc.push(c);
      L.marker(c, { icon: mpin('#15803d', 'E') }).addTo(HM).bindPopup(`<strong>${esc(s.name)}</strong><br>${esc(s.venue || '')}<br>${fmtDate(s.date)}`);
    }
  }
  if (route.length > 1) L.polyline(route, { color: '#6366f1', weight: 2, opacity: 0.55, dashArray: '6 8' }).addTo(HM);
  if (allc.length > 0) HM.fitBounds(L.latLngBounds(allc).pad(0.18));
  document.getElementById('hmaplist').innerHTML = HD.segments.filter(s => s.lat).map(s => `
    <div onclick="if(window.HM)HM.setView([${Number(s.lat)},${Number(s.lng)}],13)" style="background:var(--color-background-primary);border:.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md);padding:.55rem .75rem;cursor:pointer;font-size:12px" onmouseover="this.style.background='var(--color-background-secondary)'" onmouseout="this.style.background='var(--color-background-primary)'">
      <div style="font-weight:500;margin-bottom:2px">${esc(s.name || s.venue)}</div>
      <div style="color:var(--color-text-secondary)">${fmtDate(segDate(s))}</div>
    </div>`).join('');
}
