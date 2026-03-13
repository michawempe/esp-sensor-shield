const PORT_ORDER = ["A1","A2","A3","A4","A5","A6","B1","B2","B3","B4","B5","C1","C2","C3","C4","D1","D2","D3","D4"];
const PORT_TYPE_OPTIONS_BASE = {
  A: ["button", "switch"],
  B: ["magnet", "slider", "sound", "light"],
  C: ["encoder", "joystick", "distance"],
  D: ["touch"],
};
const PORT_TYPE_OPTIONS_WITH_NONE = Object.fromEntries(
  Object.entries(PORT_TYPE_OPTIONS_BASE).map(([group, list]) => [group, ["none", ...list]]),
);
const PRESET_FOLDER_PICKER_ID = "esp32s3-presets";

const ILAB_ALLOWED_USB_FILTERS = [
  // ESP32-S3 USB JTAG/Serial interface
  { usbVendorId: 0x303a, usbProductId: 0x1001 },
];
const ILAB_BLOCKED_USB_FILTERS = [
  // ESP32-S3 USB Single Serial interface (not used in workshop pages)
  { usbVendorId: 0x303a, usbProductId: 0x1002 },
];

function allowedTypesForPort(portId, portTypeOptions = PORT_TYPE_OPTIONS_BASE, fallback = []) {
  const group = String(portId || "").charAt(0).toUpperCase();
  return portTypeOptions[group] || fallback;
}

function mapRuntimeDataToPortConfig(
  dataObj,
  {
    portOrder = PORT_ORDER,
    portTypeOptions = PORT_TYPE_OPTIONS_WITH_NONE,
    noneType = "none",
  } = {},
) {
  const mapped = {};
  for (const [name, sensor] of Object.entries(dataObj || {})) {
    if (!sensor || typeof sensor !== "object" || Array.isArray(sensor)) continue;
    const portId = typeof sensor.port === "string" ? sensor.port.trim() : "";
    if (!portOrder.includes(portId)) continue;
    const type = typeof sensor.type === "string" ? sensor.type.trim().toLowerCase() : noneType;
    if (!allowedTypesForPort(portId, portTypeOptions).includes(type)) continue;
    const entry = { type, name };
    for (const [key, value] of Object.entries(sensor)) {
      if (["type", "port", "value", "raw"].includes(key)) continue;
      if (["string", "number", "boolean"].includes(typeof value)) {
        entry[key] = value;
      }
    }
    mapped[portId] = entry;
  }
  return mapped;
}

function coercePresetObject(raw, options = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  if (raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)) {
    return mapRuntimeDataToPortConfig(raw.data, options);
  }
  if (raw.config && typeof raw.config === "object" && !Array.isArray(raw.config)) {
    return raw.config;
  }
  return raw;
}

function buildPayloadFromPresetObject(
  rawPreset,
  {
    portOrder = PORT_ORDER,
    portTypeOptions = PORT_TYPE_OPTIONS_BASE,
    noneType = "none",
  } = {},
) {
  const source = coercePresetObject(rawPreset, { portOrder, portTypeOptions, noneType });
  const payload = {};

  for (const portId of portOrder) {
    const entry = source[portId];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const type = typeof entry.type === "string" ? entry.type.trim().toLowerCase() : "";
    if (!type || type === noneType) continue;
    if (!allowedTypesForPort(portId, portTypeOptions).includes(type)) continue;

    const out = { type };
    if (typeof entry.name === "string" && entry.name.trim()) out.name = entry.name.trim();
    for (const [key, value] of Object.entries(entry)) {
      if (key === "type" || key === "name") continue;
      if (["string", "number", "boolean"].includes(typeof value)) {
        out[key] = value;
      }
    }
    payload[portId] = out;
  }

  return payload;
}

function parseJsonNamesFromDirectoryIndex(
  html,
  {
    include = new Set(),
    exclude = new Set(["presets.json"]),
  } = {},
) {
  const names = new Set(include);
  const hrefRegex = /href\s*=\s*"([^"]+)"/gi;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    try {
      const href = decodeURIComponent(match[1]);
      const fileName = href.split("?")[0].split("#")[0].split("/").pop() || "";
      const lower = fileName.toLowerCase();
      if (!lower.endsWith(".json")) continue;
      if (exclude.has(lower)) continue;
      names.add(fileName);
    } catch {
      // Ignore malformed link entries.
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

function getPortInfo(port) {
  try {
    return port?.getInfo?.() || {};
  } catch {
    return {};
  }
}

function matchesUsbFilter(info, filter) {
  if (!info || !filter) return false;
  return info.usbVendorId === filter.usbVendorId && info.usbProductId === filter.usbProductId;
}

function matchesAnyUsbFilter(info, filters) {
  return Array.isArray(filters) && filters.some((f) => matchesUsbFilter(info, f));
}

function isBlockedPort(port) {
  const info = getPortInfo(port);
  return matchesAnyUsbFilter(info, ILAB_BLOCKED_USB_FILTERS);
}

function isIlabPort(port) {
  const info = getPortInfo(port);
  if (isBlockedPort(port)) return false;
  return matchesAnyUsbFilter(info, ILAB_ALLOWED_USB_FILTERS);
}

async function resolveIlabPortForConnect(serialApi, currentPort = null) {
  if (!serialApi?.requestPort || !serialApi?.getPorts) {
    throw new Error("WebSerial API is not available.");
  }

  const authorized = await serialApi.getPorts();
  if (currentPort && authorized.includes(currentPort) && isIlabPort(currentPort)) return currentPort;

  const authorizedIlab = authorized.find((port) => isIlabPort(port));
  if (authorizedIlab) return authorizedIlab;

  let selectedPort;
  try {
    selectedPort = await serialApi.requestPort({ filters: ILAB_ALLOWED_USB_FILTERS });
  } catch (err) {
    if (err?.name === "NotFoundError") {
      throw new Error("No ilab Board port selected.");
    }
    throw err;
  }

  if (!selectedPort || isBlockedPort(selectedPort) || !isIlabPort(selectedPort)) {
    throw new Error("Selected USB port is not the ilab Board (JTAG/Serial).");
  }

  return selectedPort;
}

export {
  PORT_ORDER,
  PORT_TYPE_OPTIONS_BASE,
  PORT_TYPE_OPTIONS_WITH_NONE,
  PRESET_FOLDER_PICKER_ID,
  ILAB_ALLOWED_USB_FILTERS,
  ILAB_BLOCKED_USB_FILTERS,
  allowedTypesForPort,
  mapRuntimeDataToPortConfig,
  coercePresetObject,
  buildPayloadFromPresetObject,
  parseJsonNamesFromDirectoryIndex,
  getPortInfo,
  matchesUsbFilter,
  matchesAnyUsbFilter,
  isBlockedPort,
  isIlabPort,
  resolveIlabPortForConnect,
};
