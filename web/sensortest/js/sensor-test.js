import { SerialJsonClient } from '../../shared/serial.js';
import { resolveIlabPortForConnect } from '../../shared/core.js';
import { TYPES, finite, visualState } from './sensor-visuals.js';

const grid = document.getElementById('sensorGrid');
const connectButton = document.getElementById('connect');
const status = document.getElementById('status');
const metrics = Object.fromEntries(['rate', 'fps', 'gap', 'count'].map(id => [id, document.getElementById(id)]));
const sensors = (window.sensors = window.sensors || {});
const formatter = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 });
const portOrder = new Intl.Collator(undefined, { numeric: true });
function text(el, value) { if (el.textContent !== value) el.textContent = value; }
function attr(el, name, value) {
  const next = String(value);
  if (el.getAttribute(name) !== next) el.setAttribute(name, next);
}
const cards = new Map();
let signature = '', connected = false, busy = false, received = false;
let lastPacket = -Infinity, lastDrawnPacket = -Infinity, packetTimes = [];
let paintCount = 0, lastMetricTime = performance.now(), lastHistoryTime = 0;
let invalidLines = 0, connectionMessage = '';

function setStatus(message, error = false) {
  if (status.textContent !== message) status.textContent = message;
  status.classList.toggle('error', error);
}
function setConnected(value) {
  connected = value;
  connectButton.textContent = value ? 'Verbindung trennen' : 'Board verbinden';
  if (!value) { lastPacket = -Infinity; packetTimes = []; }
}
const client = new SerialJsonClient({
  serialApi: navigator.serial,
  onJson: frame => {
    if (!frame?.data || typeof frame.data !== 'object' || Array.isArray(frame.data)) {
      if (frame?.error) connectionMessage = `Board: ${frame.error}${frame.msg ? ` · ${frame.msg}` : ''}`;
      return;
    }
    const now = performance.now();
    lastPacket = now;
    packetTimes.push(now);
    while (packetTimes.length && packetTimes[0] < now - 2000) packetTimes.shift();
    received = true;
    connectionMessage = '';
    for (const key of Object.keys(sensors)) delete sensors[key];
    for (const [name, sensor] of Object.entries(frame.data)) {
      if (sensor && typeof sensor === 'object' && !Array.isArray(sensor)) {
        Object.defineProperty(sensors, name, { value: sensor, enumerable: true, configurable: true, writable: true });
      }
    }
    syncCards();
    for (const [name, card] of cards) {
      const state = visualState(sensors[name]);
      card.history.push({ t: now, level: state?.level ?? null, second: state?.second ?? null });
      while (card.history.length > 600 || card.history[0]?.t < now - 5000) card.history.shift();
    }
    window.dispatchEvent(new CustomEvent('sensors-updated', { detail: { sensors, frame } }));
    window.dispatchEvent(new CustomEvent('sensor-frame', { detail: frame }));
  },
  onTextLine: () => { invalidLines++; },
  onConnectedStateChange: setConnected,
  onDisconnect: () => { connectionMessage = 'USB-Verbindung getrennt. Verbinde das Board erneut.'; },
  onReadError: async error => {
    connectionMessage = `Lesefehler: ${error.message}`;
    await client.disconnect();
  },
});

connectButton.addEventListener('click', async () => {
  if (busy) return;
  busy = true; connectButton.disabled = true;
  try {
    connectionMessage = '';
    if (connected) {
      await client.disconnect();
      connectionMessage = 'Verbindung getrennt.';
    } else {
      await client.connect({ resolvePort: () => resolveIlabPortForConnect(navigator.serial, client.currentPort()), baudRate: 115200 });
      invalidLines = 0;
    }
  } catch (error) {
    connectionMessage = `Verbindung nicht möglich: ${error.message}`;
  } finally {
    busy = false; connectButton.disabled = false;
  }
});

function createCard(name, type, port, preview = false) {
  const info = TYPES[type] || { title: type || 'Sensor', note: 'Der Messwert bestimmt den Durchmesser.' };
  const el = document.createElement('article');
  el.className = 'sensor-card stale';
  el.innerHTML = `
    <header class="card-head"><div><h2></h2><p class="card-name"></p></div><button class="zoom" type="button" aria-expanded="false">Vergrößern</button></header>
    <svg class="visual" viewBox="0 0 360 360" aria-hidden="true">
      <circle class="outline" cx="180" cy="180" r="158"/>
      <circle class="guide" cx="180" cy="180" r="105"/>
      <circle class="guide" cx="180" cy="180" r="53"/>
      <path class="axis" d="M22 180H338 M180 22V338"/>
      <circle class="shape" cx="180" cy="180" r="12"/>
      <line class="needle" x1="180" y1="180" x2="180" y2="42"/>
      <circle class="marker" cx="180" cy="42" r="14"/>
      <text class="state-label" x="180" y="181"></text>
    </svg>
    <div class="readout"><span class="value">—</span><span class="unit">Wert</span></div>
    <p class="raw">Noch keine Messwerte</p><p class="card-note"></p>
    <svg class="history" viewBox="0 0 500 50" preserveAspectRatio="none" aria-hidden="true"><path class="trace"/><path class="secondary"/></svg>
    <p class="history-label">Letzte 5 Sekunden</p>`;
  const find = selector => el.querySelector(selector);
  find('h2').textContent = info.title;
  find('.card-name').textContent = preview ? 'Vorschau · noch nicht verbunden' : `${name} · ${port || 'ohne Port'}`;
  find('.card-note').textContent = info.note;
  if (type === 'joystick') find('.history-label').textContent = 'Letzte 5 Sekunden · X schwarz / Y grau';
  const zoom = find('.zoom');
  zoom.setAttribute('aria-label', `${info.title}: Darstellung vergrößern`);
  zoom.addEventListener('click', () => {
    const expanded = el.classList.toggle('expanded');
    zoom.textContent = expanded ? 'Verkleinern' : 'Vergrößern';
    zoom.setAttribute('aria-expanded', String(expanded));
    zoom.setAttribute('aria-label', `${info.title}: Darstellung ${expanded ? 'verkleinern' : 'vergrößern'}`);
    if (expanded) el.scrollIntoView({ block: 'start', behavior: 'instant' });
  });
  const card = { el, name, type, info, history: [], preview,
    shape: find('.shape'), marker: find('.marker'), needle: find('.needle'), label: find('.state-label'),
    value: find('.value'), raw: find('.raw'), unit: find('.unit'), note: find('.card-note'), trace: find('.trace'), second: find('.secondary'), stale: true };
  card.marker.style.display = 'none'; card.needle.style.display = 'none';
  grid.append(el);
  return card;
}
function syncCards() {
  const entries = Object.entries(sensors).sort(([, a], [, b]) => portOrder.compare(String(a.port || ''), String(b.port || '')));
  const next = JSON.stringify(entries.map(([name, s]) => [name, s.type, s.port]));
  if (signature === next) return;
  signature = next;
  grid.replaceChildren(); cards.clear();
  for (const [name, s] of entries) cards.set(name, createCard(name, s.type, s.port));
  metrics.count.textContent = String(entries.length);
}
const number = value => finite(value) ? formatter.format(value) : '—';
const pair = value => value && typeof value === 'object' ? `x ${number(value.x)} · y ${number(value.y)}` : number(value);
function drawCard(card, sensor, fresh) {
  const state = fresh ? visualState(sensor) : null;
  const stale = !state;
  card.el.classList.toggle('stale', stale);
  card.stale = stale;
  if (stale) {
    text(card.value, '—');
    text(card.raw, sensor ? `Rohwert: ${pair(sensor.raw)}` : 'Noch keine Messwerte');
    text(card.note, sensor?.error ? `Keine gültige Messung · ${sensor.error}` : fresh ? 'Keine gültige Messung' : 'Warte auf aktuelle Daten …');
    return;
  }
  text(card.note, card.info.note);
  card.marker.style.display = state.mode === 'rotation' ? '' : 'none';
  card.needle.style.display = state.mode === 'rotation' ? '' : 'none';
  attr(card.shape, 'cx', '180'); attr(card.shape, 'cy', '180');
  attr(card.shape, 'r', '12'); attr(card.shape, 'fill', '#000');
  text(card.label, '');
  if (state.mode === 'xy') {
    attr(card.shape, 'cx', String(180 + (state.x * 2 - 1) * 100));
    attr(card.shape, 'cy', String(180 - (state.y * 2 - 1) * 100));
    attr(card.shape, 'r', '16');
    text(card.value, pair(sensor.value));
    text(card.unit, 'X / Y');
  } else if (state.mode === 'rotation') {
    const angle = state.level * Math.PI * 2 - Math.PI / 2;
    const x = 180 + Math.cos(angle) * 138, y = 180 + Math.sin(angle) * 138;
    attr(card.marker, 'cx', String(x)); attr(card.marker, 'cy', String(y));
    attr(card.needle, 'x2', String(x)); attr(card.needle, 'y2', String(y));
    text(card.value, number(sensor.value)); text(card.unit, 'Drehwert');
  } else if (state.mode === 'digital') {
    attr(card.shape, 'r', state.active ? '146' : '0');
    text(card.label, state.active ? 'AN' : 'AUS');
    attr(card.label, 'fill', state.active ? '#fff' : '#000');
    text(card.value, card.type === 'button' ? (state.active ? 'Gedrückt' : 'Losgelassen') : card.type === 'touch' ? (state.active ? 'Berührt' : 'Frei') : (state.active ? 'Geschlossen' : 'Offen'));
    text(card.unit, `Wert ${sensor.value}`);
  } else {
    attr(card.shape, 'r', String(10 + state.level * 136));
    text(card.value, number(card.type === 'distance' ? sensor.raw : sensor.value));
    text(card.unit, card.type === 'distance' ? 'mm' : 'Wert');
  }
  text(card.raw, `Rohwert: ${pair(sensor.raw)}${card.type === 'distance' ? ` · Wert: ${number(sensor.value)}` : ''}`);
}
function historyPath(history, now, key) {
  let path = '', drawing = false, previous = -Infinity;
  for (const sample of history) {
    if (sample.t < now - 5000) continue;
    const level = sample[key];
    if (level === null || sample.t - previous > 150) drawing = false;
    previous = sample.t;
    if (level === null) continue;
    path += `${drawing ? 'L' : 'M'}${((sample.t - now + 5000) / 10).toFixed(1)},${(46 - level * 42).toFixed(1)}`;
    drawing = true;
  }
  return path;
}
function render(now) {
  paintCount++;
  const fresh = connected && now - lastPacket < 500;
  if (lastDrawnPacket !== lastPacket || [...cards.values()].some(card => card.stale === fresh)) {
    for (const [name, card] of cards) drawCard(card, sensors[name], fresh);
    lastDrawnPacket = lastPacket;
  }
  if (now - lastHistoryTime >= 100) {
    for (const card of cards.values()) {
      card.trace.setAttribute('d', historyPath(card.history, now, 'level'));
      card.second.setAttribute('d', historyPath(card.history, now, 'second'));
    }
    lastHistoryTime = now;
  }
  if (now - lastMetricTime >= 500) {
    const recent = packetTimes.filter(t => t > now - 1000);
    metrics.rate.textContent = fresh ? String(recent.length) : '0';
    metrics.fps.textContent = String(Math.round(paintCount * 1000 / (now - lastMetricTime)));
    const gaps = recent.slice(1).map((t, i) => t - recent[i]);
    metrics.gap.textContent = fresh && gaps.length ? Math.max(...gaps).toFixed(1).replace('.', ',') : '—';
    if (connectionMessage) setStatus(connectionMessage, true);
    else if (connected && !fresh) setStatus('Verbunden · warte auf aktuelle Sensordaten …', true);
    else if (fresh) setStatus(`${cards.size ? 'Live' : 'Live · keine Sensoren konfiguriert'} · ${invalidLines ? `${invalidLines} ungültige Zeilen verworfen` : 'Ziel: 50 Pakete pro Sekunde'}`, invalidLines > 0);
    else setStatus(received ? 'Verbindung getrennt. Die letzten Werte sind ausgegraut.' : 'Verbinde dein Board, um die Sensoren live zu sehen.');
    paintCount = 0; lastMetricTime = now;
  }
  requestAnimationFrame(render);
}
for (const type of Object.keys(TYPES)) cards.set(type, createCard(type, type, '', true));
if (!navigator.serial) {
  connectButton.disabled = true;
  connectionMessage = 'Web Serial ist hier nicht verfügbar. Öffne die Seite über localhost in Chrome oder Edge.';
}
requestAnimationFrame(render);
