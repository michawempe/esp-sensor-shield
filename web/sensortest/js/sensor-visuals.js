export const TYPES = {
  slider: { title: 'Slider', note: 'Der Messwert bestimmt den Durchmesser.' },
  light: { title: 'Licht', note: 'Der Messwert bestimmt den Durchmesser.' },
  magnet: { title: 'Magnet', note: 'Der Messwert bestimmt den Durchmesser.' },
  sound: { title: 'Sound', note: 'Spitze-zu-Spitze-Pegel · ein neuer Wert etwa alle 20 ms.' },
  distance: { title: 'Abstand', note: 'Je näher das Objekt, desto größer der Kreis.' },
  joystick: { title: 'Joystick', note: 'X: links / rechts · Y: unten / oben.' },
  encoder: { title: 'Encoder', note: 'Der Punkt folgt der Drehung. Der Zahlenwert zählt weiter.' },
  button: { title: 'Taster', note: 'Gefüllt = gedrückt · Pull-up-Eingang: 0 ist aktiv.' },
  switch: { title: 'Schalter', note: 'Gefüllt = geschlossen · Pull-up-Eingang: 0 ist aktiv.' },
  touch: { title: 'Touch', note: 'Gefüllt = Berührung erkannt.' },
};
export const finite = v => typeof v === 'number' && Number.isFinite(v);
export const clamp = v => Math.max(0, Math.min(1, v));
export function normalize(value, low = 0, high = 1) {
  if (!finite(value)) return null;
  if (!finite(low)) low = 0;
  if (!finite(high)) high = 1;
  return high === low ? 0 : clamp((value - low) / (high - low));
}
export function visualState(sensor) {
  if (!sensor || sensor.error) return null;
  const { type, value } = sensor;
  if (type === 'joystick') {
    if (!finite(value?.x) || !finite(value?.y)) return null;
    const x = normalize(value.x, sensor.outMin ?? -1, sensor.outMax ?? 1);
    const y = normalize(value.y, sensor.outMin ?? -1, sensor.outMax ?? 1);
    return { mode: 'xy', x, y, level: x, second: y };
  }
  if (!finite(value)) return null;
  if (['button', 'switch', 'touch'].includes(type)) {
    const active = type === 'touch' ? value !== 0 : value === 0;
    return { mode: 'digital', active, level: Number(active) };
  }
  if (type === 'encoder') {
    const turns = finite(sensor.fullRotation) && sensor.fullRotation > 0
      ? value / sensor.fullRotation : (finite(sensor.raw) ? sensor.raw : value) / 40;
    const level = ((turns % 1) + 1) % 1;
    return { mode: 'rotation', level };
  }
  let level = normalize(value, sensor.outMin, sensor.outMax);
  if (type === 'distance') {
    if (!finite(sensor.raw)) return null;
    level = 1 - normalize(sensor.raw, sensor.inMin ?? 30, sensor.inMax ?? 600);
  }
  return { mode: 'size', level };
}
