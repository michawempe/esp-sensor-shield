function getSensors() {
  return window.sensors || {};
}

function readSerialAndUpdate(callback, { eventTarget = window, immediate = false } = {}) {
  if (typeof callback !== "function") {
    throw new Error("readSerialAndUpdate requires a callback function.");
  }

  const handler = (event) => {
    callback(getSensors(), event?.detail?.frame || null, event);
  };

  eventTarget.addEventListener("sensors-updated", handler);

  if (immediate) {
    callback(getSensors(), null, null);
  }

  return () => eventTarget.removeEventListener("sensors-updated", handler);
}

// Backward-compatible alias
const onSensorsUpdated = readSerialAndUpdate;

export { getSensors, readSerialAndUpdate, onSensorsUpdated };
