function fmt(v) {
  if (v === undefined) return "-";
  if (v !== null && typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function renderValues(ids, getValue) {
  for (const id of ids) {
    const el = document.getElementById(`v-${id}`);
    if (!el) continue;
    el.textContent = fmt(getValue(id, "-"));
  }
}

function bindSensorRender({ ids, getValue, eventTarget = window }) {
  const handle = () => renderValues(ids, getValue);
  eventTarget.addEventListener("sensor-frame", handle);
  handle();
  return () => eventTarget.removeEventListener("sensor-frame", handle);
}

export { bindSensorRender };
